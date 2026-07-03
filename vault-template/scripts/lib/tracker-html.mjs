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

const ATS_ICON = {
  greenhouse: "🌿", ashby: "⚡", workday: "🏢", lever: "🔧",
  linkedin: "🔗", indeed: "🎯", workable: "🛠️", smartrecruiters: "📋",
  bamboohr: "🎋", jobvite: "📬", icims: "🔵", wellfound: "🚀",
  breezy: "🌬️", ultipro: "📊", paylocity: "💰", adp: "📈",
  oraclecloud: "☁️", dayforce: "📅", beamery: "🔍", pinpoint: "📍",
  sapfiori: "💼", cornerstone: "🧱", other: "🌐",
};

function atsCell(ats) {
  const a = ats || { id: "other", label: "Other" };
  const icon = ATS_ICON[a.id] || "🌐";
  return `<span class="ats ats-${escapeHtml(a.id)}" title="${escapeHtml(a.label)}">${icon} ${escapeHtml(a.label)}</span>`;
}

const LEVEL_COLOR = {
  Group: "#f85149", Director: "#d29922", Principal: "#58a6ff",
  Staff: "#3fb950", Senior: "#8b949e", PM: "#6e7681",
};

function levelCell(level) {
  const l = level || "PM";
  const color = LEVEL_COLOR[l] || "#6e7681";
  return `<span class="lvl" style="color:${color}" title="seniority level derived from the role title">${escapeHtml(l)}</span>`;
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STAGE_LABEL = {
  pending: "pending", "review-hi": "top match ⭐", review: "match", skip: "skip",
  staged: "staged", built: "built", ready: "ready", applied: "applied",
  interviewing: "interviewing", offer: "offer", wont: "wont", closed: "closed",
  rejected: "rejected", withdrew: "withdrew", declined: "declined", expired: "expired",
};

// Rows for which a manual outcome+depth override makes sense (you've applied, or it
// already ended). Pre-apply review/pending rows are excluded.
const POST_APPLY = new Set(["applied", "interviewing", "offer", "rejected", "withdrew", "declined", "expired"]);

const OUTCOME_OPTS = [
  ["", "— live —"], ["rejected", "rejected"], ["withdrew", "withdrew"], ["declined", "declined (offer)"],
  ["offer", "offer"], ["accepted", "accepted"], ["expired", "expired"],
];
const STAGE_OPTS = [
  ["applied", "after applying"], ["interviewing", "after interviews"],
  ["final", "after final round"], ["offer", "after offer"],
];

function outcomeEditor(r) {
  if (!POST_APPLY.has(r.stage)) return "";
  const sel = (opts, cur) => opts.map(([v, label]) =>
    `<option value="${escapeHtml(v)}"${String(cur || "") === v ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  return `<div class="kv secondary"><b>outcome</b> ` +
    `<select class="osel" data-field="outcome">${sel(OUTCOME_OPTS, r.outcome)}</select> ` +
    `<select class="osel" data-field="stage" title="furthest stage reached">${sel(STAGE_OPTS, r.furthestStage)}</select> ` +
    `<button class="btn" data-act="set-outcome" title="record this outcome + depth manually (sticks — the email scan won't overwrite it)">Save outcome</button></div>`;
}

// Seniority level derived purely from the role title at render time (no backend
// model change). Highest-rank prefix wins, so "Senior Principal PM" → Principal,
// not Senior. Order matters: Group > Director > Principal > Staff > Senior > PM.
function seniorityLevel(role) {
  const t = String(role || "");
  if (/\bgroup\b/i.test(t)) return "Group";
  if (/\bdirector\b/i.test(t)) return "Director"; // catches "Associate Director" too
  if (/\bprincipal\b/i.test(t)) return "Principal";
  if (/\bstaff\b/i.test(t)) return "Staff";
  if (/\bsenior\b|\bsr\.?\b/i.test(t)) return "Senior";
  return "PM";
}

function payCell(pay) {
  const p = pay || { tier: "unknown", label: "—", num: -1 };
  if (p.tier === "unknown") return `<span class="pay pay-unknown">—</span>`;
  return `<span class="pay pay-${p.tier}" title="bucketed from the stated pay">${escapeHtml(p.label)}</span>`;
}

function recencyCell(rec) {
  const r = rec || { bucket: "none", label: "—", source: null, days: -1 };
  if (r.bucket === "none") return `<span class="rec rec-none">—</span>`;
  const fresh = r.bucket === "d1" ? "🆕 " : "";
  return `<span class="rec rec-${r.bucket}" title="${r.source === "posted" ? "from the listing's posted date" : "when Lin first saw this role (proxy for posted)"}">${fresh}${escapeHtml(r.label)}</span>`;
}

function scoreCell(s, threshold) {
  if (s == null) return '<span class="score lo">—</span>';
  const cls = s >= threshold ? "hi" : s >= 3.0 ? "mid" : "lo";
  return `<span class="score ${cls}">${s.toFixed(2).replace(/0$/, "")}</span>`;
}

function canadaCell(v, reason) {
  const label = { yes: "Y", no: "N", unknown: "?" }[v] || "?";
  return `<span class="ca-${v}" title="${escapeHtml(reason || `Canada: ${v}`)}">🇨🇦${label}</span>`;
}

function isLivenessStuck(r) {
  return Boolean(
    r.kind === "queue" &&
    r.buildRequestedAt &&
    r.liveness &&
    r.livenessResult !== "active"
  );
}

function actionCell(r) {
  const out = [];
  const stuck = isLivenessStuck(r);
  if (stuck) {
    out.push(`<span class="chip stage-closed" title="${escapeHtml(r.liveness)}">stuck: no apply path</span>`);
  }
  for (const a of r.actions) {
    if (a === "prepare") {
      if (stuck) {
        out.push(`<button class="btn pri" data-act="prepare" title="retry liveness/stage; previous run found no verified apply path">Retry Prepare</button>`);
      } else if (r.buildRequestedAt) {
        out.push(`<button class="btn done" disabled>requested ✓</button> <button class="btn" data-act="run-pipeline" title="run stage → build → finalize now (~5-15 min) instead of waiting for the next cycle">⚡ now</button>`);
      } else if (r.geoBlocked) {
        // Caution Prepare: the auto-pipeline skips this location; clicking overrides
        // the geo gate and spends a frontier build. The JS reads data-geo-* to confirm first.
        const t = `${r.geoReason} — Lin's auto-pipeline skips this location. Prepare overrides the geo gate and spends a frontier-model build.`;
        out.push(`<button class="btn geo" data-act="prepare" data-geo-blocked="1" data-geo-reason="${escapeHtml(r.geoReason)}" title="${escapeHtml(t)}">⚠ Prepare</button>`);
      } else {
        out.push(`<button class="btn pri" data-act="prepare">Prepare</button>`);
      }
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
    L.jd && (/^about:/i.test(L.jd)
      ? `<span class="key" title="the scanner couldn't recover the original posting URL — see the report instead">jd (unrecovered)</span>`
      : `<a href="${escapeHtml(L.jd)}" target="_blank" rel="noopener">jd</a>`),
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
  if (r.buildModel) kv.push(`<span class="kv secondary" title="LLM that generated these resumes"><b>🤖 built by</b> ${escapeHtml(r.buildModel)}${r.buildProvider ? `/${escapeHtml(r.buildProvider)}` : ""}</span>`);
  if (r.statusDetail) kv.push(`<span class="kv"><b>detail</b> ${escapeHtml(r.statusDetail)}</span>`);
  const hist = (r.history || []).length
    ? `<div class="kv"><b>history</b> ${r.history.map((h) => escapeHtml(h)).join(" · ")}</div>` : "";
  const dups = (r.dupSiblings || []).length
    ? `<div class="kv"><b>duplicates (${r.dupSiblings.length})</b> ${r.dupSiblings.map((s) => {
        const label = escapeHtml(s.id ? `#${s.id}` : s.key);
        const meta = escapeHtml(`${s.stage} · ${sourceLabel(s.source)}`);
        return (s.url && /^https?:/i.test(s.url))
          ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${label}</a> <span class="key">${meta}</span>`
          : `<span>${label}</span> <span class="key">${meta}</span>`;
      }).join(" · ")}</div>`
    : "";
  let coverCtl;
  if (r.coverWinner) {
    const link = r.links?.cover ? ` <a href="${escapeHtml(r.links.cover)}">PDF</a>` : "";
    coverCtl = `<span class="ok-chip" title="cover letter generated and packaged">✓ Cover generated (${escapeHtml(r.coverWinner)})</span>${link} <button class="btn" data-act="cover" title="re-run the dual-draft cover flow">Regenerate</button>`;
  } else {
    const need = r.coverRequired ? ` <span class="chip stage-review-hi" title="the application form appears to ask for a cover letter">cover requested</span>` : "";
    coverCtl = `<button class="btn" data-act="cover" title="dual drafts → compare → PDF → re-package, on the frontier build model">✍ Generate cover (~2 min)</button>${need}`;
  }
  const secondary = r.stage === "ready"
    ? `<div class="kv secondary"><b>secondary</b> ${coverCtl} <button class="btn" data-act="rebuild" title="copies the bin/lin-run build command for this role">Rebuild resumes</button></div>` : "";
  return `<div class="links">${links || "—"}</div><div>${kv.join(" &nbsp; ")}</div>${secondary}${outcomeEditor(r)}${hist}${dups}`;
}

function rowHtml(r, threshold) {
  const text = `${r.company} ${r.role} ${r.key} ${r.verdict || ""}`.toLowerCase();
  const sel = r.actions.length ? `<input type="checkbox" class="sel">` : "";
  const stuck = isLivenessStuck(r);
  const level = seniorityLevel(r.role);
  return `<tr class="r" data-stage="${r.stage}" data-kind="${r.kind}" data-key="${escapeHtml(r.key)}"${r.id ? ` data-id="${escapeHtml(r.id)}"` : ""}${r.coSlug ? ` data-co="${escapeHtml(r.coSlug)}"` : ""}${r.jobSlug ? ` data-slug="${escapeHtml(r.jobSlug)}"` : ""} data-level="${level}" data-score="${r.score ?? ""}" data-pay-num="${r.pay?.num ?? -1}" data-recency-days="${r.recency?.days ?? -1}" data-canada="${r.canada}" data-source="${r.source}" data-ats="${escapeHtml(r.ats?.id || "other")}" data-updated="${escapeHtml(r.updated || "")}"${r.atsWinner ? ` data-winner="${escapeHtml(r.atsWinner)}"` : ""}${stuck ? ` data-liveness-stuck="1"` : ""}${r.geoBlocked ? ` data-geo-blocked="1" data-geo-reason="${escapeHtml(r.geoReason)}"` : ""} data-text="${escapeHtml(text)}">
<td>${sel}</td>
<td class="co"><b>${escapeHtml(r.company)}</b><span class="role">${escapeHtml(r.role)}</span><div class="key">${escapeHtml(r.key)}</div>${r.dupCount ? `<span class="chip" title="${r.dupCount} duplicate posting(s) of this role collapsed — open details (▸) to see them">+${r.dupCount} dup</span>` : ""}</td>
<td><span class="chip stage-${r.stage}">${STAGE_LABEL[r.stage] || r.stage}</span>${r.depthLabel ? `<span class="depth" title="furthest stage reached">${escapeHtml(r.depthLabel)}</span>` : ""}</td>
<td>${levelCell(level)}</td>
<td>${scoreCell(r.score, threshold)}</td>
<td>${payCell(r.pay)}</td>
<td>${canadaCell(r.canada, r.canadaReason)}</td>
<td><span class="chip" title="source">${escapeHtml(sourceLabel(r.source))}</span></td>
<td>${atsCell(r.ats)}</td>
<td>${recencyCell(r.recency)}</td>
<td>${escapeHtml(r.updated || "—")}</td>
<td class="act">${actionCell(r)}</td>
</tr>
<tr class="xp" style="display:none"><td colspan="12">${expandCell(r)}</td></tr>`;
}

function railHtml(counts) {
  // NOTE: a <button> may not contain another <button> (browsers split the DOM and
  // the count lands outside the row) — so the run-now chip is a SIBLING inside a
  // .stagerow flex wrapper, never a child of the stage button.
  const stage = (key, label, extra = "", title = "") =>
    `<div class="stagerow"><button class="stage" data-stage="${key}"${title ? ` title="${title}"` : ""}><span>${label}</span><span class="n">${counts[key] || 0}</span></button>${extra}</div>`;
  const run = (s) => (counts[s] > 0 ? `<button class="runbtn" data-run-stage="${s === "staged" ? "build" : "finalize"}" title="trigger the ${s === "staged" ? "build" : "finalize"} cron now">▶</button>` : "");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return `
<div class="stagerow"><button class="stage" data-stage="all"><span>☰ All roles</span><span class="n">${total}</span></button></div>
${stage("pending", "⏳ Pending")}
${stage("review-hi", "🧮 Top matches ⭐", "", "scored at or above the build floor — one click (Prepare) from building materials")}
${stage("review", "Other matches", "", "scored 3.0 up to the build floor — reviewable, not build-eligible at current thresholds")}
${stage("staged", "🎯 Staged", run("staged"))}
${stage("built", "🛠️ Built", run("built"))}
${stage("ready", "📦 Ready")}
${stage("applied", "📡 Applied")}
${stage("interviewing", "Interviewing")}
${stage("offer", "Offer")}
<div class="group">
  <div class="grouphead" data-group="archive-group">▸ Archive</div>
  <div id="archive-group" style="display:none">
    ${stage("rejected", "❌ Rejected")}
    ${stage("declined", "🙅 Declined offer")}
    ${stage("withdrew", "↩ Withdrew")}
    ${stage("expired", "⌛ Expired")}
    ${stage("wont", "Won't apply")}
    ${stage("closed", "Closed (dupe/err)")}
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
  <div class="grouphead" data-group="winrate-group">▸ Resume engine (4wk)</div>
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
      <select id="f-level" title="seniority level (derived from the role title)">
        <option value="any">level: any</option>
        <option value="Group">Group</option>
        <option value="Director">Director</option>
        <option value="Principal">Principal</option>
        <option value="Staff">Staff</option>
        <option value="Senior">Senior</option>
        <option value="PM">PM</option>
      </select>
      <select id="f-ats" title="ATS platform (derived from the apply URL)">
        <option value="any">ats: any</option>
        <option value="greenhouse">🌿 Greenhouse</option>
        <option value="ashby">⚡ Ashby</option>
        <option value="workday">🏢 Workday</option>
        <option value="lever">🔧 Lever</option>
        <option value="linkedin">🔗 LinkedIn</option>
        <option value="indeed">🎯 Indeed</option>
        <option value="workable">🛠️ Workable</option>
        <option value="smartrecruiters">📋 SmartRecruiters</option>
        <option value="wellfound">🚀 Wellfound</option>
        <option value="bamboohr">🎋 BambooHR</option>
        <option value="jobvite">📬 Jobvite</option>
        <option value="icims">🔵 ICIMS</option>
        <option value="breezy">🌬️ Breezy</option>
        <option value="ultipro">📊 UKG/UltiPro</option>
        <option value="paylocity">💰 Paylocity</option>
        <option value="adp">📈 ADP</option>
        <option value="oraclecloud">☁️ Oracle Cloud</option>
        <option value="dayforce">📅 Dayforce</option>
        <option value="beamery">🔍 Beamery</option>
        <option value="pinpoint">📍 Pinpoint</option>
        <option value="sapfiori">💼 SAP Fiori</option>
        <option value="cornerstone">🧱 Cornerstone</option>
        <option value="other">🌐 Other</option>
      </select>
      <span class="addbox">
        <input id="add-urls" placeholder="+ paste job URL(s) — manual add">
        <button id="add-btn" title="adds to the pipeline as source: manual">Add</button>
      </span>
    </div>
    <div class="tablewrap">
      <table class="main">
        <thead><tr><th></th><th data-col="text">company / role</th><th data-col="stage">stage</th><th data-col="level">level</th><th data-col="score">score</th><th data-col="pay" title="bucketed from the JD's stated pay; — when none">pay</th><th data-col="canada">🇨🇦</th><th data-col="source">src</th><th data-col="ats">ats</th><th data-col="recency" title="posted Nd from the listing; else seen Nd from when Lin found it">posted</th><th data-col="updated">updated</th><th style="text-align:right">actions</th></tr></thead>
        <tbody>
${bodyRows}
        </tbody>
      </table>
      <div id="zero" class="zero-state" style="display:none">nothing in this stage with the current filters</div>
    </div>
  </main>
</div>
<div id="selbar"><span class="n">0 selected</span><button class="btn pri" id="bulk-prepare">Prepare</button><button class="btn warn" id="bulk-wont">Won't apply</button><button class="btn" id="bulk-run-pipeline" data-act="run-pipeline">⚡ Run pipeline now</button><button class="btn" id="sel-clear">clear</button></div>
<div id="toast"></div>
<script>${js}</script>
</body>
</html>
`;
}
