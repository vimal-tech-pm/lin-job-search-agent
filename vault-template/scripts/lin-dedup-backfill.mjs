#!/usr/bin/env node
/**
 * lin-dedup-backfill.mjs — one-time, REVERSIBLE de-duplication of stored records.
 *
 * Persists the dashboard's render-time collapse into the data: a queue row or a
 * pending pipeline row that describes the SAME canonical job as a more
 * authoritative record (an active folder, a higher-ranked queue row, or a newer
 * pending row) is marked as a duplicate.
 *
 * Safety contract:
 *   - NEVER deletes a record; only sets state fields / flips a pending checkbox.
 *   - NEVER touches job folders (companies/…) — duplicate folders are reported,
 *     not modified.
 *   - --apply writes only AFTER a timestamped backup of the two data files, so
 *     the prior state is fully restorable.
 *
 *   node scripts/lin-dedup-backfill.mjs            # dry-run: print the plan
 *   node scripts/lin-dedup-backfill.mjs --apply    # back up, then write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalKey, canonicalizeUrl, hasCanonicalIdentity, strictTitleKey } from "./lib/canonical.mjs";
import * as data from "./lib/tracker-data.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const now = new Date().toISOString();

// Folders in these statuses are NOT actively tracked — a repost can legitimately
// re-enter, so they don't win a dedup contest.
const ARCHIVE_STATUS = new Set(["closed"]);
// Queue rows we may mark — the ones that currently render as live review/pending.
const LIVE_QUEUE = new Set(["recommended", "evaluated"]);

// Primacy is a TUPLE [typeRank, sub] compared lexicographically, so a within-type
// tiebreak (a big date int, a score) can never leak across types. Authoritative
// order: active folder > live queue > pending. An archived folder ranks at 0 so a
// genuine repost (a fresh queue/pending row) can still win and stay visible.
const FOLDER_STAGE = { offer: 100, interviewing: 95, applied: 90, materials_ready: 70, built: 60, staged: 50 };
const better = (a, b) => (a.typeRank !== b.typeRank ? a.typeRank > b.typeRank : a.sub > b.sub);

data.init(VAULT);
const jobs = data.walkJobs();

const byKey = new Map();
// Group ONLY by a key with real identity on both sides; degenerate keys (blank
// company/role, "(manual add)" / "(unscored)" placeholders) get a unique key so
// they never group and can never be marked — same guard the render uses.
const push = (canon, rec) => {
  const key = hasCanonicalIdentity(canon) ? canon : `__uniq__:${rec.type}:${rec.label}`;
  rec.key = key;
  (byKey.get(key) || byKey.set(key, []).get(key)).push(rec);
};

// ---- folders (authoritative; never mutated) ----
const activeFolderKeys = new Map(); // key → count of active folders (for the dup-folder report)
for (const j of jobs) {
  const canon = String(j.source_canonical_key || "").trim() || canonicalKey(j.coSlug, j.title || j.jobSlug);
  const active = !ARCHIVE_STATUS.has(String(j.status || ""));
  if (active && hasCanonicalIdentity(canon)) activeFolderKeys.set(canon, (activeFolderKeys.get(canon) || 0) + 1);
  push(canon, { type: "folder", typeRank: active ? 3 : 0, sub: FOLDER_STAGE[j.status] ?? 40, label: `${j.coSlug}/${j.jobSlug}`, status: j.status,
    title: j.title || j.jobSlug, url: j.source_url || "", canonUrl: canonicalizeUrl(j.source_url || ""), dupOf: j.source_duplicate_of || "" });
}

// ---- raw evaluation-queue.json ----
const queuePath = path.join(VAULT, "data", "evaluation-queue.json");
const queueDoc = JSON.parse(fs.readFileSync(queuePath, "utf8"));
const queueRoles = Array.isArray(queueDoc.roles) ? queueDoc.roles : [];
queueRoles.forEach((r, idx) => {
  const canon = String(r.canonical_key || "").trim() || canonicalKey(r.company || r.co_slug || "", r.role || "");
  push(canon, { type: "queue", typeRank: 2, sub: Number(r.score) || 0, label: `#${r.id}`, idx, live: LIVE_QUEUE.has(r.queue_state), state: r.queue_state,
    title: r.role || "", url: r.url || "", canonUrl: canonicalizeUrl(r.url || ""), dupOf: r.duplicate_of || r.source_duplicate_of || "" });
});

// ---- raw pipeline.md ----
const pipelinePath = path.join(VAULT, "data", "pipeline.md");
const pipelineLines = (fs.existsSync(pipelinePath) ? fs.readFileSync(pipelinePath, "utf8") : "").split("\n");
const PENDING_RE = /^- \[ \] (\d{4}-\d{2}-\d{2}) \| (.+)$/;
pipelineLines.forEach((line, lineNo) => {
  const m = PENDING_RE.exec(line);
  if (!m) return;
  const rest = m[2];
  const urlM = /(https?:\/\/[^\s|]+)/.exec(rest);
  if (!urlM) return;
  const url = urlM[1].replace(/[)\].,;]+$/, "");
  const firstPipe = rest.indexOf(" | ");
  const company = firstPipe >= 0 ? rest.slice(0, firstPipe).trim() : "";
  const after = firstPipe >= 0 ? rest.slice(firstPipe + 3) : rest;
  const role = after.slice(0, after.indexOf(url)).replace(/\s*\|\s*$/, "").trim();
  const dupOf = /dup_of=([^\s|]+)/.exec(rest)?.[1] || "";
  push(canonicalKey(company, role), { type: "pending", typeRank: 1, sub: Number(String(m[1]).replace(/-/g, "")), label: url.slice(0, 55), lineNo,
    title: role, url, canonUrl: canonicalizeUrl(url), dupOf });
});

// A mark is only allowed when there is STRONG evidence the two records are the same
// real job — NOT merely a shared parenthetical-stripped canonical key. Otherwise the
// pair is uncertain and goes to manual review (never mutated). This is the
// destructive-path guardrail: render-time collapse can be loose (reversible, visible);
// persisting queue_state:duplicate must not.
function strongMatch(r, w) {
  if (r.canonUrl && w.canonUrl && r.canonUrl === w.canonUrl) return "same-url";
  if (r.dupOf && (r.dupOf === w.url || canonicalizeUrl(r.dupOf) === w.canonUrl)) return "dup_of";
  if (w.dupOf && (w.dupOf === r.url || canonicalizeUrl(w.dupOf) === r.canonUrl)) return "dup_of";
  if (r.title && w.title && strictTitleKey(r.title) === strictTitleKey(w.title)) return "same-title";
  return null;
}

// ---- decide winners, collect mutations + uncertain ----
const queueMarks = [], pipelineMarks = [], uncertain = [];
for (const [key, recs] of byKey) {
  if (recs.length < 2) continue;
  let winner = recs[0];
  for (const r of recs) if (better(r, winner)) winner = r;
  for (const r of recs) {
    if (r === winner) continue;
    // Only LIVE queue rows and pending rows are mark candidates. Folders and
    // already-resolved queue rows (duplicate/closed/skipped) are neither marked
    // nor surfaced as "uncertain" — they're not pending decisions.
    const eligible = (r.type === "queue" && r.live) || r.type === "pending";
    if (!eligible) continue;
    const evidence = strongMatch(r, winner);
    if (!evidence) {
      uncertain.push({ label: r.label, title: r.title, winner: winner.label, winnerTitle: winner.title, key });
      continue;
    }
    if (r.type === "queue") queueMarks.push({ idx: r.idx, label: r.label, key, winner: winner.label, evidence });
    else pipelineMarks.push({ lineNo: r.lineNo, label: r.label, key, winner: winner.label, evidence });
  }
}

// ---- report ----
const dupFolders = [...activeFolderKeys.entries()].filter(([, n]) => n > 1);
console.log(`Lin dedup backfill — ${APPLY ? "APPLY" : "DRY-RUN"}`);
console.log(`  canonical groups: ${byKey.size}`);
console.log(`  queue rows → duplicate (strong evidence): ${queueMarks.length}`);
console.log(`  pipeline rows → [x] dup (strong evidence): ${pipelineMarks.length}`);
console.log(`  UNCERTAIN (same key, weak evidence — manual review, NOT mutated): ${uncertain.length}`);
console.log(`  duplicate ACTIVE folders (out of scope — reported only): ${dupFolders.length}`);
const sample = (arr, n = 12) => arr.slice(0, n).forEach((m) => console.log(`     ${m.label}  →  dup of ${m.winner}  (${m.evidence})  [${m.key}]`));
if (queueMarks.length) { console.log("\n  -- queue rows to mark duplicate --"); sample(queueMarks); }
if (pipelineMarks.length) { console.log("\n  -- pipeline rows to mark [x] dup --"); sample(pipelineMarks); }
if (uncertain.length) {
  console.log("\n  -- UNCERTAIN (left for manual review) --");
  uncertain.slice(0, 12).forEach((u) => console.log(`     ${u.label} "${u.title}"  vs  ${u.winner} "${u.winnerTitle}"`));
}
if (dupFolders.length) {
  console.log("\n  -- duplicate active folders (handle separately) --");
  dupFolders.slice(0, 15).forEach(([k, n]) => console.log(`     ${n}× ${k}`));
}

// Always (re)write the uncertain-pairs review file so it never goes stale.
const reviewPath = path.join(VAULT, "data", "duplicate-uncertain-review.md");
const reviewBody = `# Uncertain duplicate pairs — manual review\n\n`
  + `Generated by lin-dedup-backfill. These share a parenthetical-stripped canonical key\n`
  + `but lack strong evidence (same URL / dup_of / location-only title difference), so the\n`
  + `backfill did **not** mutate them. The dashboard still collapses them visually. Confirm\n`
  + `each is truly the same role, or leave as distinct.\n\n`
  + (uncertain.length
      ? `| record | title | vs winner | winner title |\n|---|---|---|---|\n`
        + uncertain.map((u) => `| \`${u.label}\` | ${u.title} | \`${u.winner}\` | ${u.winnerTitle} |`).join("\n") + "\n"
      : `_None — every same-key pair had strong evidence._\n`);

if (!APPLY) {
  console.log("\n(dry-run — no writes. re-run with --apply to commit, after a backup is taken automatically.)");
  process.exit(0);
}

// ---- apply (backup first) ----
const ts = now.replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(VAULT, "backups", `dedup-backfill-${ts}`);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(queuePath, path.join(backupDir, "evaluation-queue.json"));
if (fs.existsSync(pipelinePath)) fs.copyFileSync(pipelinePath, path.join(backupDir, "pipeline.md"));
console.log(`\nBackup written: ${path.relative(VAULT, backupDir)}/`);

for (const m of queueMarks) {
  const r = queueRoles[m.idx];
  r.queue_state = "duplicate";
  r.recommendation = "duplicate";
  r.notes = [...(r.notes || []), `${now} dedup-backfill: duplicate of ${m.winner} (canonical ${m.key})`];
}
fs.writeFileSync(queuePath, JSON.stringify(queueDoc, null, 2) + "\n");

for (const m of pipelineMarks) {
  const line = pipelineLines[m.lineNo];
  if (!line.startsWith("- [ ] ")) continue;
  pipelineLines[m.lineNo] = line.replace("- [ ] ", "- [x] ") + ` → dup of ${m.winner}`;
}
fs.writeFileSync(pipelinePath, pipelineLines.join("\n"));

fs.writeFileSync(reviewPath, reviewBody);

console.log(`\nApplied: ${queueMarks.length} queue + ${pipelineMarks.length} pipeline rows marked duplicate.`);
console.log(`${uncertain.length} uncertain pairs written to data/duplicate-uncertain-review.md (not mutated).`);
console.log("Re-run `node scripts/lin-tracker.mjs` to refresh the dashboard.");
