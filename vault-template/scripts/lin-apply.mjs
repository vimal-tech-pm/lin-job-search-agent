#!/usr/bin/env node
/**
 * lin-apply.mjs — mark a Lin role as APPLIED (deterministic bookkeeping).
 *
 * Mirrors the §apply spec in skills/lin/SKILL.md. This is the same record-keeping
 * the agent did by hand; extracted into a script so the dashboard's Apply button
 * (scripts/lin-serve.mjs) and the CLI can both trigger it.
 *
 * Usage:
 *   node scripts/lin-apply.mjs <job-slug|co-slug/job-slug> [--yes] [--json]
 *
 * Effects (job.yml status materials_ready/new/decoding -> applied):
 *   - job.yml: status -> applied, applied_at -> ISO now,
 *     applied_with.resume -> ats_winner, applied_with.cover -> cover_winner.
 *   - status-history.md: append a row.
 *   - PATHFINDER tracker: best-effort TSV addition + merge (non-fatal).
 *   - Refresh data/applications.{md,html} via lin-tracker.mjs.
 *
 * Flags:
 *   --yes    skip the interactive y/N confirmation (servers/cron pass this).
 *   --json   emit a single JSON line on stdout (for the server to parse).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(VAULT, "companies");
const QUEUE_PATH = path.join(VAULT, "data", "evaluation-queue.json");
const TRACKER = path.join(VAULT, "scripts", "lin-tracker.mjs");
const MERGE_TRACKER = path.join(VAULT, "engines", "pathfinder", "merge-tracker.mjs");
const PF_ADDITIONS_DIR = path.join(VAULT, "engines", "pathfinder", "batch", "tracker-additions");

const argv = process.argv.slice(2);
const YES = argv.includes("--yes") || argv.includes("-y");
const JSON_OUT = argv.includes("--json");
const target = argv.find((a) => !a.startsWith("-"));

function emit(ok, payload) {
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ ok, ...payload }) + "\n");
  } else if (ok) {
    console.log(payload.message || "applied");
  } else {
    console.error(payload.error || "failed");
  }
  process.exit(ok ? 0 : 1);
}

if (!target || ["-h", "--help", "help"].includes(target)) {
  emit(false, { error: "Usage: node scripts/lin-apply.mjs <job-slug|co-slug/job-slug> [--yes] [--json]" });
}

function nowIso() {
  return new Date().toISOString();
}

function findJob(query) {
  if (!fs.existsSync(COMPANIES_DIR)) return null;
  if (query.includes("/")) {
    const [co, slug] = query.split("/");
    const p = path.join(COMPANIES_DIR, co, "jobs", slug);
    if (fs.existsSync(path.join(p, "job.yml"))) return { co, slug, path: p };
    return null;
  }
  const matches = [];
  for (const co of fs.readdirSync(COMPANIES_DIR)) {
    const p = path.join(COMPANIES_DIR, co, "jobs", query);
    if (fs.existsSync(path.join(p, "job.yml"))) matches.push({ co, slug: query, path: p });
  }
  if (matches.length > 1) {
    emit(false, {
      error: `Ambiguous job slug '${query}'; found in: ${matches.map((m) => m.co).join(", ")}. Use co-slug/job-slug.`,
    });
  }
  return matches[0] || null;
}

// Minimal reader for the top-level scalars + artifacts block we need.
function readJobFields(text) {
  const out = { artifacts: {} };
  let inArtifacts = false;
  for (const raw of text.split("\n")) {
    if (/^artifacts:\s*$/.test(raw)) { inArtifacts = true; continue; }
    if (inArtifacts) {
      const m = /^\s{2,}([a-z_]+):\s*(.*)$/.exec(raw);
      if (m) { out.artifacts[m[1]] = m[2].trim(); continue; }
      if (/^\S/.test(raw)) inArtifacts = false; // dedented out of block
    }
    const t = /^([a-z_]+):\s*(.*)$/.exec(raw);
    if (t) out[t[1]] = t[2].trim();
  }
  return out;
}

function normNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/^["']|["']$/g, "");
  if (s === "" || s === "null" || s === "~") return null;
  return s;
}

// Rebuild job.yml: set status->applied, refresh applied_at + applied_with block.
function applyToYml(text, winner, cover) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^applied_at:\s*/.test(line)) { i++; continue; } // drop; re-added after status
    if (/^applied_with:\s*$/.test(line)) {
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) i++; // skip block children
      continue;
    }
    if (/^status:\s*/.test(line)) {
      out.push("status: applied");
      out.push(`applied_at: ${nowIso()}`);
      out.push("applied_with:");
      out.push(`  resume: ${winner}`);
      out.push(`  cover: ${cover == null ? "null" : cover}`);
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n") + "\n";
}

