/**
 * tracker-data.mjs — the only reader of Lin vault state for the tracker.
 *
 * Everything that walks companies/, reads the evaluation queue, pipeline.md,
 * the PATHFINDER backlog, and computes buckets/win-rate lives here. Renderers
 * (tracker-md.mjs, tracker-html.mjs) consume this module and never touch disk
 * for vault state themselves.
 *
 * Call init(vaultPath) before anything else (lin-tracker.mjs does).
 * Split out of lin-tracker.mjs 2026-06-10 (Phase 7 dashboard rebuild).
 */
import fs from "node:fs";
import path from "node:path";

// ---------- module state (set by init) ----------
let VAULT = null;
let CFG = { promote_threshold: 4.2 };
let FULL_NAME = "Candidate";
let NAME_STEM = "Candidate";

export function init(vaultPath) {
  VAULT = path.resolve(vaultPath);
  if (!fs.existsSync(path.join(VAULT, "companies"))) {
    throw new Error(`Vault root has no companies/ dir: ${VAULT}`);
  }
  CFG = readPipelineConfig();
  FULL_NAME = loadProfileFullName();
  NAME_STEM = FULL_NAME.trim().split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean).join("_");
  _salaryCache.clear();
  return { vault: VAULT, cfg: CFG };
}

export function vault() { return VAULT; }
export function cfg() {
  return { ...CFG, review_upper: (CFG.promote_threshold - 0.01).toFixed(2) };
}

function readPipelineConfig() {
  const p = path.join(VAULT, "career-profile", "pipeline-config.json");
  if (!fs.existsSync(p)) return { promote_threshold: 4.2 };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const threshold = Number(raw.promote_threshold ?? 4.2);
    return { promote_threshold: Number.isFinite(threshold) ? threshold : 4.2 };
  } catch {
    return { promote_threshold: 4.2 };
  }
}

// ---------- minimal YAML loader (job.yml schema only) ----------
export function loadJobYml(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const out = { artifacts: {}, applied_with: {}, source: {} };
  let currentBlock = null;
  for (const rawLine of lines) {
    let line = rawLine;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^[a-z_]+:\s*$/.test(line)) {
      const key = line.split(":")[0].trim();
      if (key === "artifacts" || key === "applied_with" || key === "source") {
        currentBlock = key;
        continue;
      } else {
        currentBlock = null;
      }
    }
    if (currentBlock && /^\s{2,}[a-z_]+:/.test(line)) {
      const [k, ...rest] = line.trim().split(":");
      out[currentBlock][k] = parseScalar(rest.join(":").trim());
      continue;
    }
    if (/^[a-z_]+:\s*.+$/.test(line)) {
      const [k, ...rest] = line.split(":");
      out[k.trim()] = parseScalar(rest.join(":").trim());
      currentBlock = null;
    }
  }
  return out;
}

