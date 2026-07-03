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
import { geoGate } from "./geo-gate.mjs";
import { normalizeOutcome, normalizeStage, stageDepthLabel, OUTCOME_BUCKET, OUTCOMES, stageRank, advanceStage } from "./outcome.mjs";
import { canonicalKey, hasCanonicalIdentity } from "./canonical.mjs";

// ---------- ATS platform detection ----------
// Classifies a job URL into its ATS platform. Tries external_apply_url first,
// then source_url. Used for sort + filter in the dashboard.
const ATS_PATTERNS = [
  { id: "greenhouse",     label: "Greenhouse",     re: /boards\.greenhouse\.io|job-boards\.greenhouse\.io/ },
  { id: "ashby",          label: "Ashby",           re: /jobs\.ashbyhq\.com/ },
  { id: "workday",        label: "Workday",         re: /myworkdayjobs\.com|wd\d*\.myworkdayjobs\.com/ },
  { id: "lever",          label: "Lever",           re: /jobs\.lever\.co/ },
  { id: "linkedin",       label: "LinkedIn",        re: /linkedin\.com\/jobs\/view\// },
  { id: "indeed",         label: "Indeed",          re: /indeed\.com\/viewjob|indeed\.com\/cmp\// },
  { id: "workable",       label: "Workable",        re: /apply\.workable\.com/ },
  { id: "smartrecruiters", label: "SmartRecruiters", re: /smartrecruiters\.com/ },
  { id: "bamboohr",       label: "BambooHR",        re: /bamboohr\.com\/careers/ },
  { id: "jobvite",        label: "Jobvite",         re: /jobs\.jobvite\.com/ },
  { id: "icims",          label: "ICIMS",           re: /icims\.com/ },
  { id: "wellfound",      label: "Wellfound",       re: /wellfound\.com\/jobs/ },
  { id: "breezy",         label: "Breezy",          re: /breezy\.hr/ },
  { id: "ultipro",        label: "UKG/UltiPro",     re: /ultipro\.com|ukg\.com/ },
  { id: "paylocity",      label: "Paylocity",       re: /paylocity\.com\/careers/ },
  { id: "adp",            label: "ADP",             re: /adp\.com\/careers|workforcenow\.adp\.com/ },
  { id: "oraclecloud",    label: "Oracle Cloud",    re: /oracle\.com\/careers|ceipal\.oracle\.com/ },
  { id: "dayforce",       label: "Dayforce/Ceridian", re: /dayforcehcm\.com|ceridian\.dayforcehcm\.com/ },
  { id: "beamery",        label: "Beamery",         re: /beamery\.com\/careers|jobs\.beamery\.com/ },
  { id: "pinpoint",       label: "Pinpoint",        re: /pinpointhq\.com/ },
  { id: "sapfiori",       label: "SAP Fiori",       re: /sap\.com\/careers|successfactors\.com/ },
  { id: "cornerstone",    label: "Cornerstone",     re: /cornerstoneondemand\.com\/careers/ },
];

export function atsPlatform(url) {
  if (!url) return { id: "other", label: "Other" };
  const u = String(url).toLowerCase();
  for (const p of ATS_PATTERNS) {
    if (p.re.test(u)) return { id: p.id, label: p.label };
  }
  return { id: "other", label: "Other" };
}

// Choose the best URL for ATS classification: external_apply_url beats source_url.
export function atsUrlForJob(j) {
  return j.external_apply_url || j.source_url || null;
}

// ---------- Outcome funnel ----------
// Reads `furthest_stage`/`outcome` and falls back to forward `status` for any rows
// not yet migrated, so it works during and after the backfill.
export function computeFunnel(jobs) {
  const reachedOf = (j) => {
    let s = normalizeStage(j.furthest_stage);
    if (j.status === "applied") s = advanceStage(s, "applied");
    if (j.status === "interviewing") s = advanceStage(s, "interviewing");
    if (j.status === "offer") s = advanceStage(s, "offer");
    if (normalizeOutcome(j.outcome) === "rejected" || /rejected/.test(j.status_detail || "")) s = advanceStage(s, "applied");
    return s;
  };
  const applied = (jobs || []).filter((j) => stageRank(reachedOf(j)) >= stageRank("applied"));
  const reach = (st) => applied.filter((j) => stageRank(reachedOf(j)) >= stageRank(st)).length;
  const counts = { applied: applied.length, interviewing: reach("interviewing"), final: reach("final"), offer: reach("offer") };
  const outcomeCounts = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  const rejDepth = { applied: 0, interviewing: 0, final: 0, offer: 0 };
  for (const j of applied) {
    const o = normalizeOutcome(j.outcome);
    if (o) outcomeCounts[o] += 1;
    if (o === "rejected") rejDepth[reachedOf(j)] = (rejDepth[reachedOf(j)] || 0) + 1;
  }
  return { counts, outcomeCounts, rejDepth, total: applied.length };
}

// Map a job to its dashboard rail bucket. A terminal `outcome` (rejected/withdrew/
// declined/expired/offer/…) wins; otherwise fall back to the live forward status.
function jobStage(j) {
  const oc = normalizeOutcome(j.outcome);
  if (oc && OUTCOME_BUCKET[oc]) return OUTCOME_BUCKET[oc];
  if (j.status === "closed" && isWontApplyDetail(j.status_detail)) return "wont";
  if (j.status === "materials_ready") return "ready";
  return j.status;
}

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
        ? `Resume engine usage (last ${windowDays} days): no Lin-managed applications in window`
        : `Resume engine usage (last 4 weeks): PATHFINDER ${tally.pathfinder}/${total} (${pct(
            tally.pathfinder
          )}), FORGE ${tally.forge}/${total} (${pct(tally.forge)}) — last packaged: ${lastWinnerLine}`,
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
  return ({ portal: "Portal", linkedin: "LinkedIn", indeed: "Indeed", gmail: "Gmail", manual: "Manual" })[normalizeSource(source)];
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
  const posted_date = /(?:^|[\s|])posted=(\d{4}-\d{2}-\d{2})/.exec(tail)?.[1] || null;
  return { date, company, role, url, source, duplicate_of, canonical_key, posted_date };
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

// Annual pay number from a free-text salary string, or -1 when untrustworthy.
// Handles the "$120-160k" trap (k sits on the 2nd number) and rejects hourly /
// shorthand numbers (< 1000) we can't safely bucket.
export function payNumber(str) {
  if (!str) return -1;
  const m = String(str).match(/\d[\d,]*/);
  if (!m) return -1;
  let n = parseInt(m[0].replace(/,/g, ""), 10);
  if (Number.isNaN(n)) return -1;
  if (/\d\s*[kK]/.test(str) && n < 1000) n *= 1000; // a k anywhere → the leading number is in thousands
  return n < 1000 ? -1 : n;
}

// Bucket pay into Score-like tiers. num is the sort key (-1 = unknown, sorts last).
export function payTier(salaryStr) {
  const num = payNumber(salaryStr);
  if (num < 0) return { tier: "unknown", label: "—", num: -1 };
  if (num < 120000) return { tier: "low", label: "<120", num };
  if (num < 160000) return { tier: "mid", label: "120–160", num };
  if (num < 200000) return { tier: "high", label: "160–200", num };
  return { tier: "top", label: "200k+", num };
}

// Freshness from a real posted_date when present, else discovered_at ("seen").
// Buckets: d1 (<1d) · d7 (<7d) · d30 (<30d) · old (30d+) · none (unknown).
export function recencyOf({ posted_date, discovered_at } = {}, today = new Date()) {
  const pick = posted_date ? { date: posted_date, source: "posted" }
    : discovered_at ? { date: discovered_at, source: "seen" } : null;
  if (!pick) return { days: -1, bucket: "none", source: null, label: "—" };
  const d = new Date(pick.date);
  if (Number.isNaN(d.getTime())) return { days: -1, bucket: "none", source: null, label: "—" };
  const days = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
  const bucket = days < 1 ? "d1" : days < 7 ? "d7" : days < 30 ? "d30" : "old";
  const label = `${pick.source} ${days === 0 ? "today" : days + "d"}`;
  return { days, bucket, source: pick.source, label };
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
    cover: (j.cover_winner && existsRel(`${f}covers/${j.cover_winner}.pdf`)) ? `../${f}covers/${j.cover_winner}.pdf` : null,
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
  review: ["prepare", "wont"],
  skip: ["prepare", "wont"], // superuser override: even sub-3.0 SKIP rows are Preparable (geo-blocked ones get the ⚠ confirm)
  staged: ["wont"],
  built: ["wont"],
  ready: ["apply", "wont"],
  applied: ["wont-rejected"],
};

export const STAGE_ORDER = ["pending", "review-hi", "review", "staged", "built", "ready", "applied", "interviewing", "offer", "withdrew", "declined", "rejected", "expired", "wont", "closed", "skip"];

// ---------- render-time duplicate collapse ----------
// The dashboard is a union of three independently-keyed sources (job folders,
// the evaluation queue, the pending pipeline). The same real job can therefore
// appear 2–3× under different keys (a Greenhouse multi-posting, a cross-source
// rediscovery, a re-scan that minted a new #id). We collapse rows that share a
// canonical company::role into one PRIMARY row and hang the siblings off it for
// the expander. This is purely a render decision — no data file is touched, and
// every sibling stays inspectable, so nothing is lost and it's fully reversible.

// An actual job folder is the authoritative record; then a scored queue row;
// then a raw pending row.
const KIND_RANK = { job: 2, queue: 1, pending: 0 };
// How decisive a dashboard stage is, for tie-breaking within the same kind.
// Post-application outcomes (rejected/declined/withdrew) outrank pre-apply review
// because they describe a more advanced, settled truth about the role.
const STAGE_PRIMACY = {
  offer: 100, interviewing: 90, applied: 80, ready: 70, built: 60, staged: 50,
  rejected: 78, declined: 78, withdrew: 78, expired: 64,
  "review-hi": 40, review: 30, pending: 20, wont: 12, closed: 11, skip: 10,
};

function primacyTuple(r) {
  return [KIND_RANK[r.kind] ?? 0, STAGE_PRIMACY[r.stage] ?? 0, r.score ?? -1, r.updated || ""];
}

// True when `a` should be preferred over `b` as the surviving primary row.
function morePrimary(a, b) {
  const ta = primacyTuple(a), tb = primacyTuple(b);
  for (let i = 0; i < 3; i++) if (ta[i] !== tb[i]) return ta[i] > tb[i];
  return String(ta[3]).localeCompare(String(tb[3])) >= 0; // newer `updated` wins
}

export function collapseDuplicates(rows) {
  const groups = new Map();
  for (const r of rows) {
    const ck = canonicalKey(r.company, r.role);
    // Only merge when identity is real on BOTH sides. A degenerate key (blank
    // company or blank role → "::", "acme::", "::pm") must never merge unrelated
    // rows, so those fall back to per-row uniqueness.
    const gk = hasCanonicalIdentity(ck) ? ck : `__uniq__:${r.kind}:${r.key}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(r);
  }
  const out = [];
  for (const members of groups.values()) {
    if (members.length === 1) { out.push(members[0]); continue; }
    let primary = members[0];
    for (const m of members.slice(1)) if (morePrimary(m, primary)) primary = m;
    const siblings = members.filter((m) => m !== primary);
    primary.dupCount = siblings.length;
    primary.dupSiblings = siblings.map((s) => ({
      key: s.key, id: s.id, kind: s.kind, stage: s.stage,
      source: s.source, url: s.url, score: s.score, updated: s.updated,
    }));
    out.push(primary);
  }
  return out;
}

export function buildRows({ jobs, queue, pipelineRows }) {
  const threshold = CFG.promote_threshold;
  const rows = [];

  for (const j of jobs) {
    const stage = jobStage(j);
    const furthestStage = normalizeStage(j.furthest_stage);
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
      geoBlocked: geoGate(j).blocked,
      geoReason: geoGate(j).displayReason,
      source: itemSource(j),
      updated: String(j.applied_at || j.discovered_at || "").slice(0, 10) || null,
      url: j.source_url || null,
      salary: salaryForJob(j, queue),
      pay: payTier(salaryForJob(j, queue)),
      recency: recencyOf({ posted_date: j.posted_date, discovered_at: j.discovered_at }),
      ats: atsPlatform(atsUrlForJob(j)),
      links: jobLinks(j),
      history: readHistoryTail(j),
      liveness: null,
      livenessResult: null,
      buildRequestedAt: null,
      emailStatus: j.last_email_status || null,
      atsWinner: j.ats_winner || null,
      coverWinner: j.cover_winner || null,
      coverRequired: j.cover_required === true,
      outcome: normalizeOutcome(j.outcome),
      furthestStage,
      depthLabel: stageDepthLabel(furthestStage),
      actions: ACTIONS_BY_STAGE[stage] || [],
      statusDetail: j.status_detail || "",
      buildModel: j.build_model || null,
      buildProvider: j.build_provider || null,
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
    else if (["closed", "duplicate", "error"].includes(r.queue_state)) stage = "closed";
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
      geoBlocked: geoGate(r).blocked,
      geoReason: geoGate(r).displayReason,
      source: itemSource(r),
      updated: String(r.evaluated_at || r.updated_at || "").slice(0, 10) || null,
      url: r.url || null,
      salary: extractSalary(r),
      pay: payTier(extractSalary(r)),
      recency: recencyOf({ posted_date: r.posted_date, discovered_at: r.discovered_at }),
      ats: atsPlatform(r.url),
      links: { jd: r.url || null, report: r.report ? `../${r.report}` : null, folder: null, ats: null, final: null, pkg: null },
      history: [],
      liveness: r.liveness?.evidence || r.liveness?.reason || null,
      livenessResult: r.liveness?.result || null,
      buildRequestedAt: r.build_requested ? (r.build_requested_at || "requested") : null,
      emailStatus: null,
      atsWinner: null,
      actions: ACTIONS_BY_STAGE[stage] || [],
      statusDetail: "",
      buildModel: r.build_model || null,
      buildProvider: r.build_provider || null,
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
      geoBlocked: false, geoReason: "",
      source: p.source,
      updated: p.date || null,
      url: p.url,
      salary: null,
      pay: payTier(null),
      recency: recencyOf({ posted_date: p.posted_date, discovered_at: p.date }),
      ats: atsPlatform(p.url),
      links: { jd: p.url, report: null, folder: null, ats: null, final: null, pkg: null },
      history: [], liveness: null, livenessResult: null, buildRequestedAt: null, emailStatus: null, atsWinner: null,
      actions: [],
      statusDetail: p.duplicate_of ? `dup→${p.duplicate_of}` : "",
    });
  }

  const collapsed = collapseDuplicates(rows);
  const order = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i]));
  collapsed.sort((a, b) =>
    (order[a.stage] ?? 99) - (order[b.stage] ?? 99) ||
    (b.score ?? -1) - (a.score ?? -1) ||
    String(b.updated || "").localeCompare(String(a.updated || ""))
  );
  return collapsed;
}

export function railCounts(rows) {
  const c = { pending: 0, "review-hi": 0, review: 0, skip: 0, staged: 0, built: 0, ready: 0, applied: 0, interviewing: 0, offer: 0, withdrew: 0, declined: 0, rejected: 0, expired: 0, wont: 0, closed: 0 };
  for (const r of rows) if (c[r.stage] !== undefined) c[r.stage] += 1;
  return c;
}
