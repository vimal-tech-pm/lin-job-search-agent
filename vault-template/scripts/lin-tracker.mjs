#!/usr/bin/env node
/**
 * lin-tracker.mjs — deterministic regenerator for Lin's tracker views.
 *
 * Thin orchestrator since the Phase-7 split (2026-06-10):
 *   scripts/lib/tracker-data.mjs   vault readers + unified row model (the only state reader)
 *   scripts/lib/tracker-md.mjs     applications.md + win-rate.md (byte-stable)
 *   scripts/lib/tracker-html.mjs   the dashboard (rail + table), templates inlined
 *
 * Writes data/applications.{md,html} + data/win-rate.md. The stdout block
 * ("Lin funnel digest:" …) is consumed verbatim by cron digests — byte-stable.
 *
 * Usage: node scripts/lin-tracker.mjs [--vault /path/to/lin]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as data from "./lib/tracker-data.mjs";
import { renderTracker, renderWinRate, renderFunnel } from "./lib/tracker-md.mjs";
import { renderHtml } from "./lib/tracker-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vaultArg = process.argv.slice(2).find((a) => a.startsWith("--vault="))?.split("=")[1]
  ?? (() => { const i = process.argv.indexOf("--vault"); return i === -1 ? null : process.argv[i + 1]; })();
const VAULT = vaultArg ? path.resolve(vaultArg) : path.resolve(__dirname, "..");

try {
  data.init(VAULT);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const jobs = data.walkJobs();
const backlog = data.readPathfinderBacklog();
const wr = data.computeWinRate(jobs);
const funnel = data.computeFunnel(jobs);
const queue = data.readEvaluationQueue(jobs);
const pipelineRows = data.readPipelineRows();
const pendingCount = pipelineRows.length;

const recommendedCount = queue.filter((r) => r.queue_state === "recommended").length;
const reviewCount = queue.filter((r) => r.queue_state === "evaluated" && r.recommendation === "review").length;
const skipCount = queue.filter((r) => r.queue_state === "evaluated" && r.recommendation === "skip").length;
const wontApplyCount = jobs.filter((j) => j.status === "closed" && data.isWontApplyDetail(j.status_detail)).length
  + queue.filter((r) => data.isWontApplyQueueRow(r) && !jobs.some((j) => j.coSlug === r.co_slug && j.jobSlug === r.job_slug)).length;
const stagedCount = jobs.filter((j) => j.status === "staged" && !j.ats_winner).length;
const builtCount = jobs.filter((j) => j.status === "built" && !j.ats_winner).length;
const materialsReadyCount = jobs.filter((j) => j.status === "materials_ready").length;
const appliedCount = jobs.filter((j) => j.status === "applied").length;

const rows = data.buildRows({ jobs, queue, pipelineRows });
const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ");

const dataDir = path.join(VAULT, "data");
fs.mkdirSync(dataDir, { recursive: true });

const trackerPath = path.join(dataDir, "applications.md");
const htmlPath = path.join(dataDir, "applications.html");
const engineUsagePath = path.join(dataDir, "resume-engine-usage.md");
const funnelPath = path.join(dataDir, "outcome-funnel.md");

fs.writeFileSync(trackerPath, renderTracker(jobs, wr, queue, pipelineRows));
fs.writeFileSync(htmlPath, renderHtml({ rows, wr, generatedAt }));
fs.writeFileSync(engineUsagePath, renderWinRate(wr));
fs.writeFileSync(funnelPath, renderFunnel(funnel));
// Retire the old, misleadingly-named cache once the rename has run.
try { fs.rmSync(path.join(dataDir, "win-rate.md"), { force: true }); } catch {}

// Digest summary — emitted to stdout so cron prompts can echo it verbatim.
console.log("Lin funnel digest:");
console.log(`  pending:         ${pendingCount}`);
console.log(`  recommended:     ${recommendedCount}`);
console.log(`  review:          ${reviewCount}`);
console.log(`  skip (<3.0):     ${skipCount}`);
console.log(`  won't apply:     ${wontApplyCount}`);
console.log(`  staged:          ${stagedCount}`);
console.log(`  built:           ${builtCount}`);
console.log(`  materials-ready: ${materialsReadyCount}`);
console.log(`  applied:         ${appliedCount}`);
console.log(`  ${wr.digestLine}`);
console.log("");
console.log(`Found ${jobs.length} Lin-managed job(s).`);
console.log(`  Active:  ${jobs.filter((j) => !["offer", "closed"].includes(j.status)).length}`);
console.log(`  Won't apply: ${jobs.filter((j) => j.status === "closed" && data.isWontApplyDetail(j.status_detail)).length}`);
console.log(`  Closed:  ${jobs.filter((j) => ["offer", "closed"].includes(j.status) && !data.isWontApplyDetail(j.status_detail)).length}`);
console.log(`PATHFINDER backlog: ${backlog.length} historical evaluations`);
console.log(`Evaluation queue:   ${queue.length} open role(s)`);
console.log(`Win-rate window (${wr.windowDays}d): ${wr.total} apps`);
console.log(`  PATHFINDER: ${wr.tally.pathfinder} (${wr.pct(wr.tally.pathfinder)})`);
console.log(`  FORGE:      ${wr.tally.forge} (${wr.pct(wr.tally.forge)})`);
console.log(`Funnel (applied ${funnel.total}): interview ${funnel.counts.interviewing} · final ${funnel.counts.final} · offer ${funnel.counts.offer}`);
console.log(`Wrote: ${trackerPath}`);
console.log(`Wrote: ${htmlPath}`);
console.log(`Wrote: ${engineUsagePath}`);
console.log(`Wrote: ${funnelPath}`);