function parseScalar(v) {
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v.replace(/^["']|["']$/g, "");
}

// ---------- recruiter-friendly filename helpers (mirror lin-package.mjs) ----------
function loadProfileFullName() {
  const profilePath = path.join(VAULT, "career-profile", "profile.yml");
  if (!fs.existsSync(profilePath)) return "Candidate";
  const text = fs.readFileSync(profilePath, "utf8");
  const m = text.match(/^\s*full_name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  return m ? m[1].trim() : "Candidate";
}

export function companyDisplay(slug) {
  return String(slug).split(/[-_]/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function packageDateFor(yml) {
  const src = yml.applied_at && /^\d{4}-\d{2}-\d{2}/.test(yml.applied_at)
    ? yml.applied_at
    : new Date().toISOString();
  return src.slice(0, 10).replace(/-/g, "");
}

export function resumeFinalName(jobPath, coSlug, yml) {
  const canonical = `${NAME_STEM}_Resume_${companyDisplay(coSlug)}_${packageDateFor(yml)}.pdf`;
  if (fs.existsSync(path.join(jobPath, canonical))) return canonical;
  try {
    const hits = fs.readdirSync(jobPath).filter((f) =>
      new RegExp(`^${NAME_STEM}_Resume_.*\\.pdf$`).test(f)
    );
    if (hits.length) return hits.sort().slice(-1)[0];
  } catch {}
  return canonical;
}

// ---------- lifecycle ----------
// staged → built → materials_ready → applied → interviewing → offer → closed.
// Legacy statuses normalize on load so old data can never break rendering.
const LEGACY_STATUS = { new: "staged", interested: "staged", decoding: "staged" };
export function normStatus(s) { const v = String(s || "").trim(); return LEGACY_STATUS[v] || v; }

export function walkJobs() {
  const companiesDir = path.join(VAULT, "companies");
  const jobs = [];
  for (const coSlug of fs.readdirSync(companiesDir)) {
    const coPath = path.join(companiesDir, coSlug);
    if (!fs.statSync(coPath).isDirectory()) continue;
    const jobsDir = path.join(coPath, "jobs");
    if (!fs.existsSync(jobsDir)) continue;
    for (const jobSlug of fs.readdirSync(jobsDir)) {
      const jobPath = path.join(jobsDir, jobSlug);
      const ymlPath = path.join(jobPath, "job.yml");
      if (!fs.existsSync(ymlPath)) continue;
      const yml = loadJobYml(ymlPath);
      yml.status = normStatus(yml.status);
      jobs.push({ coSlug, jobSlug, folder: `companies/${coSlug}/jobs/${jobSlug}/`, jobPath, ...yml });
    }
  }
  return jobs;
}

// ---------- win-rate ----------
export function computeWinRate(jobs, windowDays = 28) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = jobs.filter((j) => {
    if (!j.applied_at) return false;
    const t = new Date(j.applied_at).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
  const tally = { forge: 0, pathfinder: 0 };
  for (const j of inWindow) {
    const w = j.applied_with?.resume;
    if (w === "forge") tally.forge += 1;
    if (w === "pathfinder") tally.pathfinder += 1;
  }
  const total = tally.forge + tally.pathfinder;
  const pct = (n) => (total === 0 ? "—" : `${Math.round((n / total) * 100)}%`);
  const recent = [...inWindow]
    .sort((a, b) => new Date(b.applied_at) - new Date(a.applied_at))
    .slice(0, 5);
  let lastWinnerLine = "—";
  if (recent[0]) {
    const engine = (recent[0].applied_with?.resume || "?").toUpperCase();
    lastWinnerLine = `${engine} (${recent[0].coSlug})`;
  }
  return {
    windowDays,
    cutoff: new Date(cutoff).toISOString(),
    total, tally, pct, recent,
    digestLine:
      total === 0
        ? `Resume win-rate (last ${windowDays} days): no Lin-managed applications in window`
        : `Resume win-rate (last 4 weeks): PATHFINDER ${tally.pathfinder}/${total} (${pct(
            tally.pathfinder
          )}), FORGE ${tally.forge}/${total} (${pct(tally.forge)}) — last winner: ${lastWinnerLine}`,
  };
}

// ---------- classification helpers ----------
export function isWontApplyDetail(detail) {
  return /won[’']?t[_ -]?apply|wont[_ -]?apply|do not apply|don[’']?t apply|user_declined/i.test(String(detail || ""));
}

export function isWontApplyQueueRow(r) {
  const notes = Array.isArray(r?.notes) ? r.notes.join("\n") : "";
  return r?.queue_state === "skipped" && (
    r?.recommendation === "manual_override" ||
    r?.liveness?.result === "user_declined" ||
    isWontApplyDetail(notes)
  );
}

export const VALID_SOURCES = new Set(["portal", "linkedin", "indeed", "gmail", "manual"]);

export function normalizeSource(s) {
  const v = String(s ?? "").trim().toLowerCase();
  return VALID_SOURCES.has(v) ? v : "portal";
}

export function itemSource(item) {
  return normalizeSource(item?.source || item?.source_channel || item?.source?.channel || item?.discovered_source);
}

export function sourceLabel(source) {
  return ({ portal: "portal", linkedin: "LinkedIn", indeed: "Indeed", gmail: "Gmail", manual: "Manual" })[normalizeSource(source)];
}

export function sourceBadgeMd(item) {
  return sourceLabel(itemSource(item));
}

export function duplicateTarget(item) {
  return item?.duplicate_of || item?.source_duplicate_of || item?.source?.duplicate_of || item?.dup_of || null;
}

export function duplicateBadgeMd(item) {
  const d = duplicateTarget(item);
  return d ? `dup→${d}` : "—";
}

function firstUrlToken(line) {
  const m = /(https?:\/\/[^\s|]+)/.exec(String(line ?? ""));
  return m ? m[1].replace(/[)\].,;]+$/, "") : null;
}

export function parsePendingPipelineLine(line) {
  const m = /^- \[ \] (\d{4}-\d{2}-\d{2}) \| (.+)$/u.exec(String(line ?? ""));
  if (!m) return null;
  const date = m[1];
  const rest = m[2];
  const url = firstUrlToken(rest);
  if (!url) return null;
  const firstPipe = rest.indexOf(" | ");
  const company = firstPipe >= 0 ? rest.slice(0, firstPipe).trim() : "";
  const afterCompany = firstPipe >= 0 ? rest.slice(firstPipe + 3) : rest;
  const urlIdx = afterCompany.indexOf(url);
  const role = urlIdx >= 0 ? afterCompany.slice(0, urlIdx).replace(/\s*\|\s*$/, "").trim() : "";
  const tail = urlIdx >= 0 ? afterCompany.slice(urlIdx + url.length) : "";
  const source = normalizeSource(/(?:^|[\s|])src=([^\s|]+)/.exec(tail)?.[1] || "portal");
  const duplicate_of = /(?:^|[\s|])dup_of=([^\s|]+)/.exec(tail)?.[1] || null;
  const canonical_key = /(?:^|[\s|])canonical_key=([^\s|]+)/.exec(tail)?.[1] || null;
  return { date, company, role, url, source, duplicate_of, canonical_key };
}

export function sourceCounts(items) {
  const counts = { portal: 0, linkedin: 0, indeed: 0, gmail: 0, manual: 0 };
  for (const item of items || []) counts[itemSource(item)] += 1;
  return counts;
}

export function sourceSummaryText(label, items) {
  const c = sourceCounts(items);
  return `${label}: portal ${c.portal}, LinkedIn ${c.linkedin}, Indeed ${c.indeed}, Gmail ${c.gmail}`;
}

// ---------- readers ----------
export function readEvaluationQueue(jobs) {
  const queuePath = path.join(VAULT, "data", "evaluation-queue.json");
  if (!fs.existsSync(queuePath)) return [];
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(queuePath, "utf8")); }
  catch { return []; }
  const roles = Array.isArray(parsed.roles) ? parsed.roles : [];
  const ownedByUrl = new Set(jobs.map((j) => j.source_url).filter(Boolean));
  const ownedByPair = new Set(jobs.map((j) => `${j.coSlug}|${j.jobSlug}`));
  return roles.filter((r) => {
    if (isWontApplyQueueRow(r)) return true;
    if (r.url && ownedByUrl.has(r.url)) return false;
    if (r.co_slug && r.job_slug && ownedByPair.has(`${r.co_slug}|${r.job_slug}`)) return false;
    return true;
  });
}

export function readPipelineRows() {
  const p = path.join(VAULT, "data", "pipeline.md");
  if (!fs.existsSync(p)) return [];
  const rows = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const row = parsePendingPipelineLine(line);
    if (row) rows.push(row);
  }
  return rows;
}

export function readPathfinderBacklog() {
  const trackerPath = path.join(VAULT, "engines/pathfinder/data/applications.md");
  if (!fs.existsSync(trackerPath)) return [];
  const lines = fs.readFileSync(trackerPath, "utf8").split("\n");
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([\d-]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*)\|\s*(.*)\|/);
    if (m) {
      rows.push({
        num: m[1].trim(), date: m[2].trim(), company: m[3].trim(), role: m[4].trim(),
        score: m[5].trim(), status: m[6].trim(), pdf: m[7].trim(), report: m[8].trim(), notes: m[9].trim(),
      });
    }
  }
  return rows;
}

