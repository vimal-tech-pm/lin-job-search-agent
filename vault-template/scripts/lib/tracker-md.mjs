/**
 * tracker-md.mjs — markdown renderers (applications.md + resume-engine-usage.md + outcome-funnel.md).
 *
 * Moved verbatim from lin-tracker.mjs in the Phase 7 split. Output is
 * byte-compatible with the pre-split renderer — the no_agent track cron and
 * downstream consumers depend on it. Do not restyle casually.
 */
import {
  cfg,
  isWontApplyDetail,
  isWontApplyQueueRow,
  sourceBadgeMd,
  duplicateBadgeMd,
  sourceSummaryText,
} from "./tracker-data.mjs";

export function renderTracker(jobs, wr, queue, pipelineRows) {
  const { promote_threshold: PROMOTE_THRESHOLD, review_upper: REVIEW_UPPER } = cfg();
  const now = new Date().toISOString();
  pipelineRows = pipelineRows || [];
  const pendingCount = pipelineRows.length;
  const wontApplyJobs = jobs.filter((j) => j.status === "closed" && isWontApplyDetail(j.status_detail));
  const active = jobs.filter((j) =>
    ["staged", "built", "materials_ready", "applied", "interviewing"].includes(j.status)
  );
  const closed = jobs.filter((j) => ["offer", "closed"].includes(j.status) && !isWontApplyDetail(j.status_detail));
  const recommended = (queue || []).filter((r) => r.queue_state === "recommended")
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const review = (queue || []).filter((r) => r.queue_state === "evaluated" && r.recommendation === "review")
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const skip = (queue || []).filter((r) => r.queue_state === "evaluated" && r.recommendation === "skip")
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const wontApplyQueue = (queue || []).filter(isWontApplyQueueRow)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // Same dedup as the HTML view: a role declined after staging is both a closed
  // job folder and a skipped queue row — show it once (under Lin-managed jobs).
  const jobMatchesQueueRow = (j, r) =>
    (r.co_slug === j.coSlug && r.job_slug === j.jobSlug) ||
    (r.promotion?.job_folder || "").replace(/\/$/, "") === `companies/${j.coSlug}/jobs/${j.jobSlug}`;
  const wontApplyQueueOnly = wontApplyQueue.filter((r) => !wontApplyJobs.some((j) => jobMatchesQueueRow(j, r)));
  const stagedJobs = active.filter((j) => j.status === "staged" && !j.ats_winner);
  const builtJobs = active.filter((j) => j.status === "built" && !j.ats_winner);
  const materialsReadyJobs = active.filter((j) => j.status === "materials_ready");

  const lines = [];
  lines.push("# Lin — Applications Tracker (generated view)");
  lines.push("");
  lines.push(`> **${wr.digestLine}**`);
  lines.push("");
  lines.push(`**Last regenerated:** ${now}`);
  lines.push(`**Source of truth:** \`engines/pathfinder/data/applications.md\` (PATHFINDER's authoritative tracker) + every \`companies/*/jobs/*/job.yml\` + \`data/evaluation-queue.json\` (bridge). This view is the merge.`);
  lines.push(`**Regenerator:** \`scripts/lin-tracker.mjs\` (deterministic; safe to re-run).`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Funnel");
  lines.push("");
  lines.push(`- **Pending** (unevaluated in \`data/pipeline.md\`): ${pendingCount}`);
  lines.push(`- **Recommended for staging** (queue, score ≥ ${PROMOTE_THRESHOLD}, no geo block): ${recommended.length}`);
  lines.push(`- **Review queue** (queue, score 3.0–${REVIEW_UPPER} or geo-blocked ≥${PROMOTE_THRESHOLD}): ${review.length}`);
  lines.push(`- **SKIP (< 3.0)** (queue, scored below 3.0): ${skip.length}`);
  lines.push(`- **Won’t apply** (manually declined): ${wontApplyJobs.length + wontApplyQueueOnly.length}`);
  lines.push(`- **Staged / awaiting build** (\`job.yml\` status staged, \`ats_winner\` null): ${stagedJobs.length}`);
  lines.push(`- **Built / awaiting finalize** (\`job.yml\` status built, gate passed): ${builtJobs.length}`);
  lines.push(`- **Materials ready** (\`job.yml\` status materials_ready): ${materialsReadyJobs.length}`);
  lines.push("");
  lines.push(`**Source mix — pending:** ${sourceSummaryText("pending", pipelineRows).replace(/^pending: /, "")}`);
  lines.push(`**Source mix — queue:** ${sourceSummaryText("queue", queue || []).replace(/^queue: /, "")}`);
  lines.push(`**Source mix — Lin-managed:** ${sourceSummaryText("managed", jobs || []).replace(/^managed: /, "")}`);
  lines.push("");
  const canadaCell = (v) => ({ yes: "🇨🇦 Y", no: "🇨🇦 N", unknown: "🇨🇦 ?" }[v] || "🇨🇦 ?");
  if (recommended.length) {
    lines.push("## Recommended for staging");
    lines.push("");
    lines.push("| #ID | Source | Co | Role | Score | Canada | Verdict | URL |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const r of recommended) {
      lines.push(`| #${r.id} | ${sourceBadgeMd(r)} ${duplicateBadgeMd(r) !== "—" ? `(${duplicateBadgeMd(r)})` : ""} | ${r.company} | ${r.role} | ${r.score} | ${canadaCell(r.canada_eligible)} | ${r.verdict || "—"} | <${r.url}> |`);
    }
    lines.push("");
    lines.push(`_Action_: run \`node scripts/lin-promote-evaluations.mjs --id=<NNN>\` to liveness-check + create the \`companies/{co}/jobs/{slug}/\` folder._`);
    lines.push("");
  }
  if (review.length) {
    lines.push("## Review queue");
    lines.push("");
    lines.push("| #ID | Source | Co | Role | Score | Canada | Verdict | Geo block | URL |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of review) {
      const geo = (r.geo_gate?.blocks_stage && r.canada_eligible !== "yes") ? (r.geo_gate.reason || "blocked") : "—";
      lines.push(`| #${r.id} | ${sourceBadgeMd(r)} ${duplicateBadgeMd(r) !== "—" ? `(${duplicateBadgeMd(r)})` : ""} | ${r.company} | ${r.role} | ${r.score} | ${canadaCell(r.canada_eligible)} | ${r.verdict || "—"} | ${geo} | <${r.url}> |`);
    }
    lines.push("");
  }
  if (skip.length) {
    lines.push("## SKIP (< 3.0)");
    lines.push("");
    lines.push("| #ID | Source | Co | Role | Score | Canada | Verdict | Geo block | URL |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of skip) {
      const geo = (r.geo_gate?.blocks_stage && r.canada_eligible !== "yes") ? (r.geo_gate.reason || "blocked") : "—";
      lines.push(`| #${r.id} | ${sourceBadgeMd(r)} ${duplicateBadgeMd(r) !== "—" ? `(${duplicateBadgeMd(r)})` : ""} | ${r.company} | ${r.role} | ${r.score} | ${canadaCell(r.canada_eligible)} | ${r.verdict || "—"} | ${geo} | <${r.url}> |`);
    }
    lines.push("");
  }
  if (wontApplyQueueOnly.length || wontApplyJobs.length) {
    lines.push("## Won’t apply");
    lines.push("");
    if (wontApplyQueueOnly.length) {
      lines.push("### Queue rows");
      lines.push("| #ID | Source | Co | Role | Score | Reason | URL |");
      lines.push("|---|---|---|---|---|---|---|");
      for (const r of wontApplyQueueOnly) {
        lines.push(`| #${r.id} | ${sourceBadgeMd(r)} ${duplicateBadgeMd(r) !== "—" ? `(${duplicateBadgeMd(r)})` : ""} | ${r.company} | ${r.role} | ${r.score ?? "—"} | ${r.liveness?.reason || "won’t_apply"} | <${r.url}> |`);
      }
      lines.push("");
    }
    if (wontApplyJobs.length) {
      lines.push("### Lin-managed jobs");
      lines.push("| Co/Slug | Title | PF Score | Reason | Folder |");
      lines.push("|---|---|---|---|---|");
      for (const j of wontApplyJobs) {
        lines.push(`| ${j.coSlug} / ${j.jobSlug} | ${j.title || "—"} | ${j.pathfinder_score ?? "—"} | ${j.status_detail || "won’t_apply"} | \`${j.folder}\` |`);
      }
      lines.push("");
    }
  }
  lines.push("## Pending intake");
  lines.push("");
  if (pipelineRows.length === 0) {
    lines.push("_(none — all discovered roles are evaluated)_");
  } else {
    lines.push("| Date | Source | Company | Role | Duplicate | URL |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of pipelineRows) {
      lines.push(`| ${r.date || "—"} | ${sourceBadgeMd(r)} | ${r.company || "—"} | ${r.role || "—"} | ${duplicateBadgeMd(r)} | <${r.url}> |`);
    }
  }
  lines.push("");
  lines.push("## Active (status ∈ {staged, built, materials_ready, applied, interviewing})");
  lines.push("");
  if (active.length === 0) {
    lines.push("_(none yet — run `/lin intake <url>` to start)_");
  } else {
    lines.push("| Co/Slug | Source | Title | Status | PF Score | Applied | Resume | Cover | ATS Winner | Folder |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const j of active) {
      const pf = j.pathfinder_score != null
        ? `${j.pathfinder_score}/5${j.pathfinder_verdict ? ` (${j.pathfinder_verdict})` : ""}`
        : "—";
      lines.push(
        `| **${j.coSlug} / ${j.jobSlug}** | ${sourceBadgeMd(j)} ${duplicateBadgeMd(j) !== "—" ? `(${duplicateBadgeMd(j)})` : ""} | ${j.title || "—"} | ${j.status} | ${pf} | ${j.applied_at?.split("T")[0] || "—"} | ${j.applied_with?.resume || "—"} | ${j.applied_with?.cover || "—"} | ${j.ats_winner || "—"} | \`${j.folder}\` |`
      );
    }
  }
  lines.push("");
  lines.push("## Closed / archived (status ∈ {offer, closed})");
  lines.push("");
  if (closed.length === 0) {
    lines.push("_(none)_");
  } else {
    lines.push("| Co/Slug | Title | Status | Applied | Resume Used | Outcome |");
    lines.push("|---|---|---|---|---|---|");
    for (const j of closed) {
      lines.push(
        `| ${j.coSlug} / ${j.jobSlug} | ${j.title || "—"} | ${j.status} | ${j.applied_at?.split("T")[0] || "—"} | ${j.applied_with?.resume || "—"} | ${j.status_detail || "—"} |`
      );
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Counts");
  lines.push(`- Lin-managed jobs: **${jobs.length}** (${active.length} active, ${closed.length} closed)`);
  lines.push(`- Engine-usage window: ${wr.windowDays} days`);
  lines.push(`- Applications in engine-usage window: **${wr.total}**`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderWinRate(wr) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push("# Resume Engine Usage (A/B)");
  lines.push("");
  lines.push(`> Rolling ${wr.windowDays}-day tally of which engine packaged each application (\`job.yml.applied_with.resume\`).`);
  lines.push(`> **This is NOT an interview/offer rate** — for the real job-search funnel see \`outcome-funnel.md\`.`);
  lines.push(`> Regenerated by \`scripts/lin-tracker.mjs\`. **Do not hand-edit** — changes here will be overwritten.`);
  lines.push("");
  lines.push(`**Last refreshed:** ${now}`);
  lines.push(`**Window cutoff:** ${wr.cutoff}`);
  lines.push(`**Applications in window:** ${wr.total}`);
  lines.push("");
  lines.push("## Tally");
  lines.push("");
  lines.push("| Engine | Used | Apps | Usage % |");
  lines.push("|---|---|---|---|");
  lines.push(`| PATHFINDER | ${wr.tally.pathfinder} | ${wr.total} | ${wr.pct(wr.tally.pathfinder)} |`);
  lines.push(`| FORGE | ${wr.tally.forge} | ${wr.total} | ${wr.pct(wr.tally.forge)} |`);
  lines.push("");
  lines.push("## Recent winners (most-recent first)");
  lines.push("");
  if (wr.recent.length === 0) {
    lines.push("_(no Lin-managed applications in window)_");
  } else {
    lines.push("| Applied | Company | Slug | Engine | Notes |");
    lines.push("|---|---|---|---|---|");
    for (const r of wr.recent) {
      lines.push(
        `| ${r.applied_at?.split("T")[0]} | ${r.coSlug} | ${r.jobSlug} | ${r.applied_with?.resume || "?"} | ${r.status_detail || "—"} |`
      );
    }
  }
  lines.push("");
  lines.push("## Digest line (for Telegram weekly tracker)");
  lines.push("");
  lines.push(`> ${wr.digestLine}`);
  lines.push("");
  return lines.join("\n");
}

// outcome-funnel.md — the real job-search funnel (applied → interview → final →
// offer) + rejection-depth distribution over the applied cohort.
export function renderFunnel(f) {
  const now = new Date().toISOString();
  const c = f.counts;
  const t = f.total || 0;
  const pct = (n) => (t === 0 ? "—" : Math.round((n / t) * 100) + "%");
  const lines = [];
  lines.push("# Outcome Funnel");
  lines.push("");
  lines.push("> Conversion across the applied cohort, from `furthest_stage`/`outcome` in `companies/*/jobs/*/job.yml`.");
  lines.push("> Regenerated by `scripts/lin-tracker.mjs`. **Do not hand-edit.** Engine A/B usage lives in `resume-engine-usage.md`.");
  lines.push("");
  lines.push(`**Last refreshed:** ${now}`);
  lines.push(`**Applied applications:** ${t}`);
  lines.push("");
  lines.push("## Stage conversion");
  lines.push("");
  lines.push("| Stage | Reached | % of applied |");
  lines.push("|---|---|---|");
  lines.push(`| Applied | ${c.applied} | ${pct(c.applied)} |`);
  lines.push(`| Interviewing | ${c.interviewing} | ${pct(c.interviewing)} |`);
  lines.push(`| Final round | ${c.final} | ${pct(c.final)} |`);
  lines.push(`| Offer | ${c.offer} | ${pct(c.offer)} |`);
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---|");
  for (const [o, n] of Object.entries(f.outcomeCounts)) if (n) lines.push(`| ${o} | ${n} |`);
  lines.push("");
  lines.push("## Rejection depth (where applications died)");
  lines.push("");
  lines.push("| Died | Count |");
  lines.push("|---|---|");
  lines.push(`| after applying | ${f.rejDepth.applied} |`);
  lines.push(`| after interviews | ${f.rejDepth.interviewing} |`);
  lines.push(`| after final round | ${f.rejDepth.final} |`);
  lines.push("");
  lines.push("## Digest line (for Telegram weekly tracker)");
  lines.push("");
  lines.push(`> Funnel: applied ${c.applied} → interview ${c.interviewing} (${pct(c.interviewing)}) → final ${c.final} (${pct(c.final)}) → offer ${c.offer} (${pct(c.offer)})`);
  lines.push("");
  return lines.join("\n");
}
