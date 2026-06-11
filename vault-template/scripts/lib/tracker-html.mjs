/**
 * tracker-html.mjs — the Phase-7 dashboard renderer (funnel rail + one table).
 *
 * Consumes the unified row model from tracker-data.buildRows() and emits ONE
 * self-contained static HTML file (CSS+JS inlined from scripts/templates/) so
 * the Cloudflare-hosted copy keeps working offline; action buttons are
 * progressive enhancement over lin-serve.mjs on the same origin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cfg, railCounts, sourceLabel } from "./tracker-data.mjs";

const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STAGE_LABEL = {
  pending: "pending", "review-hi": "review ⭐", review: "review", skip: "skip",
  staged: "staged", built: "built", ready: "ready", applied: "applied",
  interviewing: "interviewing", offer: "offer", wont: "wont", closed: "closed",
};

function scoreCell(s, threshold) {
  if (s == null) return '<span class="score lo">—</span>';
  const cls = s >= threshold ? "hi" : s >= 3.0 ? "mid" : "lo";
  return `<span class="score ${cls}">${s.toFixed(2).replace(/0$/, "")}</span>`;
}

function canadaCell(v, reason) {
  const label = { yes: "Y", no: "N", unknown: "?" }[v] || "?";
  return `<span class="ca-${v}" title="${escapeHtml(reason || `Canada: ${v}`)}">🇨🇦${label}</span>`;
}

function actionCell(r) {
  const out = [];
  for (const a of r.actions) {
    if (a === "prepare") {
      out.push(r.buildRequestedAt
        ? `<button class="btn done" disabled>requested ✓</button> <button class="btn" data-act="run-pipeline" title="run stage → build → finalize now (~5-15 min) instead of waiting for the next cycle">⚡ now</button>`
        : `<button class="btn pri" data-act="prepare">Prepare</button>`);
    }
    if (a === "apply") out.push(`<button class="btn ok" data-act="apply">Applied ✓</button>`);
    if (a === "wont") out.push(`<button class="btn warn" data-act="wont">Won't</button>`);
    if (a === "wont-rejected") out.push(`<button class="btn warn" data-act="wont-rejected" title="company rejected">Rejected</button>`);
  }
  if (r.stage === "staged") out.unshift('<span class="await" title="resumes build on the next build run">awaiting build…</span>');
  if (r.stage === "built") out.unshift('<span class="await" title="compare+package on the next finalize run">awaiting finalize…</span>');
  if (r.stage === "applied" && r.emailStatus) {
    const em = { rejected: "❌", interview: "🎙️", offer: "🎉", acknowledged: "📨" }[r.emailStatus];
    if (em) out.unshift(`<span title="email status: ${escapeHtml(r.emailStatus)}">${em}</span>`);
  }
  out.push(`<button class="xbtn" title="details">▸</button>`);
  return out.join(" ");
}

function expandCell(r) {
  const L = r.links || {};
  const links = [
    L.jd && `<a href="${escapeHtml(L.jd)}" target="_blank" rel="noopener">jd</a>`,
    L.report && `<a href="${escapeHtml(L.report)}">report</a>`,
    L.folder && `<a href="${escapeHtml(L.folder)}">folder</a>`,
    L.ats && `<a href="${escapeHtml(L.ats)}">ats-compare</a>`,
    L.final && `<a href="${escapeHtml(L.final)}">final PDF</a>`,
    L.pkg && `<a href="${escapeHtml(L.pkg)}">PACKAGE.md</a>`,
  ].filter(Boolean).join(" ");
  const kv = [];
  if (r.verdict) kv.push(`<span class="kv"><b>verdict</b> ${escapeHtml(r.verdict)}</span>`);
  if (r.canadaReason) kv.push(`<span class="kv"><b>🇨🇦</b> ${escapeHtml(r.canadaReason)}</span>`);
  if (r.salary) kv.push(`<span class="kv"><b>salary</b> ${escapeHtml(r.salary)}</span>`);
  if (r.liveness) kv.push(`<span class="kv"><b>liveness</b> ${escapeHtml(r.liveness)}</span>`);
  if (r.buildRequestedAt) kv.push(`<span class="kv"><b>build requested</b> ${escapeHtml(String(r.buildRequestedAt).slice(0, 16))}</span>`);
  if (r.atsWinner) kv.push(`<span class="kv"><b>winner</b> ${escapeHtml(r.atsWinner)}</span>`);
  if (r.statusDetail) kv.push(`<span class="kv"><b>detail</b> ${escapeHtml(r.statusDetail)}</span>`);
  const hist = (r.history || []).length
    ? `<div class="kv"><b>history</b> ${r.history.map((h) => escapeHtml(h)).join(" · ")}</div>` : "";
  const secondary = r.stage === "ready"
    ? `<div class="kv secondary"><b>secondary</b> <button class="btn" data-act="cover" title="dual drafts → compare → PDF → re-package, on the frontier build model">✍ Generate cover (~2 min)</button> <button class="btn" data-act="rebuild" title="copies the bin/lin-run build command for this role">Rebuild resumes</button></div>` : "";
  return `<div class="links">${links || "—"}</div><div>${kv.join(" &nbsp; ")}</div>${secondary}${hist}`;
}

function rowHtml(r, threshold) {
  const text = `${r.company} ${r.role} ${r.key} ${r.verdict || ""}`.toLowerCase();
  const sel = r.actions.length ? `<input type="checkbox" class="sel">` : "";
  return `<tr class="r" data-stage="${r.stage}" data-kind="${r.kind}" data-key="${escapeHtml(r.key)}"${r.id ? ` data-id="${escapeHtml(r.id)}"` : ""}${r.coSlug ? ` data-co="${escapeHtml(r.coSlug)}"` : ""}${r.jobSlug ? ` data-slug="${escapeHtml(r.jobSlug)}"` : ""} data-score="${r.score ?? ""}" data-canada="${r.canada}" data-source="${r.source}" data-updated="${escapeHtml(r.updated || "")}"${r.atsWinner ? ` data-winner="${escapeHtml(r.atsWinner)}"` : ""} data-text="${escapeHtml(text)}">
<td>${sel}</td>
<td class="co"><b>${escapeHtml(r.company)}</b><span class="role">${escapeHtml(r.role)}</span><div class="key">${escapeHtml(r.key)}</div></td>
<td><span class="chip stage-${r.stage}">${STAGE_LABEL[r.stage] || r.stage}</span></td>
<td>${scoreCell(r.score, threshold)}</td>
<td>${canadaCell(r.canada, r.canadaReason)}</td>
<td><span class="chip" title="source">${escapeHtml(sourceLabel(r.source))}</span></td>
<td>${escapeHtml(r.updated || "—")}</td>
<td class="act">${actionCell(r)}</td>
</tr>
<tr class="xp" style="display:none"><td colspan="8">${expandCell(r)}</td></tr>`;
}

function railHtml(counts) {
  const stage = (key, label, extra = "") =>
    `<button class="stage" data-stage="${key}"><span>${label}</span>${extra}<span class="n">${counts[key] || 0}</span></button>`;
  const run = (s) => (counts[s] > 0 ? `<button class="runbtn" data-run-stage="${s === "staged" ? "build" : "finalize"}" title="trigger the ${s === "staged" ? "build" : "finalize"} cron now">▶</button>` : "");
  return `
${stage("pending", "⏳ Pending")}
${stage("review-hi", "🧮 Review ≥thr ⭐")}
${stage("review", "Review rest")}
${stage("staged", "🎯 Staged", run("staged"))}
${stage("built", "🛠️ Built", run("built"))}
${stage("ready", "📦 Ready")}
${stage("applied", "📡 Applied")}
${stage("interviewing", "Interviewing")}
${stage("offer", "Offer")}
<div class="group">
  <div class="grouphead" data-group="archive-group">▸ Archive</div>
  <div id="archive-group" style="display:none">
    ${stage("wont", "Won't apply")}
    ${stage("closed", "Closed")}
    ${stage("skip", "SKIP <3.0")}
  </div>
</div>`;
}

function winRateRail(wr) {
  const pct = (n) => wr.total === 0 ? "—" : Math.round((n / wr.total) * 100) + "%";
  const recent = (wr.recent || []).slice(0, 3).map((r) =>
    `<div class="wrline">${escapeHtml(String(r.applied_at || "").slice(5, 10))} ${escapeHtml(r.coSlug)} → ${escapeHtml(r.applied_with?.resume || "?")}</div>`).join("");
  return `
<div class="group">
  <div class="grouphead" data-group="winrate-group">▸ Win-rate (4wk)</div>
  <div id="winrate-group" style="display:none">
    <div class="wrline">PATHFINDER ${wr.tally.pathfinder}/${wr.total} (${pct(wr.tally.pathfinder)})</div>
    <div class="wrline">FORGE ${wr.tally.forge}/${wr.total} (${pct(wr.tally.forge)})</div>
    ${recent}
  </div>
</div>`;
}

export function renderHtml({ rows, wr, generatedAt }) {
  const threshold = cfg().promote_threshold;
  const counts = railCounts(rows);
  const defaultStage = counts.ready > 0 ? "ready" : "review-hi";
  const css = fs.readFileSync(path.join(TPL_DIR, "dashboard.css"), "utf8");
  const js = fs.readFileSync(path.join(TPL_DIR, "dashboard.js"), "utf8");
  // Server-base candidates for when the file is opened directly (file:// or the
  // cloud copy): same-origin first, then localhost, then this machine's LAN IPs.
  const lanIps = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i.address}:7777`);
  const bases = JSON.stringify(["", "http://127.0.0.1:7777", ...lanIps]);
  const bodyRows = rows.map((r) => rowHtml(r, threshold)).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lin — Applications</title>
<style>${css}</style>
<script>window.LIN_BASES = ${bases};</script>
</head>
<body data-default-stage="${defaultStage}">
<div class="wrap">
  <header class="top">
    <h1>Lin</h1>
    <span class="right">
      <span title="lin-serve.mjs reachability"><span id="srv-dot"></span> server</span>
      <a id="gear" href="/settings" title="settings — thresholds, channels, profile files" style="display:none">⚙</a>
      <button id="reload" title="reload page">↻ ${escapeHtml(generatedAt)}</button>
      <button id="theme-toggle">theme</button>
    </span>
  </header>
  <nav class="rail">${railHtml(counts)}${winRateRail(wr)}</nav>
  <main class="body">
    <div class="fbar">
      <input type="search" id="q" placeholder="search company / role / #id…">
      <select id="f-score" title="score band">
        <option value="any">score: any</option>
        <option value="42">≥ 4.2</option>
        <option value="395">≥ 3.95</option>
        <option value="30">3.0–3.95</option>
        <option value="lo">&lt; 3.0 / unscored</option>
      </select>
      <select id="f-canada" title="Canada eligibility">
        <option value="any">🇨🇦 any</option>
        <option value="yes">🇨🇦 yes</option>
        <option value="unknown">🇨🇦 ?</option>
        <option value="no">🇨🇦 no</option>
      </select>
      <select id="f-source" title="discovery source">
        <option value="any">source: any</option>
        <option value="portal">portal</option>
        <option value="linkedin">LinkedIn</option>
        <option value="indeed">Indeed</option>
        <option value="gmail">Gmail</option>
        <option value="manual">Manual</option>
      </select>
      <span class="addbox">
        <input id="add-urls" placeholder="+ paste job URL(s) — manual add">
        <button id="add-btn" title="adds to the pipeline as source: manual">Add</button>
      </span>
    </div>
    <div class="tablewrap">
      <table class="main">
        <thead><tr><th></th><th data-col="text">company / role</th><th data-col="stage">stage</th><th data-col="score">score</th><th data-col="canada">🇨🇦</th><th data-col="source">src</th><th data-col="updated">updated</th><th style="text-align:right">actions</th></tr></thead>
        <tbody>
${bodyRows}
        </tbody>
      </table>
      <div id="zero" class="zero-state" style="display:none">nothing in this stage with the current filters</div>
    </div>
  </main>
</div>
<div id="selbar"><span class="n">0 selected</span><button class="btn pri" id="bulk-prepare">Prepare</button><button class="btn warn" id="bulk-wont">Won't apply</button><button class="btn" id="sel-clear">clear</button></div>
<div id="toast"></div>
<script>${js}</script>
</body>
</html>
`;
}