// ---------- salary / verdict ----------
const _salaryCache = new Map();
export function extractSalary(role) {
  const key = role.id || role.url || role.report || role.jd_path;
  if (_salaryCache.has(key)) return _salaryCache.get(key);
  const range = /(?:CA\$|US\$|\$|£|€)\s?\d[\d,]*\s?[kK]?\s?(?:–|—|-|to)\s?(?:CA\$|US\$|\$)?\s?\d[\d,]*\s?[kK]?(?:\s?(?:USD|CAD|GBP|EUR))?/;
  let out = null;
  for (const rel of [role.jd_path, role.jd_snapshot, role.report_path, role.report]) {
    if (!rel) continue;
    const p = path.join(VAULT, rel);
    if (!fs.existsSync(p)) continue;
    let m;
    try { m = fs.readFileSync(p, "utf8").match(range); } catch { m = null; }
    if (m) { out = m[0].replace(/\s+/g, " ").trim(); break; }
  }
  _salaryCache.set(key, out);
  return out;
}

export function salaryToNum(str) {
  if (!str) return -1;
  const m = String(str).match(/\d[\d,]*\s?[kK]?/);
  if (!m) return -1;
  let tok = m[0].replace(/,/g, "").trim();
  const hasK = /[kK]$/.test(tok);
  let n = parseInt(tok, 10);
  if (Number.isNaN(n)) return -1;
  if (hasK) n *= 1000;
  return n;
}