function appendHistory(job, winner, cover) {
  const historyPath = path.join(job.path, "status-history.md");
  const coverNote = cover ? `, cover=${cover}` : "";
  const line = `${nowIso()}  applied       marked applied via dashboard (resume=${winner}${coverNote})\n`;
  if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, line);
  else fs.appendFileSync(historyPath, line);
}

// Best-effort: append an "Applied" row to PATHFINDER's tracker and merge it.
// Non-fatal — the Lin dashboard's state + win-rate come from job.yml, not this.
function syncPathfinderTracker(job, fields) {
  try {
    if (!fs.existsSync(QUEUE_PATH) || !fs.existsSync(MERGE_TRACKER)) return { synced: false, reason: "no queue/merge-tracker" };
    const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
    const folder = `companies/${job.co}/jobs/${job.slug}`;
    const row = (queue.roles || []).find(
      (r) => r.promotion?.job_folder?.replace(/\/$/, "") === folder || (r.co_slug === job.co && r.job_slug === job.slug),
    );
    if (!row || !row.id) return { synced: false, reason: "no matching queue row" };
    const num = row.id;
    const date = new Date().toISOString().slice(0, 10);
    const company = row.company || fields.company_slug || job.co;
    const role = row.role || row.title || fields.title || job.slug;
    const score = row.score != null ? row.score : (fields.pathfinder_score ?? "");
    const report = row.report || row.report_path || `reports/${num}-${job.co}-${date}.md`;
    const tsvRow = [num, date, company, role, score, "Applied", "—", `[${num}](${report})`].join("\t") + "\n";
    fs.mkdirSync(PF_ADDITIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(PF_ADDITIONS_DIR, `${num}-${job.slug}-applied.tsv`), tsvRow);
    const res = spawnSync(process.execPath, [MERGE_TRACKER], { cwd: path.dirname(MERGE_TRACKER), encoding: "utf8" });
    return { synced: res.status === 0, reason: res.status === 0 ? "merged" : (res.stderr || "merge failed").trim() };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}

function confirmInteractive(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, (ans) => { rl.close(); resolve(/^y(es)?$/i.test(ans.trim())); });
  });
}

// ---------- main ----------
const job = findJob(target);
if (!job) emit(false, { error: `No Lin job folder found for '${target}'.` });

const ymlPath = path.join(job.path, "job.yml");
const text = fs.readFileSync(ymlPath, "utf8");
const fields = readJobFields(text);
const status = normNull(fields.status);

if (status === "applied") {
  emit(false, { error: `${job.co}/${job.slug} is already marked applied (applied_at=${normNull(fields.applied_at) || "?"}).`, already: true });
}
if (status === "closed" || status === "offer") {
  emit(false, { error: `${job.co}/${job.slug} is '${status}'; refusing to mark applied. Reopen it first if this is wrong.` });
}
if (status !== "materials_ready") {
  emit(false, { error: `${job.co}/${job.slug} is '${status}', not materials_ready. Finish finalize first (or record a direct application via the lin-apply skill's direct-apply flow, which scaffolds status: applied itself).` });
}

const winner = normNull(fields.ats_winner);
if (!winner) {
  emit(false, { error: `${job.co}/${job.slug} has no ats_winner; refusing to fabricate one. Run finalize/compare first.` });
}
const cover = normNull(fields.artifacts?.cover_winner);

if (!YES) {
  if (!process.stdin.isTTY) {
    emit(false, { error: "Refusing to apply without confirmation. Re-run with --yes (servers pass this)." });
  }
  const ok = await confirmInteractive(
    `Mark ${job.co}/${job.slug} as APPLIED using resume=${winner}${cover ? `, cover=${cover}` : ""}? (y/N) `,
  );
  if (!ok) emit(false, { error: "aborted by user", aborted: true });
}

// 1-2. job.yml mutation
fs.writeFileSync(ymlPath, applyToYml(text, winner, cover));
// 3. status history
appendHistory(job, winner, cover);
// 4. PATHFINDER tracker (best-effort)
const pf = syncPathfinderTracker(job, fields);
// 5. refresh Lin dashboard
let trackerOk = true;
if (fs.existsSync(TRACKER)) {
  const res = spawnSync(process.execPath, [TRACKER], { cwd: VAULT, encoding: "utf8" });
  trackerOk = res.status === 0;
  if (!trackerOk && !JSON_OUT) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
}

emit(true, {
  co: job.co,
  slug: job.slug,
  resume: winner,
  cover: cover || null,
  pathfinder_synced: pf.synced,
  pathfinder_note: pf.reason,
  tracker_refreshed: trackerOk,
  message: `applied: ${job.co}/${job.slug} (resume=${winner}${cover ? `, cover=${cover}` : ""})${trackerOk ? " · tracker refreshed" : " · tracker refresh FAILED"}`,
});
