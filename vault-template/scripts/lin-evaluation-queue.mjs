#!/usr/bin/env node
/**
 * lin-evaluation-queue.mjs — Script-owned bridge between LIN01's report+pipeline
 * output and LIN02/dashboard's job.yml world.
 *
 * Writes / reads `data/evaluation-queue.json` per the V3 schema in
 * docs/architecture-gaps-and-plan-v3-claude-opus.md.
 *
 * Commands:
 *   migrate                       seed queue from data/pipeline.md + reports/
 *   validate                      schema + cross-file sanity checks
 *   upsert --id <NNN>             merge a single entry; reads JSON from stdin
 *   upsert --id <NNN> --file <p>  ...or from a file (preferred for cron)
 *
 * Pure Node — no external deps. Pipeline-row regex keeps the ✅/❌ emoji and
 * uses the `u` flag so multibyte rows aren't silently skipped.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VAULT = path.resolve(__dirname, "..");
const PIPELINE_PATH = path.join(VAULT, "data", "pipeline.md");
const REPORTS_DIR = path.join(VAULT, "reports");
const QUEUE_PATH = path.join(VAULT, "data", "evaluation-queue.json");
const CONFIG_PATH = path.join(VAULT, "career-profile", "pipeline-config.json");

const SCHEMA_VERSION = 1;
export const QUEUE_STATES = new Set([
  "evaluated", "recommended", "staged", "built", "materials_ready", "applied",
  "skipped", "closed", "duplicate", "error",
]);
const RECOMMENDATIONS = new Set([
  "auto_stage", "review", "skip", "manual_override",
]);
const GEO_REASONS = new Set([null, "visa", "remote-only", "onsite-only"]);
const CANADA_VALUES = new Set(["yes", "no", "unknown"]);
// Source provenance vocabulary (lowercase in data). Missing source defaults to
// "portal"; a present-but-invalid source is a hard validation error.
export const SOURCE_VALUES = new Set(["portal", "linkedin", "indeed", "gmail", "manual"]);

// ----- shared helpers -----

function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (err) {
    console.error(`Cannot parse JSON at ${p}: ${err.message}`);
    process.exit(1);
  }
}

function readPipelineConfig() {
  const cfg = readJsonSafe(CONFIG_PATH) || {};
  const threshold = Number(cfg.promote_threshold ?? 4.2);
  return {
    promote_threshold: Number.isFinite(threshold) ? threshold : 4.2,
  };
}

function isPromotionTerminal(role) {
  return ["staged", "materials_ready", "applied", "skipped", "closed", "duplicate", "error"].includes(role?.queue_state) ||
    role?.recommendation === "manual_override" ||
    !!role?.promotion?.job_folder;
}

function existingJobFolderRel(role) {
  if (!role?.co_slug || !role?.job_slug) return null;
  const folderRel = path.posix.join("companies", role.co_slug, "jobs", role.job_slug);
  const folderAbs = path.join(VAULT, "companies", role.co_slug, "jobs", role.job_slug);
  return fs.existsSync(folderAbs) ? folderRel : null;
}

function isWontApplyDetail(detail) {
  return /won[’']?t[_ -]?apply|wont[_ -]?apply|do not apply|don[’']?t apply|user_declined/i.test(String(detail || ""));
}

// job.yml status → queue_state. Lifecycle statuses map 1:1; unknown/legacy
// statuses (new, decoding, interested, …) collapse to "staged" as before.
export function mapJobStatusToQueueState(status) {
  if (status === "applied") return "applied";
  if (status === "materials_ready") return "materials_ready";
  if (status === "closed") return "closed";
  if (status === "built") return "built";
  return "staged";
}

function readExistingJobState(folderRel) {
  const yml = path.join(VAULT, folderRel, "job.yml");
  if (!fs.existsSync(yml)) return { queue_state: "staged", recommendation: null };
  const text = fs.readFileSync(yml, "utf8");
  const status = /^status:\s*['"]?([^'"\n#]+)['"]?\s*$/m.exec(text)?.[1]?.trim() || "staged";
  const statusDetail = /^status_detail:\s*(.+)$/m.exec(text)?.[1] || "";
  if (status === "closed" && isWontApplyDetail(statusDetail)) return { queue_state: "skipped", recommendation: "manual_override" };
  return { queue_state: mapJobStatusToQueueState(status), recommendation: null };
}

function writeQueue(queue) {
  fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
}

// ----- pipeline.md parsing -----

// `- [x] #NNN | URL | Company | Role | X.X/5 | PDF ✅` (or ❌)
// `u` flag for multibyte emoji safety (GLM #7).
const PROCESSED_RE = /^- \[x\] #(\d{3,}) \| (\S+) \| ([^|]+?) \| ([^|]+?) \| ([\d.]+)\/5 \| PDF (✅|❌)\s*$/u;
// Pending row: `- [ ] DATE | Company | Role | URL [| src=… [dup_of=…]]`.
// The URL is anchored on the https token (so a `?src=` query param doesn't trip
// the parser), Company/Role allow internal pipes via regex backtracking, and an
// optional trailing metadata field carries `src=`/`dup_of=`.
const PENDING_RE = /^- \[ \] (\d{4}-\d{2}-\d{2}) \| (.+?) \| (.+?) \| (https?:\/\/\S+?)(?:\s*\|\s*(.*))?\s*$/u;

function parsePipeline() {
  if (!fs.existsSync(PIPELINE_PATH)) {
    console.error(`Missing ${PIPELINE_PATH}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(PIPELINE_PATH, "utf8").split("\n");
  const processed = [];
  const pending = [];
  for (const line of lines) {
    const mP = PROCESSED_RE.exec(line);
    if (mP) {
      processed.push({
        id: mP[1],
        url: mP[2].trim(),
        company: mP[3].trim(),
        role: mP[4].trim(),
        score: parseFloat(mP[5]),
        pdf: mP[6] === "✅",
      });
      continue;
    }
    const mQ = PENDING_RE.exec(line);
    if (mQ) {
      const meta = mQ[5] || "";
      const company = mQ[2].trim();
      const role = mQ[3].trim();
      pending.push({
        discovered_at: mQ[1],
        company,
        role,
        url: mQ[4].trim(),
        source: /src=([^\s|]+)/.exec(meta)?.[1] || "portal",
        duplicate_of: /dup_of=([^\s|]+)/.exec(meta)?.[1] || null,
        canonical_key: `${slugify(company)}::${slugify(role.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())}`,
      });
    }
  }
  return { processed, pending };
}

// ----- report parsing -----

function findReportFor(id) {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const prefix = `${id}-`;
  const match = fs.readdirSync(REPORTS_DIR).find(
    (f) => f.startsWith(prefix) && f.endsWith(".md"),
  );
  return match ? path.join(REPORTS_DIR, match) : null;
}

// Returns { co_slug, date } derived from filename `NNN-{co-slug}-YYYY-MM-DD.md`
function parseReportFilename(filename) {
  // strip leading "NNN-" then trailing "-YYYY-MM-DD.md"
  const m = /^(\d{3,})-(.+)-(\d{4}-\d{2}-\d{2})\.md$/.exec(filename);
  if (!m) return null;
  return { id: m[1], co_slug: m[2], date: m[3] };
}

function parseReport(reportPath) {
  const text = fs.readFileSync(reportPath, "utf8");

  // Header scalars
  const verdict = /^\*\*Verdict:\*\*\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
  const url = /^\*\*URL:\*\*\s*(\S+)/m.exec(text)?.[1] ?? null;
  const pdf = /^\*\*PDF:\*\*\s*(\S+)/m.exec(text)?.[1] ?? null;
  const scoreStr = /^\*\*Score:\*\*\s*([\d.]+)\/5/m.exec(text)?.[1] ?? null;
  const score = scoreStr ? parseFloat(scoreStr) : null;

  // Section A table rows: `| Remote | ... |` / `| Location | ... |`
  const remote = /\|\s*Remote\s*\|\s*([^|]+?)\s*\|/i.exec(text)?.[1] ?? null;
  const location = /\|\s*Location\s*\|\s*([^|]+?)\s*\|/i.exec(text)?.[1] ?? null;

  // Keywords section: comma-separated, single line after the heading
  const kwBlock = /^## Keywords [^\n]*\n+([^\n]+)/m.exec(text);
  const keywords = kwBlock
    ? kwBlock[1].split(",").map((k) => k.trim()).filter(Boolean)
    : [];

  return { score, verdict, url, pdf, remote, location, keywords };
}

// ----- geo gate inference -----

// the candidate is Toronto, targets Canada/US-remote. blocks_stage=true only on an
// explicit onsite-only / visa-blocked / non-remote-foreign signal. Default
// permissive (the plan: "default `{reason:null, blocks_stage:false}`").
function inferGeoGate(remoteSignal, location) {
  const r = (remoteSignal || "").toLowerCase();
  const l = (location || "").toLowerCase();
  const onsiteHints = ["on-site", "onsite", "on site", "in-office", "in office"];
  const visaHints = ["no visa", "no sponsorship", "us citizen", "citizenship required", "security clearance"];
  if (visaHints.some((h) => r.includes(h) || l.includes(h))) {
    return { reason: "visa", blocks_stage: true };
  }
  if (onsiteHints.some((h) => r.includes(h) || l.includes(h))) {
    return { reason: "onsite-only", blocks_stage: true };
  }
  // "Remote/Canada", "Not specified", "Not clearly specified" — all permissive.
  return { reason: null, blocks_stage: false };
}

// Normalize a geo_gate so `reason` is always a valid GEO_REASONS enum value and
// any free-text explanation lives in `detail`. The scoring step (lin02score) may
// author `reason` as prose (e.g. "US-only remote; no Canada eligibility"); this
// preserves that prose in `detail` and derives a categorical `reason` from it.
// `blocks_stage` is never changed here — gating behavior is owned by classify().
// Idempotent: a value already in enum form passes through unchanged.
function normalizeGeoGate(gg) {
  const blocks_stage = Boolean(gg?.blocks_stage);
  const rawReason = gg?.reason ?? null;
  const existingDetail = typeof gg?.detail === "string" ? gg.detail : "";

  // Already a valid enum value → keep reason, keep any existing detail.
  if (GEO_REASONS.has(rawReason)) {
    return { reason: rawReason, blocks_stage, detail: existingDetail };
  }

  // reason is free text (or a non-enum value). Preserve it as detail, derive enum.
  const prose = String(rawReason ?? "");
  const detail = existingDetail || prose;
  const t = prose.toLowerCase();
  let reason = null;
  if (/visa|sponsor|clearance|citizen/.test(t)) {
    reason = "visa";
  } else if (/onsite|on-site|on site|hybrid|in-office|in office|relocat/.test(t)) {
    reason = "onsite-only";
  } else if (/region-locked|region locked|us-only|us only|emea-only|emea only|remote/.test(t)) {
    reason = "remote-only";
  }
  return { reason, blocks_stage, detail };
}

// ----- recommendation mapping -----

function classify(score, geoGate, canadaEligible, threshold = readPipelineConfig().promote_threshold) {
  if (score == null) return { queue_state: "error", recommendation: "manual_override" };
  if (score < 3.0) return { queue_state: "evaluated", recommendation: "skip" };
  // canada_eligible="yes" is an explicit LLM/JD-authored allow signal and
  // overrides a stale/heuristic geo_gate. "no" is a hard block; "unknown"
  // still lets geo_gate block on explicit onsite/visa/security signals.
  const blocked = canadaEligible === "yes" ? false : ((geoGate?.blocks_stage || false) || canadaEligible === "no");
  if (score >= threshold && !blocked) {
    return { queue_state: "recommended", recommendation: "auto_stage" };
  }
  return { queue_state: "evaluated", recommendation: "review" };
}

function normalizeClassification(role, threshold = readPipelineConfig().promote_threshold) {
  if (isPromotionTerminal(role)) return role;
  const next = classify(role.score, role.geo_gate || { reason: null, blocks_stage: false }, role.canada_eligible || "unknown", threshold);
  role.queue_state = next.queue_state;
  role.recommendation = next.recommendation;
  return role;
}

// ----- migrate -----

function migrate() {
  const { processed } = parsePipeline();
  const { promote_threshold } = readPipelineConfig();
  const roles = [];

  for (const row of processed) {
    const reportPath = findReportFor(row.id);
    if (!reportPath) {
      console.warn(`No report file found for #${row.id}; skipping`);
      continue;
    }
    const meta = parseReportFilename(path.basename(reportPath)) ?? {};
    const r = parseReport(reportPath);

    const score = r.score ?? row.score;
    const co_slug = meta.co_slug || slugify(row.company);
    const job_slug = slugify(row.role);
    const geo_gate = inferGeoGate(r.remote, r.location);
    // Per user decision: migrated rows default to "unknown" so the next LIN01
    // eval (LLM-authored) fills them in. Heuristic detection from report text
    // is intentionally NOT done here — geo_gate covers that fallback.
    const canada_eligible = "unknown";
    const { queue_state, recommendation } = classify(score, geo_gate, canada_eligible, promote_threshold);

    roles.push({
      id: row.id,
      company: row.company,
      co_slug,
      role: row.role,
      job_slug,
      url: r.url || row.url,
      discovered_at: meta.date || null,
      evaluated_at: meta.date || null,
      score,
      verdict: r.verdict,
      recommendation,
      queue_state,
      report: path.posix.join("reports", path.basename(reportPath)),
      pdf: r.pdf || (row.pdf ? `output/${row.id}-${co_slug}-${meta.date || "unknown"}.pdf` : null),
      jd_snapshot: null,
      needs_jd_refetch: true,
      keywords: r.keywords,
      location: r.location || "Not specified",
      remote_signal: r.remote || null,
      geo_gate,
      canada_eligible,
      canada_eligible_reason: null,
      liveness: { checked_at: null, result: null, reason: null },
      promotion: { promoted_at: null, job_folder: null, error: null },
      notes: [],
    });
  }

  roles.sort((a, b) => a.id.localeCompare(b.id));

  const queue = {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso(),
    bootstrap: {
      completed_at: nowIso(),
      last_mode: "manual",
      notes: "Initial queue created from pipeline/report migration.",
    },
    roles,
  };

  writeQueue(queue);
  console.log(`Migrated ${roles.length} role(s) → ${path.relative(VAULT, QUEUE_PATH)}`);
  for (const r of roles) {
    console.log(`  #${r.id} ${r.company} / ${r.job_slug} — ${r.score} → ${r.queue_state}/${r.recommendation}`);
  }
}

// ----- validate -----

function validate() {
  const queue = readJsonSafe(QUEUE_PATH);
  if (!queue) {
    console.error(`Missing queue at ${QUEUE_PATH}; run migrate first.`);
    process.exit(1);
  }
  const errors = [];
  if (queue.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version: expected ${SCHEMA_VERSION}, got ${queue.schema_version}`);
  }
  if (!queue.bootstrap || typeof queue.bootstrap !== "object") {
    errors.push("missing bootstrap block");
  }
  const seenIds = new Set();
  for (const r of queue.roles || []) {
    const tag = `#${r.id}`;
    if (seenIds.has(r.id)) errors.push(`${tag}: duplicate id`);
    seenIds.add(r.id);
    if (!r.url) errors.push(`${tag}: missing url`);
    if (typeof r.score !== "number" || r.score < 0 || r.score > 5) {
      errors.push(`${tag}: score out of range (${r.score})`);
    }
    if (!QUEUE_STATES.has(r.queue_state)) {
      errors.push(`${tag}: bad queue_state '${r.queue_state}'`);
    }
    if (!RECOMMENDATIONS.has(r.recommendation)) {
      errors.push(`${tag}: bad recommendation '${r.recommendation}'`);
    }
    if (!GEO_REASONS.has(r.geo_gate?.reason ?? null)) {
      errors.push(`${tag}: bad geo_gate.reason '${r.geo_gate?.reason}'`);
    }
    if (r.canada_eligible !== undefined && !CANADA_VALUES.has(r.canada_eligible)) {
      errors.push(`${tag}: bad canada_eligible '${r.canada_eligible}' (must be yes|no|unknown)`);
    }
    // Missing source defaults to portal (legacy rows); present-but-invalid is an
    // error so new writes can't smuggle a bad provenance value into the pipeline.
    if (r.source !== undefined && r.source !== null && !SOURCE_VALUES.has(r.source)) {
      errors.push(`${tag}: bad source '${r.source}' (must be portal|linkedin|indeed|gmail|manual)`);
    }
    if (r.build_requested !== undefined && typeof r.build_requested !== "boolean") {
      errors.push(`${tag}: build_requested must be boolean`);
    }
    if (r.build_requested_at !== undefined && r.build_requested_at !== null && typeof r.build_requested_at !== "string") {
      errors.push(`${tag}: build_requested_at must be ISO string or null`);
    }
    if (r.report) {
      const abs = path.join(VAULT, r.report);
      if (!fs.existsSync(abs)) errors.push(`${tag}: report file missing (${r.report})`);
    }
  }

  if (errors.length) {
    console.error(`validate: ${errors.length} error(s)`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`validate: ok — ${(queue.roles || []).length} role(s)`);
}

// ----- upsert -----

function readEntryInput(argv) {
  const fileIdx = argv.indexOf("--file");
  if (fileIdx !== -1) {
    const p = argv[fileIdx + 1];
    if (!p) { console.error("--file requires a path"); process.exit(1); }
    return fs.readFileSync(p, "utf8");
  }
  // stdin
  if (process.stdin.isTTY) {
    console.error("upsert: pipe JSON via stdin or pass --file <path>");
    process.exit(1);
  }
  return fs.readFileSync(0, "utf8");
}

function upsert(argv) {
  const idIdx = argv.indexOf("--id");
  if (idIdx === -1 || !argv[idIdx + 1]) {
    console.error("upsert requires --id <NNN>");
    process.exit(1);
  }
  const id = argv[idIdx + 1];
  const raw = readEntryInput(argv);
  let incoming;
  try { incoming = JSON.parse(raw); }
  catch (err) { console.error(`stdin JSON parse error: ${err.message}`); process.exit(1); }
  if (incoming.id && incoming.id !== id) {
    console.error(`upsert: --id ${id} does not match payload id ${incoming.id}`);
    process.exit(1);
  }
  incoming.id = id;

  let queue = readJsonSafe(QUEUE_PATH);
  if (!queue) {
    queue = {
      schema_version: SCHEMA_VERSION,
      generated_at: nowIso(),
      bootstrap: { completed_at: null, last_mode: "daily", notes: "Initialized via upsert." },
      roles: [],
    };
  }
  queue.generated_at = nowIso();
  const { promote_threshold } = readPipelineConfig();

  const idx = (queue.roles || []).findIndex((r) => r.id === id);
  if (idx === -1) {
    // ensure all bookkeeping fields exist with safe defaults
    const defaults = {
      jd_snapshot: null,
      needs_jd_refetch: false,
      keywords: [],
      location: null,
      remote_signal: null,
      geo_gate: { reason: null, blocks_stage: false, detail: "" },
      canada_eligible: "unknown",
      canada_eligible_reason: null,
      // Source provenance — survives score → queue → promotion → job.yml.
      source: "portal",
      duplicate_of: null,
      canonical_key: null,
      liveness: { checked_at: null, result: null, reason: null },
      promotion: { promoted_at: null, job_folder: null, error: null },
      notes: [],
    };
    const merged = { ...defaults, ...incoming };
    merged.geo_gate = normalizeGeoGate(merged.geo_gate);
    const role = normalizeClassification(merged, promote_threshold);
    queue.roles.push(role);
  } else {
    // Merge — never clobber promotion/liveness already set unless caller
    // explicitly provided non-null fields.
    const existing = queue.roles[idx];
    const mergeBlock = (a, b) => {
      const out = { ...a };
      for (const k of Object.keys(b || {})) {
        if (b[k] != null) out[k] = b[k];
      }
      return out;
    };
    queue.roles[idx] = normalizeClassification({
      ...existing,
      ...incoming,
      liveness: mergeBlock(existing.liveness || {}, incoming.liveness || {}),
      promotion: mergeBlock(existing.promotion || {}, incoming.promotion || {}),
      geo_gate: normalizeGeoGate(mergeBlock(existing.geo_gate || {}, incoming.geo_gate || {})),
    }, promote_threshold);
  }
  queue.roles.sort((a, b) => a.id.localeCompare(b.id));
  writeQueue(queue);
  console.log(`upsert #${id}: ok (${idx === -1 ? "inserted" : "merged"})`);
}

function reclassify(argv) {
  const write = argv.includes("--write");
  const queue = readJsonSafe(QUEUE_PATH);
  if (!queue) {
    console.error(`Missing queue at ${QUEUE_PATH}; run migrate first.`);
    process.exit(1);
  }
  const { promote_threshold } = readPipelineConfig();
  let changed = 0;
  for (const role of queue.roles || []) {
    // Backfill: normalize geo_gate so reason is enum + prose preserved in detail.
    // Runs for every role (any state) so legacy free-text reasons are repaired.
    const normGeo = normalizeGeoGate(role.geo_gate || { reason: null, blocks_stage: false });
    const beforeGeo = JSON.stringify({ reason: role.geo_gate?.reason ?? null, detail: role.geo_gate?.detail ?? "" });
    const afterGeo = JSON.stringify({ reason: normGeo.reason, detail: normGeo.detail });
    if (beforeGeo !== afterGeo) {
      changed += 1;
      console.log(`#${role.id}: geo_gate.reason ${JSON.stringify(role.geo_gate?.reason ?? null)} → ${JSON.stringify(normGeo.reason)} (detail preserved)`);
      if (write) {
        role.geo_gate = normGeo;
        role.updated_at = nowIso();
      }
    }

    const existingRel = existingJobFolderRel(role);
    if (existingRel) {
      const existingState = readExistingJobState(existingRel);
      const classifiedRecommendation = classify(role.score, role.geo_gate || { reason: null, blocks_stage: false }, role.canada_eligible || "unknown", promote_threshold).recommendation;
      const syncedState = existingState.queue_state;
      const syncedRecommendation = existingState.recommendation || classifiedRecommendation;
      const before = `${role.queue_state}/${role.recommendation}`;
      const after = `${syncedState}/${syncedRecommendation}`;
      const needsSync = role.queue_state !== syncedState || role.recommendation !== syncedRecommendation || role.promotion?.job_folder !== existingRel;
      if (needsSync) {
        changed += 1;
        console.log(`#${role.id}: ${before} → ${after} (existing folder ${existingRel})`);
        if (write) {
          role.queue_state = syncedState;
          role.recommendation = syncedRecommendation;
          role.promotion = { ...(role.promotion || {}), job_folder: existingRel, error: null };
          if (!role.promotion.promoted_at) role.promotion.promoted_at = nowIso();
          role.updated_at = nowIso();
          role.notes = [...(role.notes || []), `${nowIso()} synced to existing Lin folder ${existingRel}`];
        }
      }
      continue;
    }
    if (isPromotionTerminal(role)) continue;
    const before = `${role.queue_state}/${role.recommendation}`;
    const next = classify(role.score, role.geo_gate || { reason: null, blocks_stage: false }, role.canada_eligible || "unknown", promote_threshold);
    const after = `${next.queue_state}/${next.recommendation}`;
    if (before !== after) {
      changed += 1;
      console.log(`#${role.id}: ${before} → ${after} (${role.score}/5, threshold ${promote_threshold})`);
      if (write) {
        role.queue_state = next.queue_state;
        role.recommendation = next.recommendation;
        role.updated_at = nowIso();
        role.notes = [...(role.notes || []), `${nowIso()} reclassified using promote_threshold=${promote_threshold}`];
      }
    }
  }
  if (write && changed) {
    queue.generated_at = nowIso();
    writeQueue(queue);
  }
  console.log(`reclassify: ${changed} change(s)${write ? " written" : " (dry-run; pass --write to apply)"}`);
}

// ----- request-build (hybrid trigger flag; design §5) -----

function requestBuild(argv) {
  const idIdx = argv.indexOf("--id");
  const id = (argv.find((a) => a.startsWith("--id=")) || "").split("=")[1] || (idIdx !== -1 ? argv[idIdx + 1] : null);
  if (!id) {
    console.error("usage: lin-evaluation-queue.mjs request-build --id <NNN> [--clear]");
    process.exit(2);
  }
  const clear = argv.includes("--clear");
  const queue = readJsonSafe(QUEUE_PATH);
  if (!queue) { console.error(`Missing queue at ${QUEUE_PATH}`); process.exit(1); }
  const role = (queue.roles || []).find((r) => String(r.id) === String(id).replace(/^#/, ""));
  if (!role) { console.error(`no queue row with id ${id}`); process.exit(1); }
  if (["applied", "closed", "skipped", "duplicate", "error"].includes(role.queue_state)) {
    console.error(`row ${id} is terminal (${role.queue_state}); refusing`); process.exit(1);
  }
  const floor = Number(readPipelineConfig().promote_threshold ?? 3.95);
  if (!clear && Number(role.score) < floor) {
    console.error(`row ${id} score ${role.score} < promote_threshold ${floor}; refusing`); process.exit(1);
  }
  role.build_requested = !clear;
  role.build_requested_at = clear ? null : nowIso();
  role.updated_at = nowIso();
  queue.generated_at = nowIso();
  writeQueue(queue);
  console.log(JSON.stringify({ id: role.id, build_requested: role.build_requested, build_requested_at: role.build_requested_at }));
}

// ----- main -----

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case "migrate":    migrate(); break;
    case "validate":   validate(); break;
    case "upsert":     upsert(argv); break;
    case "reclassify": reclassify(argv); break;
    case "request-build": requestBuild(argv); break;
    default:
      console.error("Usage: lin-evaluation-queue.mjs <migrate|validate|upsert|reclassify [--write]|request-build --id <NNN> [--clear]>");
      process.exit(1);
  }
}