export function verdictBucket(r) {
  const v = String(r.verdict || "").toLowerCase();
  if (/strong|exceptional|good match|pursue|^apply\b|\bapply\b/.test(v)) {
    if (!/skip|reject|weak|pass|against|blocker/.test(v)) return "apply";
  }
  if (/skip|reject|\bpass\b|against|blocker|hard block/.test(v)) return "skip";
  if (/stretch|investable|long.?shot|reach|moderate|decent|mixed|possible|borderline/.test(v)) return "stretch";
  const rec = String(r.recommendation || "").toLowerCase();
  if (rec === "auto_stage" || rec === "manual_override") return "apply";
  if (rec === "skip") return "skip";
  if (rec === "review") return "stretch";
  return "other";
}

export function salaryForJob(j, queue) {
  const folderRel = `companies/${j.coSlug}/jobs/${j.jobSlug}`;
  const r = (queue || []).find(
    (q) => (q.co_slug === j.coSlug && q.job_slug === j.jobSlug) ||
      (q.promotion?.job_folder || "").replace(/\/$/, "") === folderRel,
  );
  if (r) { const s = extractSalary(r); if (s) return s; }
  return extractSalary({
    id: `job:${j.coSlug}/${j.jobSlug}`,
    jd_path: `${j.folder}job.md`,
    report: `${j.folder}${j.pathfinder_report || "pathfinder-eval.md"}`,
  });
}

// ---------- unified row model (Phase 7 dashboard) ----------
export function normCanada(value) {
  if (value === true || value === "yes" || value === "true") return "yes";
  if (value === false || value === "no" || value === "false") return "no";
  return "unknown";
}

function existsRel(rel) { return rel && fs.existsSync(path.join(VAULT, rel)); }

function jobLinks(j) {
  const f = j.folder; // companies/co/jobs/slug/
  const finalName = resumeFinalName(j.jobPath, j.coSlug, j);
  return {
    jd: j.source_url || null,
    report: existsRel(`${f}${j.pathfinder_report || "pathfinder-eval.md"}`) ? `../${f}${j.pathfinder_report || "pathfinder-eval.md"}` : null,
    folder: `../${f}`,
    ats: existsRel(`${f}resumes/ats-compare.md`) ? `../${f}resumes/ats-compare.md` : null,
    final: existsRel(`${f}${finalName}`) ? `../${f}${finalName}` : null,
    pkg: existsRel(`${f}PACKAGE.md`) ? `../${f}PACKAGE.md` : null,
  };
}

function readHistoryTail(j, n = 3) {
  const p = path.join(j.jobPath, "status-history.md");
  if (!fs.existsSync(p)) return [];
  try {
    return fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).slice(-n);
  } catch { return []; }
}

const ACTIONS_BY_STAGE = {
  "review-hi": ["prepare", "wont"],
  review: ["wont"],
  skip: ["wont"],
  staged: ["wont"],
  built: ["wont"],
  ready: ["apply", "wont"],
  applied: ["wont-rejected"],
};

export const STAGE_ORDER = ["pending", "review-hi", "review", "staged", "built", "ready", "applied", "interviewing", "offer", "wont", "closed", "skip"];

