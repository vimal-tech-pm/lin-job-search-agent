#!/usr/bin/env node
/**
 * lin-promote-evaluations.mjs — turn `data/evaluation-queue.json` rows into
 * `companies/{co}/jobs/{slug}/` folders that the Lin skill + tracker understand.
 *
 * Inputs:
 *   --dry-run                  read-only: list candidates + would-do actions
 *   --threshold=<float>        min score for batch selection (default: career-profile/pipeline-config.json promote_threshold, fallback 4.2)
 *   --id=<NNN>                 promote a single queue entry (overrides batch)
 *   --limit=<int>              cap on entries promoted per run
 *   --list-candidates          read-only: print candidates for Hermes browser liveness
 *   --json                     with --list-candidates, emit machine-readable JSON only
 *   --liveness-file=<path>     JSON produced by Hermes browser_navigate liveness checks
 *
 * Pipeline per role:
 *   1. liveness check is supplied externally by the Hermes agent after sequential
 *      browser_navigate checks. This script does not launch Playwright/Chromium
 *      for liveness; missing liveness defaults to uncertain/hold.
 *      IMPORTANT: "active" means an application path was verified, not merely
 *      that stale JD text is visible on LinkedIn/search-cache pages.
 *   2. active  → create folder, write job.yml/job.md/status-history.md, copy
 *      report → pathfinder-eval.md, queue.queue_state = 'staged'
 *   3. expired → queue.queue_state = 'closed', record reason; no folder
 *   4. uncertain/error → no folder; queue stays 'recommended' with error note
 *
 * Auto selection skips geo_gate.blocks_stage=true before top-N slicing so
 * blocked rows do not consume slots. Explicit --id/build_requested rows bypass
 * the geo gate and are logged as human overrides.
 *
 * Dry-run gate: every mutation goes through `if (!isDryRun) …`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoGate } from "./lib/geo-gate.mjs";
import { canonicalKey } from "./lib/canonical.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");
const QUEUE_PATH = path.join(VAULT, "data", "evaluation-queue.json");
const CONFIG_PATH = path.join(VAULT, "career-profile", "pipeline-config.json");

const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");
const LIST_CANDIDATES = argv.includes("--list-candidates");
const JSON_OUTPUT = argv.includes("--json");
const TOP_PREPARE = argv.includes("--top-prepare");
const AUTO = argv.includes("--auto"); // hybrid selection: top-N ≥ auto_build_floor ∪ build_requested rows
const argVal = (k) => {
  const a = argv.find((x) => x.startsWith(`${k}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
// Source channel → job.yml discovered_via. Keeps provenance alive after the
// queue row is filtered out of the dashboard at promotion.
const DISCOVERED_VIA = {
  portal: "pathfinder-scan",
  gmail: "gmail-scan",
  linkedin: "linkedin-scan",
  indeed: "indeed-scan",
  manual: "intake-manual",
};
function discoveredViaFor(source) {
  return DISCOVERED_VIA[source] || "pathfinder-scan";
}

// --- slugify + normalizeTitle (shared with lin-discovery-append.mjs) ---
function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function normalizeTitle(title) {
  return String(title ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[-–—,|]+\s*$/g, "")
    .trim()
    .toLowerCase();
}

function readPipelineConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { promote_threshold: 4.2, promote_limit: 0, top_prepare_cap: 10, auto_build_floor: 4.2, auto_build_top_n: 3 };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const threshold = Number(cfg.promote_threshold ?? 4.2);
    const limit = Number(cfg.promote_limit ?? 0);
    const topPrepareCap = Number(cfg.daily?.top_prepare_cap ?? cfg.top_prepare_cap ?? 10);
    const autoFloor = Number(cfg.auto_build_floor ?? 4.2);
    const autoTopN = Number(cfg.auto_build_top_n ?? 3);
    return {
      promote_threshold: Number.isFinite(threshold) ? threshold : 4.2,
      promote_limit: Number.isFinite(limit) ? limit : 0,
      top_prepare_cap: Number.isFinite(topPrepareCap) ? topPrepareCap : 10,
      auto_build_floor: Number.isFinite(autoFloor) ? autoFloor : 4.2,
      auto_build_top_n: Number.isFinite(autoTopN) ? autoTopN : 3,
    };
  } catch (err) {
    console.error(`Cannot parse ${CONFIG_PATH}: ${err.message}`);
    process.exit(1);
  }
}
const PIPELINE_CONFIG = readPipelineConfig();

const THRESHOLD = parseFloat(argVal("--threshold") ?? String(PIPELINE_CONFIG.promote_threshold));
const LIMIT = parseInt(
  argVal("--limit") ?? String(TOP_PREPARE ? PIPELINE_CONFIG.top_prepare_cap : (PIPELINE_CONFIG.promote_limit || 0)),
  10,
);
const ONLY_ID = argVal("--id");
const LIVENESS_FILE = argVal("--liveness-file");
const selectionStats = { autoGeoBlockedSkipped: 0 };

// ----- queue I/O -----

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) {
    console.error(`Missing ${QUEUE_PATH}; run lin-evaluation-queue.mjs migrate first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
}

function writeQueue(q) {
  q.generated_at = new Date().toISOString();
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2) + "\n");
}

// ----- tracker dedup -----
// Parse engines/pathfinder/data/applications.md and build a set of
// canonical keys for roles already marked "Applied". This prevents
// re-staging roles that were already applied to (the scan re-injects
// them because dedup only checks pipeline.md, not the tracker).
const TRACKER_PATH = path.join(VAULT, "engines", "pathfinder", "data", "applications.md");
let _appliedKeys = null;

function getAppliedKeys() {
  if (_appliedKeys !== null) return _appliedKeys;
  _appliedKeys = new Set();
  if (!fs.existsSync(TRACKER_PATH)) return _appliedKeys;
  const lines = fs.readFileSync(TRACKER_PATH, "utf8").split("\n");
  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| #") || line.startsWith("|--")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 6) continue;
    const company = parts[3];
    const role = parts[4];
    const status = parts[5];
    if (!company || !role || !status) continue;
    // Block re-staging for roles already applied OR closed/expired
    if (!/applied|closed|expired|wont|skip|reject/i.test(status)) continue;
    const key = `${slugify(company)}::${slugify(normalizeTitle(role))}`;
    _appliedKeys.add(key);
  }
  return _appliedKeys;
}

function isAlreadyApplied(role) {
  // role.job_title is often null; the title lives in role.role
  const title = role?.job_title || role?.role || "";
  if (!role?.company || !title) return false;
  const key = `${slugify(role.company)}::${slugify(normalizeTitle(title))}`;
  return getAppliedKeys().has(key);
}

// ----- selection -----

function existingJobFolderRel(role) {
  if (!role?.co_slug || !role?.job_slug) return null;
  const folderRel = path.posix.join("companies", role.co_slug, "jobs", role.job_slug);
  const folderAbs = path.join(VAULT, "companies", role.co_slug, "jobs", role.job_slug);
  return fs.existsSync(folderAbs) ? folderRel : null;
}

function parseSimpleJobYml(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function existingJobFolderState(role) {
  const rel = existingJobFolderRel(role);
  if (!rel) return { rel: null, status: null, ats_winner: null, state: null, materialsReady: false };
  const ymlPath = path.join(VAULT, rel, "job.yml");
  const yml = fs.existsSync(ymlPath) ? parseSimpleJobYml(fs.readFileSync(ymlPath, "utf8")) : {};
  const status = String(yml.status || "").trim();
  const atsWinner = String(yml.ats_winner || "").trim();
  const hasWinner = Boolean(atsWinner && atsWinner !== "null" && atsWinner !== "~");
  const gatePass = fs.existsSync(path.join(VAULT, rel, "resumes", "gate-pass.json"));
  // staged → built → ready: built needs gate evidence, not just artifacts.
  const state = (status === "materials_ready" || hasWinner) ? "ready" : (gatePass ? "built" : "staged");
  return {
    rel,
    status,
    ats_winner: atsWinner || null,
    state,
    materialsReady: state === "ready",
  };
}

function isPromotionSelectable(role) {
  if (!role || role.promotion?.job_folder || existingJobFolderRel(role)) return false;
  if (["staged", "materials_ready", "applied", "skipped", "closed", "duplicate", "error"].includes(role.queue_state)) return false;
  if (role.recommendation === "skip" || role.recommendation === "manual_override") return false;
  if (isAlreadyApplied(role)) return false;
  return ["recommended", "evaluated"].includes(role.queue_state);
}

function isTopPrepareSelectable(role) {
  if (!role) return false;
  if (["materials_ready", "applied", "skipped", "closed", "duplicate", "error"].includes(role.queue_state)) return false;
  if (role.recommendation === "skip" || role.recommendation === "manual_override") return false;
  if (promotionBlock(role).blocked) return false;
  if (!Number.isFinite(Number(role.score))) return false;
  if (existingJobFolderState(role).materialsReady) return false;
  if (isAlreadyApplied(role)) return false;
  return ["recommended", "evaluated", "staged"].includes(role.queue_state);
}

function shouldBypassPromotionBlock(role) {
  return Boolean(ONLY_ID || role?.__selected_by === "build_requested");
}

function pickCandidates(queue) {
  selectionStats.autoGeoBlockedSkipped = 0;
  const selectable = (queue.roles || []).filter(TOP_PREPARE ? isTopPrepareSelectable : isPromotionSelectable);
  if (ONLY_ID) {
    const hit = selectable.find((r) => r.id === ONLY_ID);
    if (hit) hit.__selected_by = "manual-id";
    return hit ? [hit] : [];
  }
  let pool;
  if (AUTO) {
    // Hybrid trigger (design §5): the day's top auto_build_top_n applyable rows by score
    // (geo-blocked excluded — no point auto-preparing roles you can't apply to). The
    // intent of top-N is to keep ~N submit-ready packages on hand daily; auto_build_floor
    // is just an absolute junk cutoff, not a per-day cap.
    // PLUS every build_requested row regardless of score — an explicit Prepare click is
    // the superuser's decision and overrides both the score floor and the geo gate.
    const byScore = [...selectable].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const floorPool = byScore.filter((r) => (Number(r.score) || 0) >= PIPELINE_CONFIG.auto_build_floor);
    const autoEligible = floorPool.filter((r) => !promotionBlock(r).blocked);
    selectionStats.autoGeoBlockedSkipped = floorPool.length - autoEligible.length;
    const autoTop = autoEligible.slice(0, PIPELINE_CONFIG.auto_build_top_n);
    for (const r of autoTop) r.__selected_by = "auto-top-n";
    const requested = byScore.filter(
      (r) => r.build_requested === true && !autoTop.includes(r),
    );
    for (const r of requested) r.__selected_by = "build_requested";
    pool = [...autoTop, ...requested].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  } else if (TOP_PREPARE) {
    pool = selectable
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  } else {
    pool = selectable.filter((r) => (r.score ?? 0) >= THRESHOLD);
    pool.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  if (LIMIT > 0) pool = pool.slice(0, LIMIT);
  return pool;
}

function promotionBlock(role) {
  // The blocked DECISION lives in lib/geo-gate.mjs (shared with the dashboard so
  // the two can't drift). Reason strings stay here — they're recorded verbatim in
  // queue demote notes and must keep their existing internal format.
  const g = geoGate(role);
  if (g.cause === "geo") {
    return { blocked: true, reason: role.geo_gate.reason || "geo_gate blocks_stage=true" };
  }
  if (g.cause === "canada") {
    return { blocked: true, reason: role.canada_eligible_reason || "canada_eligible=no" };
  }
  return { blocked: false, reason: "" };
}

function candidatePayload(role) {
  const folder = existingJobFolderState(role);
  const block = promotionBlock(role);
  const bypassesBlock = block.blocked && shouldBypassPromotionBlock(role);
  return {
    id: role.id,
    company: role.company,
    company_slug: role.co_slug,
    title: role.role,
    job_slug: role.job_slug,
    score: role.score,
    source_url: role.url,
    external_apply_url: role.external_apply_url || null,
    queue_state: role.queue_state,
    canada_eligible: role.canada_eligible || "unknown",
    canada_eligible_reason: role.canada_eligible_reason || "",
    geo_gate_bypassed: bypassesBlock || undefined,
    geo_gate_reason: bypassesBlock ? block.reason : undefined,
    source: role.source || "portal",
    job_folder: folder.rel,
    folder_state: folder.state,
    needs_promotion: !folder.rel,
    selected_by: role.__selected_by || null,
  };
}

// ----- liveness -----

function normalizeLivenessStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (["active", "live", "open"].includes(s)) return "active";
  if (["expired", "closed", "inactive", "dead"].includes(s)) return "expired";
  return "uncertain";
}

function readLivenessResults(filePath) {
  if (!filePath) return new Map();
  if (!fs.existsSync(filePath)) {
    console.error(`Missing liveness file: ${filePath}`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`Invalid liveness JSON at ${filePath}: ${err.message}`);
    process.exit(1);
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) ? parsed.results : [];
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id || row.role_id || "").trim();
    if (!id) continue;
    let result = normalizeLivenessStatus(row.status ?? row.result);
    const applyPathFound =
      row.apply_path_found ?? row.has_apply_path ?? row.applyPathFound ?? row.apply_path ?? null;
    const checkedUrl = row.checked_url || row.url || row.source_url || null;
    const checkedBy = row.checked_by || parsed.checked_by || "hermes-browser";
    // Did the apply form ask for a cover letter? Recorded by the stage agent while it
    // inspects the application page during liveness; threaded into job.yml.cover_required
    // so finalize can auto-generate one. Conservative: true only when clearly observed.
    const coverRequired =
      (row.cover_required ?? row.cover_field_found ?? row.coverRequired ?? false) === true;
    let reason = row.evidence || row.reason || row.message || "external liveness result supplied";

    // LinkedIn often leaves stale JD text visible after the job stops accepting
    // applications. Do not let "JD visible" count as live unless an Apply/Easy Apply
    // path was explicitly observed by the browser worker.
    if (result === "active" && applyPathFound === false) {
      result = "expired";
      reason = `${reason}; no application path found`;
    } else if (
      result === "active" &&
      checkedUrl &&
      /linkedin\.com\/jobs\/view\//i.test(checkedUrl) &&
      applyPathFound !== true
    ) {
      result = "uncertain";
      reason = `${reason}; LinkedIn JD visible but apply path not explicitly verified`;
    } else if (
      result === "active" &&
      /stored-jd|queue snapshot|jd-only/i.test(String(checkedBy)) &&
      applyPathFound !== true
    ) {
      result = "uncertain";
      reason = `${reason}; stored JD is enough for resume content but not application liveness`;
    }

    byId.set(id, {
      result,
      reason,
      checked_at: row.checked_at || new Date().toISOString(),
      checked_url: checkedUrl,
      checked_by: checkedBy,
      apply_path_found: applyPathFound,
      cover_required: coverRequired,
    });
  }
  return byId;
}

function checkExternalLiveness(role, livenessById) {
  const hit = livenessById.get(String(role.id));
  if (!hit) {
    return {
      result: "uncertain",
      reason: LIVENESS_FILE ? "no external liveness result supplied" : "no external liveness file supplied",
      checked_by: "hermes-browser",
      checked_at: new Date().toISOString(),
    };
  }
  return hit;
}

// ----- JD helpers -----

function resolveJdSnapshot(role) {
  const rel = role.jd_path || role.jd_snapshot || null;
  if (!rel) return { text: null, source: null };
  const val = String(rel);
  // Current queue entries store jd_snapshot/jd_path as a relative file path.
  if (/^jds\//.test(val)) {
    const abs = path.join(VAULT, val);
    if (fs.existsSync(abs)) {
      return { text: fs.readFileSync(abs, "utf8"), source: val };
    }
    return { text: null, source: `${val} (missing)` };
  }
  // Backward compatibility for older queue rows that embedded JD text directly.
  return { text: val, source: "queue embedded snapshot" };
}

// ----- JD fetch (used only when role has no usable jd_snapshot) -----

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(h\d|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchJd(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "lin-promote-evaluations/1.0" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      try {
        const data = JSON.parse(m[1].trim());
        const list = Array.isArray(data) ? data : [data];
        for (const d of list) {
          if (d["@type"] === "JobPosting" && d.description) {
            const text = htmlToText(String(d.description));
            if (text.length > 200) return { ok: true, text, source: "json-ld" };
          }
        }
      } catch {}
    }
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
    const text = htmlToText(body);
    if (text.length > 200) return { ok: true, text, source: "body-strip" };
    return { ok: false, error: "extracted text too short" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ----- URL helpers -----

// about:link-XXX placeholders come from the LinkedIn scanner when it can't
// extract the real URL from the page. Resolve them from available sources
// in priority order: liveness checked_url → jd_eval JSON → fallback.
const PLACEHOLDER_RE = /^about:/i;

function resolveUrl(role) {
  const raw = role.url || "";
  if (!PLACEHOLDER_RE.test(raw)) return raw;
  
  // 1) Liveness check result — the browser worker found the real URL
  if (role.liveness?.checked_url && !PLACEHOLDER_RE.test(role.liveness.checked_url)) {
    console.log(`[url-resolve] #${role.id} placeholder ${raw} → ${role.liveness.checked_url} (from liveness)`);
    return role.liveness.checked_url;
  }
  
  // 2) jd_eval_{id}.json — the evaluation wrote the real job_url there
  const jdEvalPath = path.join(VAULT, `jd_eval_${role.id}.json`);
  if (fs.existsSync(jdEvalPath)) {
    try {
      const jdEval = JSON.parse(fs.readFileSync(jdEvalPath, "utf8"));
      const jobUrl = jdEval.job_url || jdEval.source_url || jdEval.url || "";
      if (jobUrl && !PLACEHOLDER_RE.test(jobUrl)) {
        console.log(`[url-resolve] #${role.id} placeholder ${raw} → ${jobUrl} (from jd_eval)`);
        return jobUrl;
      }
    } catch {}
  }
  
  // 3) Report file — contains the posting URL in some cases
  if (role.report) {
    const reportPath = path.join(VAULT, role.report);
    if (fs.existsSync(reportPath)) {
      const reportText = fs.readFileSync(reportPath, "utf8");
      const urlMatch = reportText.match(/https?:\/\/[^\s"')\]]{10,500}/);
      if (urlMatch) {
        const reportUrl = urlMatch[0].replace(/[)\]\.,;]+$/, "");
        if (!PLACEHOLDER_RE.test(reportUrl)) {
          console.log(`[url-resolve] #${role.id} placeholder ${raw} → ${reportUrl} (from report)`);
          return reportUrl;
        }
      }
    }
  }
  
  return raw;
}

function isPlaceholderUrl(url) {
  return PLACEHOLDER_RE.test(String(url || ""));
}

// ----- writers -----

function ymlEscape(v) {
  if (v == null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  // quote if it contains :, #, leading -, or special chars
  if (/[:#"'\n]/.test(s) || /^\s|\s$/.test(s) || /^-/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function renderJobYml(role) {
  const today = new Date().toISOString().slice(0, 10);
  const resolvedUrl = resolveUrl(role);
  const lines = [
    `job_slug: ${role.job_slug}`,
    `company_slug: ${role.co_slug}`,
    `title: ${ymlEscape(role.role)}`,
    `location: ${ymlEscape(role.location || "Not specified")}`,
    `source_url: ${resolvedUrl}`,
    `discovered_via: ${discoveredViaFor(role.source || "portal")}`,
    `discovered_at: ${role.discovered_at || today}`,
    `posted_date: ${/^\d{4}-\d{2}-\d{2}/.test(String(role.posted_date ?? "")) ? String(role.posted_date).slice(0, 10) : "null"}`,
    `status: staged`,
    `pathfinder_score: ${role.score}`,
    `pathfinder_verdict: ${ymlEscape(role.verdict || "")}`,
    `pathfinder_report: pathfinder-eval.md`,
    `ats_winner: null`,
    `cover_required: ${role.cover_required === true}`,
    `canada_eligible: ${role.canada_eligible || "unknown"}`,
    `canada_eligible_reason: ${ymlEscape(role.canada_eligible_reason || "")}`,
    // Source provenance — carried through from the queue so the tracker can
    // badge promoted kanban cards by channel.
    `source_channel: ${role.source || "portal"}`,
    `source_duplicate_of: ${ymlEscape(role.duplicate_of || "")}`,
    `source_canonical_key: ${ymlEscape(role.canonical_key || "")}`,
    `artifacts:`,
    `  evaluation_pdf: ${role.pdf || "null"}`,
  ];
  return lines.join("\n") + "\n";
}

function renderJobMd(role, jdText, jdSource) {
  const resolvedUrl = resolveUrl(role);
  const evalSummary = [
    `**PATHFINDER score:** ${role.score}/5`,
    `**Verdict:** ${role.verdict || "—"}`,
    `**Report:** see \`pathfinder-eval.md\``,
    role.keywords?.length ? `**Keywords:** ${role.keywords.join(", ")}` : null,
    role.location ? `**Location:** ${role.location}` : null,
    role.remote_signal ? `**Remote signal:** ${role.remote_signal}` : null,
  ].filter(Boolean).join("\n");

  return [
    `# ${role.company} — ${role.role}`,
    "",
    `**Source URL:** ${resolvedUrl}`,
    `**Captured:** ${new Date().toISOString().slice(0, 10)} (via lin-promote-evaluations)`,
    "",
    "## Evaluation summary",
    "",
    evalSummary,
    "",
    "---",
    "",
    `## Raw JD (${jdSource || "snapshot"})`,
    "",
    jdText || "_(no JD captured — re-run after capturing snapshot or use `/lin intake <url>`)_",
    "",
  ].join("\n");
}

function renderStatusHistory(role) {
  const iso = new Date().toISOString();
  return [
    `# Status history — ${role.co_slug}/${role.job_slug}`,
    "",
    "<!-- Append-only. One row per transition. Format: ISO8601<TAB>status<TAB>note -->",
    "",
    `${iso}\tnew\tpromoted from evaluation queue #${role.id} (score ${role.score}, liveness=active)`,
    "",
  ].join("\n");
}

// ----- main -----

async function main() {
  const queue = readQueue();
  const picks = pickCandidates(queue);

  if (LIST_CANDIDATES) {
    const candidates = picks.filter((role) => !promotionBlock(role).blocked || shouldBypassPromotionBlock(role)).map(candidatePayload);
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({
        selection_mode: AUTO ? "auto" : TOP_PREPARE ? "top_prepare" : "threshold",
        threshold: TOP_PREPARE ? null : THRESHOLD,
        auto_build_floor: AUTO ? PIPELINE_CONFIG.auto_build_floor : undefined,
        auto_build_top_n: AUTO ? PIPELINE_CONFIG.auto_build_top_n : undefined,
        geo_blocked_auto_skipped: AUTO ? selectionStats.autoGeoBlockedSkipped : undefined,
        limit: LIMIT || null,
        candidates,
      }, null, 2));
    } else {
      const label = AUTO ? `auto (top-${PIPELINE_CONFIG.auto_build_top_n} ≥ ${PIPELINE_CONFIG.auto_build_floor} + requested)` : TOP_PREPARE ? "top-prepare" : `threshold=${THRESHOLD}`;
      console.log(`lin-promote-evaluations candidates — ${label}${LIMIT ? `, limit=${LIMIT}` : ""}`);
      if (AUTO) console.log(`Geo-blocked auto-skipped: ${selectionStats.autoGeoBlockedSkipped}`);
      if (!candidates.length) console.log("No candidates matched.");
      for (const c of candidates) {
        const override = c.geo_gate_bypassed ? ` — geo override: ${c.geo_gate_reason}` : "";
        console.log(`#${c.id} ${c.company} / ${c.job_slug} — ${c.score}/5 — ${c.source_url}${override}`);
      }
    }
    return;
  }

  const livenessById = readLivenessResults(LIVENESS_FILE);

  console.log(
    `lin-promote-evaluations — ${isDryRun ? "DRY-RUN" : "LIVE"} — ` +
      `${TOP_PREPARE ? "top-prepare" : `threshold=${THRESHOLD}`}${ONLY_ID ? `, id=${ONLY_ID}` : ""}${LIMIT ? `, limit=${LIMIT}` : ""}`,
  );
  if (LIVENESS_FILE) {
    console.log(`[liveness] using external liveness file: ${LIVENESS_FILE}`);
  } else {
    console.log("[liveness] no external liveness file supplied; candidates default to uncertain/hold");
  }
  if (!picks.length) {
    console.log("No candidates matched.");
    return;
  }

  let mutated = false;

  for (const role of picks) {
    const tag = `#${role.id} ${role.company} / ${role.job_slug}`;
    const existingFolder = existingJobFolderState(role);
    if (TOP_PREPARE && existingFolder.rel) {
      console.log(`[ready] ${tag} — already staged at ${existingFolder.rel}; no promotion needed`);
      continue;
    }

    // Geo/Canada gate — auto/threshold promotions are blocked, but explicit
    // human requests (--id or build_requested) intentionally bypass the gate.
    const block = promotionBlock(role);
    if (block.blocked && !shouldBypassPromotionBlock(role)) {
      console.log(`[skip] ${tag} — promotion blocked (${block.reason}); would demote to review`);
      if (!isDryRun) {
        role.queue_state = "evaluated";
        role.recommendation = "review";
        role.notes = [...(role.notes || []), `${new Date().toISOString()} demoted: ${block.reason}`];
        mutated = true;
      }
      continue;
    }
    if (block.blocked) {
      console.log(`[override] ${tag} — building despite geo gate (${block.reason}) via ${role.__selected_by || "manual"}`);
    }

    console.log(`[liveness] ${tag} — external browser result for ${role.url}`);
    const live = checkExternalLiveness(role, livenessById);
    console.log(`           → ${live.result}: ${live.reason}`);

    if (!isDryRun) {
      role.liveness = {
        checked_at: live.checked_at || new Date().toISOString(),
        result: live.result,
        reason: live.reason,
        checked_url: live.checked_url || role.url,
        checked_by: live.checked_by || "hermes-browser",
      };
      // Carried into job.yml.cover_required so finalize can auto-generate a cover.
      role.cover_required = live.cover_required === true;
      mutated = true;
    }

    if (live.result === "expired") {
      console.log(`[closed] ${tag} — queue_state → closed`);
      if (!isDryRun) {
        role.queue_state = "closed";
        role.notes = [...(role.notes || []), `${new Date().toISOString()} closed: liveness expired (${live.reason})`];
      }
      continue;
    }

    if (live.result !== "active") {
      console.log(`[hold] ${tag} — liveness ${live.result}; queue unchanged`);
      if (!isDryRun) {
        role.promotion = { ...(role.promotion || {}), error: `liveness ${live.result}: ${live.reason}` };
        role.notes = [...(role.notes || []), `${new Date().toISOString()} hold: liveness ${live.result}`];
      }
      continue;
    }

    // active → load/fetch JD, then write folder
    let { text: jdText, source: jdSource } = resolveJdSnapshot(role);
    if (!jdText) {
      if (isDryRun) {
        console.log(`[dry-run] ${tag} — would fetch JD (skipped)`);
        jdSource = "dry-run (fetch skipped)";
      } else if (isPlaceholderUrl(role.url) && !resolveUrl(role)) {
        console.log(`[fetch] ${tag} — skipping JD fetch (placeholder URL ${role.url})`);
        console.log(`           ℹ use source_url from jd_eval or report file`);
        jdSource = `placeholder-url (${role.url})`;
      } else {
        console.log(`[fetch] ${tag} — fetching JD (no snapshot on queue)`);
        const fetched = await fetchJd(resolveUrl(role));
        if (fetched.ok) {
          jdText = fetched.text;
          jdSource = fetched.source;
        } else {
          console.log(`           ⚠ JD fetch failed: ${fetched.error} — writing placeholder`);
          jdSource = `fetch-failed (${fetched.error})`;
        }
      }
    }

    // Repair placeholder identity before it becomes a folder path. Some batch-
    // imported rows have job_slug === co_slug (and canonical_key co::co), so a
    // second distinct role at the same company would collide on the SAME folder
    // path and be wrongly blocked. Always derive the slug/key from the role title.
    const titleSlug = slugify(normalizeTitle(role.role || "")) || role.job_slug;
    if (titleSlug && (!role.job_slug || role.job_slug === role.co_slug)) role.job_slug = titleSlug;
    if (!role.canonical_key || role.canonical_key === `${role.co_slug}::${role.co_slug}`) {
      role.canonical_key = canonicalKey(role.co_slug, role.role);
    }

    const jobFolder = path.join(VAULT, "companies", role.co_slug, "jobs", role.job_slug);
    const folderRel = path.posix.join("companies", role.co_slug, "jobs", role.job_slug);
    console.log(`[stage]  ${tag} → ${folderRel}/`);

    if (!isDryRun) {
      if (fs.existsSync(jobFolder)) {
        console.log(`           ⚠ folder already exists; recording in promotion.error and skipping write`);
        role.promotion = { ...(role.promotion || {}), error: `folder already exists at ${folderRel}` };
        role.notes = [...(role.notes || []), `${new Date().toISOString()} skip: folder exists`];
        continue;
      }

      // Cross-source canonical dedup: check if another folder for the same
      // company+role combo already exists (different slug from different source).
      // Prevents re-staging the same role scanned from a different job board.
      // Keys are recomputed from company+title when the stored field is absent,
      // so this also catches collisions against OLDER folders written before
      // source_canonical_key existed (the cause of the camunda/alphasense dupes).
      const roleKey = String(role.canonical_key || "").trim() || canonicalKey(role.co_slug, role.role);
      if (roleKey && role.co_slug) {
        const companyDir = path.join(VAULT, "companies", role.co_slug, "jobs");
        if (fs.existsSync(companyDir)) {
          const existingJobs = fs.readdirSync(companyDir).filter((d) => d !== role.job_slug);
          for (const existingSlug of existingJobs) {
            const existingYml = path.join(companyDir, existingSlug, "job.yml");
            if (!fs.existsSync(existingYml)) continue;
            const parsed = parseSimpleJobYml(fs.readFileSync(existingYml, "utf8"));
            const existingStatus = String(parsed.status || "").trim();
            // Only skip if existing is still active (not closed)
            if (existingStatus === "closed" || existingStatus === "error") continue;
            const existingKey = String(parsed.source_canonical_key || "").trim()
              || canonicalKey(parsed.company_slug || role.co_slug, parsed.title || existingSlug);
            if (existingKey && existingKey === roleKey) {
              console.log(`           ⚠ cross-source duplicate detected: same canonical key "${roleKey}" already exists at ${existingSlug} (status=${existingStatus})`);
              role.promotion = { ...(role.promotion || {}), error: `cross-source duplicate: canonical key matches ${existingSlug}` };
              role.notes = [...(role.notes || []), `${new Date().toISOString()} skip: cross-source duplicate of ${existingSlug} (canonical key match)`];
              if (!isDryRun) {
                role.queue_state = "closed";
                role.recommendation = "duplicate";
              }
              mutated = true;
              break;
            }
          }
          if (role.queue_state === "closed") continue;
        }
      }
      fs.mkdirSync(jobFolder, { recursive: true });
      fs.writeFileSync(path.join(jobFolder, "job.yml"), renderJobYml(role));
      fs.writeFileSync(path.join(jobFolder, "job.md"), renderJobMd(role, jdText, jdSource));
      fs.writeFileSync(path.join(jobFolder, "status-history.md"), renderStatusHistory(role));

      // Copy the pathfinder report (if it exists) → pathfinder-eval.md
      const reportAbs = role.report ? path.join(VAULT, role.report) : null;
      if (reportAbs && fs.existsSync(reportAbs)) {
        fs.copyFileSync(reportAbs, path.join(jobFolder, "pathfinder-eval.md"));
      } else {
        fs.writeFileSync(
          path.join(jobFolder, "pathfinder-eval.md"),
          `# PATHFINDER evaluation\n\nReport file not found at ${role.report || "(unset)"}.\n`,
        );
      }

      role.queue_state = "staged";
      role.promotion = {
        promoted_at: new Date().toISOString(),
        job_folder: folderRel,
        error: null,
      };
      role.notes = [...(role.notes || []), `${new Date().toISOString()} staged at ${folderRel}`];
    }
  }

  if (!isDryRun && mutated) writeQueue(queue);
  if (isDryRun) console.log("\n(dry-run — no writes)");
  console.log("Done. Re-run `node scripts/lin-tracker.mjs` to refresh the dashboard.");
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
