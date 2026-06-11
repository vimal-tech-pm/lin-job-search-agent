#!/usr/bin/env node
/**
 * lin-wont-apply.mjs — move a Lin role out of the apply pipeline.
 *
 * Usage:
 *   node scripts/lin-wont-apply.mjs <job-slug|co-slug/job-slug|#queue-id> [reason...]
 *   node scripts/lin-wont-apply.mjs --rejected <job-slug|co-slug/job-slug|#queue-id> [reason...]
 *
 *   Default: user declined ("won't_apply:" prefix) → shows in Won't Apply tab.
 *   --rejected: company rejected ("rejected:" prefix) → shows in Closed tab.
 *
 * Effects:
 *   - Lin-managed job folder: job.yml status -> closed, status_detail -> prefix: reason,
 *     append status-history.md.
 *   - Evaluation queue row: queue_state -> skipped, recommendation -> manual_override,
 *     append note.
 *   - If a queue row points to a promoted job folder, closes that folder too.
 *   - Refreshes the tracker at the end.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(VAULT, "companies");
const QUEUE_PATH = path.join(VAULT, "data", "evaluation-queue.json");
const TRACKER = path.join(VAULT, "scripts", "lin-tracker.mjs");

let target = process.argv[2];
let reason = process.argv.slice(3).join(" ").trim() || "user chose not to apply";

// --rejected flag: company rejection instead of user decline
const rejectedMode = process.argv.includes("--rejected");
if (rejectedMode) {
  // Re-parse target + reason without the --rejected flag
  const args = process.argv.slice(2).filter(a => a !== "--rejected");
  target = args[0];
  reason = args.slice(1).join(" ").trim() || "company rejected";
}
const detailPrefix = rejectedMode ? "rejected" : "won’t_apply";

if (!target || ["-h", "--help", "help"].includes(target)) {
  console.error("Usage: node scripts/lin-wont-apply.mjs <job-slug|co-slug/job-slug|#queue-id> [reason...]");
  process.exit(target ? 0 : 1);
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

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
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
    console.error(`Ambiguous job slug '${query}'; found in: ${matches.map((m) => m.co).join(", ")}`);
    console.error(`Use one of: ${matches.map((m) => `${m.co}/${m.slug}`).join(", ")}`);
    process.exit(1);
  }
  return matches[0] || null;
}

function parseQueueId(raw) {
  const m = /^#?(\d{1,})$/.exec(String(raw).trim());
  return m ? m[1].padStart(3, "0") : null;
}

function quoteYaml(s) {
  return JSON.stringify(String(s));
}

function setTopLevelYmlScalar(text, key, value) {
  const re = new RegExp(`^${key}:.*$`, "m");
  const line = `${key}: ${value}`;
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\s*$/, `\n${line}\n`);
}

function closeJob(job, detail) {
  const ymlPath = path.join(job.path, "job.yml");
  let text = fs.readFileSync(ymlPath, "utf8");
  text = setTopLevelYmlScalar(text, "status", "closed");
  text = setTopLevelYmlScalar(text, "status_detail", quoteYaml(detail));
  fs.writeFileSync(ymlPath, text.endsWith("\n") ? text : `${text}\n`);

  const historyPath = path.join(job.path, "status-history.md");
  const line = `${nowIso()}  closed        ${detail}\n`;
  if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, line);
  } else {
    fs.appendFileSync(historyPath, line);
  }
}

function jobFromFolder(folder) {
  if (!folder) return null;
  const rel = String(folder).replace(/\/$/, "");
  const m = /^companies\/([^/]+)\/jobs\/([^/]+)$/.exec(rel);
  if (!m) return null;
  const p = path.join(VAULT, rel);
  if (!fs.existsSync(path.join(p, "job.yml"))) return null;
  return { co: m[1], slug: m[2], path: p };
}

function updateQueueByPredicate(predicate, detail) {
  const queue = readJsonSafe(QUEUE_PATH);
  if (!queue) return { updated: 0, matchedJobs: [] };
  const matchedJobs = [];
  let updated = 0;
  const ts = nowIso();
  for (const role of queue.roles || []) {
    if (!predicate(role)) continue;
    role.queue_state = "skipped";
    role.recommendation = "manual_override";
    role.updated_at = ts;
    role.notes = Array.isArray(role.notes) ? role.notes : [];
    role.notes.push(`${ts} — ${detailPrefix}: ${reason}`);
    role.liveness = { ...(role.liveness || {}), result: rejectedMode ? "rejected" : "user_declined", reason: detail, checked_at: ts };
    if (role.promotion?.job_folder) {
      const promotedJob = jobFromFolder(role.promotion.job_folder);
      if (promotedJob) matchedJobs.push(promotedJob);
    }
    updated += 1;
  }
  if (updated) {
    queue.generated_at = ts;
    writeJson(QUEUE_PATH, queue);
  }
  return { updated, matchedJobs };
}

const detail = `${detailPrefix}: ${reason}`;
let closedJobs = [];
let queueUpdates = 0;

const queueId = parseQueueId(target);
if (queueId) {
  const { updated, matchedJobs } = updateQueueByPredicate((r) => r.id === queueId, detail);
  queueUpdates += updated;
  closedJobs.push(...matchedJobs);
  if (!updated) {
    console.error(`No evaluation queue row found for #${queueId}`);
    process.exit(1);
  }
} else {
  const job = findJob(target);
  if (!job) {
    console.error(`No Lin job folder found for '${target}' and it is not a queue id.`);
    process.exit(1);
  }
  closedJobs.push(job);
  const folder = `companies/${job.co}/jobs/${job.slug}`;
  const { updated } = updateQueueByPredicate(
    (r) => r.promotion?.job_folder?.replace(/\/$/, "") === folder || (r.co_slug === job.co && r.job_slug === job.slug),
    detail,
  );
  queueUpdates += updated;
}

// Deduplicate jobs in case a queue row and direct target refer to the same folder.
const seen = new Set();
closedJobs = closedJobs.filter((job) => {
  const key = `${job.co}/${job.slug}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

for (const job of closedJobs) closeJob(job, detail);

if (fs.existsSync(TRACKER)) {
  const res = spawnSync(process.execPath, [TRACKER], { cwd: VAULT, encoding: "utf8" });
  if (res.status !== 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status || 1);
  }
}

for (const job of closedJobs) {
  console.log(`${rejectedMode ? "rejected" : "won’t-apply"}: closed ${job.co}/${job.slug}`);
}
if (queueUpdates) console.log(`${rejectedMode ? "rejected" : "won’t-apply"}: skipped ${queueUpdates} evaluation queue row(s)`);
console.log("tracker: refreshed");