export function buildRows({ jobs, queue, pipelineRows }) {
  const threshold = CFG.promote_threshold;
  const rows = [];

  for (const j of jobs) {
    const wont = j.status === "closed" && isWontApplyDetail(j.status_detail);
    const stage = wont ? "wont" : j.status === "materials_ready" ? "ready" : j.status;
    rows.push({
      kind: "job",
      key: `${j.coSlug}/${j.jobSlug}`,
      id: null,
      coSlug: j.coSlug,
      jobSlug: j.jobSlug,
      company: j.coSlug,
      role: j.title || j.jobSlug,
      stage,
      score: typeof j.pathfinder_score === "number" ? j.pathfinder_score : null,
      verdict: j.pathfinder_verdict || null,
      canada: normCanada(j.canada_eligible),
      canadaReason: j.canada_eligible_reason || "",
      source: itemSource(j),
      updated: String(j.applied_at || j.discovered_at || "").slice(0, 10) || null,
      url: j.source_url || null,
      salary: salaryForJob(j, queue),
      links: jobLinks(j),
      history: readHistoryTail(j),
      liveness: null,
      buildRequestedAt: null,
      emailStatus: j.last_email_status || null,
      atsWinner: j.ats_winner || null,
      actions: ACTIONS_BY_STAGE[stage] || [],
      statusDetail: j.status_detail || "",
    });
  }

  for (const r of queue) {
    const wont = isWontApplyQueueRow(r);
    if (
      wont &&
      rows.some((row) => row.kind === "job" && (
        (r.co_slug === row.coSlug && r.job_slug === row.jobSlug) ||
        (r.promotion?.job_folder || "").replace(/\/$/, "") === `companies/${row.coSlug}/jobs/${row.jobSlug}`
      ))
    ) continue; // declined-after-staging renders once, as the folder row
    let stage;
    if (wont) stage = "wont";
    else if (r.queue_state === "evaluated" && r.recommendation === "skip") stage = "skip";
    else if (["evaluated", "recommended"].includes(r.queue_state)) stage = (Number(r.score) || 0) >= threshold ? "review-hi" : "review";
    else if (["staged", "built", "applied"].includes(r.queue_state)) stage = r.queue_state;
    else if (r.queue_state === "materials_ready") stage = "ready";
    else stage = "review";
    rows.push({
      kind: "queue",
      key: `#${r.id}`,
      id: String(r.id),
      coSlug: r.co_slug || null,
      jobSlug: r.job_slug || null,
      company: r.company || r.co_slug || "—",
      role: r.role || "—",
      stage,
      score: typeof r.score === "number" ? r.score : null,
      verdict: r.verdict || null,
      canada: normCanada(r.canada_eligible),
      canadaReason: r.canada_eligible_reason || "",
      source: itemSource(r),
      updated: String(r.evaluated_at || r.updated_at || "").slice(0, 10) || null,
      url: r.url || null,
      salary: extractSalary(r),
      links: { jd: r.url || null, report: r.report ? `../${r.report}` : null, folder: null, ats: null, final: null, pkg: null },
      history: [],
      liveness: r.liveness?.evidence || r.liveness?.reason || null,
      buildRequestedAt: r.build_requested ? (r.build_requested_at || "requested") : null,
      emailStatus: null,
      atsWinner: null,
      actions: ACTIONS_BY_STAGE[stage] || [],
      statusDetail: "",
    });
  }

  for (const p of pipelineRows) {
    rows.push({
      kind: "pending",
      key: p.url,
      id: null, coSlug: null, jobSlug: null,
      company: p.company || "—",
      role: p.role || "—",
      stage: "pending",
      score: null, verdict: null,
      canada: "unknown", canadaReason: "",
      source: p.source,
      updated: p.date || null,
      url: p.url,
      salary: null,
      links: { jd: p.url, report: null, folder: null, ats: null, final: null, pkg: null },
      history: [], liveness: null, buildRequestedAt: null, emailStatus: null, atsWinner: null,
      actions: [],
      statusDetail: p.duplicate_of ? `dup→${p.duplicate_of}` : "",
    });
  }

  const order = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i]));
  rows.sort((a, b) =>
    (order[a.stage] ?? 99) - (order[b.stage] ?? 99) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    String(b.updated || "").localeCompare(String(a.updated || ""))
  );
  return rows;
}

export function railCounts(rows) {
  const c = { pending: 0, "review-hi": 0, review: 0, skip: 0, staged: 0, built: 0, ready: 0, applied: 0, interviewing: 0, offer: 0, wont: 0, closed: 0 };
  for (const r of rows) if (c[r.stage] !== undefined) c[r.stage] += 1;
  return c;
}
