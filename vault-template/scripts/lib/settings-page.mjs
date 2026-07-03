/**
 * settings-page.mjs — server-rendered /settings page for lin-serve.mjs.
 *
 * Reads live config at request time (pipeline-config.json, scan-channels.json,
 * ../cron/jobs.json) and renders a self-contained page. All writes go through
 * the lin-serve endpoints, which back up before writing.
 */
import fs from "node:fs";
import path from "node:path";

export const PROFILE_FILES = ["resume.md", "experience.md", "cover-letter-base.md", "narrative.md", "linkedin.md", "profile.yml"];

// key → [section, label, hint, min, max, isFloat]
export const CONFIG_FIELDS = {
  "auto_build_floor":        ["Build trigger", "Auto-build floor", "absolute score cutoff for auto-builds (junk floor, not a daily cap)", 3, 5, true],
  "auto_build_top_n":        ["Build trigger", "Auto-build top-N", "applyable roles kept prepared daily (top by score); a Prepare click overrides the floor", 0, 20, false],
  "promote_threshold":       ["Build trigger", "Eligibility floor", "below this a role can't be staged or flagged", 3, 5, true],
  "promote_limit":           ["Build trigger", "Promote limit", "max promotions per stage run", 1, 100, false],
  "prepare_retry_budget":    ["Build trigger", "Gate retry budget", "quality-gate retries per resume", 0, 3, false],
  "deep_prep_threshold":     ["Deep prep", "Deep-prep threshold", "interview packages for roles ≥ this", 3, 5, true],
  "deep_prep_cap":           ["Deep prep", "Deep-prep cap", "max packages per run", 0, 50, false],
  "daily.scan_cap":          ["Daily caps", "Portal scan cap", "max new roles per portal scan", 0, 500, false],
  "daily.scan_linkedin_cap": ["Daily caps", "LinkedIn scan cap", "", 0, 200, false],
  "daily.scan_indeed_cap":   ["Daily caps", "Indeed scan cap", "", 0, 200, false],
  "daily.scan_gmail_cap":    ["Daily caps", "Gmail scan cap", "", 0, 200, false],
  "daily.scan_manual_cap":   ["Daily caps", "Manual add cap", "", 0, 200, false],
  "daily.score_cap":         ["Daily caps", "Score cap", "max evaluations per score run", 0, 500, false],
  "daily.prepare_cap":       ["Daily caps", "Stage cap", "max stagings per run", 0, 100, false],
  "greenfield.score_cap":    ["Greenfield drains", "Drain score cap", "for bin/lin-run score --greenfield", 0, 1000, false],
  "greenfield.score_timebox_min": ["Greenfield drains", "Drain timebox (min)", "", 5, 600, false],
  "greenfield.prepare_cap":  ["Greenfield drains", "Drain stage cap", "", 0, 200, false],
};

export const CHANNELS = {
  linkedin: "LinkedIn scan — browser-only; needs a logged-in CDP Chrome (ensure_chrome_cdp.py)",
  indeed: "Indeed scan — browser-only; needs a logged-in CDP Chrome",
  gmail: "Gmail job discovery — needs Google OAuth/himalaya (distinct from the live Gmail status check)",
};

const get = (obj, dotted) => dotted.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSettingsPage({ vault }) {
  const cfg = JSON.parse(fs.readFileSync(path.join(vault, "career-profile", "pipeline-config.json"), "utf8"));
  const channels = JSON.parse(fs.readFileSync(path.join(vault, "career-profile", "scan-channels.json"), "utf8"));
  let followupsEnabled = false;
  let autorunEnabled = 0;
  const AUTORUN_JOBS = ["lin-scan", "lin-status", "lin-score", "lin-stage", "lin-build", "lin-finalize", "lin-deep-prep", "lin-track"];
  try {
    const jobs = JSON.parse(fs.readFileSync(path.join(vault, "..", "cron", "jobs.json"), "utf8")).jobs;
    followupsEnabled = Boolean(jobs.find((j) => j.id === "lin-followups")?.enabled);
    autorunEnabled = AUTORUN_JOBS.filter((id) => jobs.find((j) => j.id === id)?.enabled).length;
  } catch {}

  const sections = {};
  for (const [key, [section, label, hint, min, max, isFloat]] of Object.entries(CONFIG_FIELDS)) {
    const v = get(cfg, key);
    (sections[section] ??= []).push(
      `<label class="field"><span>${esc(label)}<small>${esc(hint)}</small></span>` +
      `<input name="${esc(key)}" type="number" value="${v ?? ""}" min="${min}" max="${max}" step="${isFloat ? "0.05" : "1"}"></label>`
    );
  }
  const cfgHtml = Object.entries(sections).map(([s, fields]) =>
    `<fieldset><legend>${esc(s)}</legend>${fields.join("")}</fieldset>`).join("");

  const autorunHtml = `<label class="toggle" style="border-color:var(--ac)"><input type="checkbox" id="autorun-master" ${autorunEnabled === AUTORUN_JOBS.length ? "checked" : ""}>` +
    `<b>Lin autorun — master switch</b><small>${autorunEnabled}/${AUTORUN_JOBS.length} scheduled jobs enabled (scan · status · score · stage · build · finalize · deep-prep · track). Off = nothing runs on schedule; everything stays available manually (/lin, bin/lin-run, dashboard buttons). The serve-watchdog stays on either way.</small></label>`;

  const chHtml = autorunHtml + Object.entries(CHANNELS).map(([ch, hint]) =>
    `<label class="toggle"><input type="checkbox" class="ch" data-channel="${ch}" ${channels[ch]?.enabled ? "checked" : ""}>` +
    `<b>${ch}</b><small>${esc(hint)}</small></label>`).join("") +
    `<label class="toggle"><input type="checkbox" id="followups" ${followupsEnabled ? "checked" : ""}>` +
    `<b>follow-ups cron</b><small>weekday 15:00 stale-application nudge drafts (lin-followups)</small></label>`;

  const filesHtml = PROFILE_FILES.map((f) => {
    const p = path.join(vault, "career-profile", f);
    const st = fs.existsSync(p) ? fs.statSync(p) : null;
    return `<button class="file" data-file="${f}">${f}<small>${st ? `${(st.size / 1024).toFixed(1)}KB · ${st.mtime.toISOString().slice(0, 16).replace("T", " ")}` : "missing"}</small></button>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lin — Settings</title><style>
:root{--bg:#0d1117;--panel:#161b22;--fg:#c9d1d9;--mut:#8b949e;--br:#30363d;--ac:#58a6ff;--acbg:#1f6feb;--ok:#3fb950;--bad:#f85149;font-family:ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--panel:#fff;--fg:#1f2328;--mut:#6a737d;--br:#d8dee6;--ac:#2456d6;--acbg:#2456d6;font-family:system-ui,sans-serif}}
body{margin:0;background:var(--bg);color:var(--fg);font-size:13.5px;line-height:1.5;font-family:inherit}
.wrap{max-width:900px;margin:0 auto;padding:14px}
a{color:var(--ac);text-decoration:none}
h1{font-size:17px}h2{font-size:14px;margin:22px 0 8px}
fieldset{border:1px solid var(--br);border-radius:8px;background:var(--panel);margin:0 0 10px;display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;padding:10px 14px}
legend{padding:0 6px;color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0}
.field span{display:flex;flex-direction:column}.field small,.toggle small{color:var(--mut)}
input[type=number]{width:90px;background:var(--bg);color:var(--fg);border:1px solid var(--br);border-radius:6px;padding:4px 8px;font:inherit}
.toggle{display:flex;gap:10px;align-items:baseline;background:var(--panel);border:1px solid var(--br);border-radius:8px;padding:9px 14px;margin:0 0 6px}
.toggle small{display:block}
button{font:inherit;cursor:pointer;border:1px solid var(--br);background:var(--panel);color:var(--fg);border-radius:6px;padding:5px 14px}
button.pri{background:var(--acbg);color:#fff;border-color:var(--acbg)}
.file{display:inline-flex;flex-direction:column;align-items:flex-start;margin:0 6px 6px 0}
.file small{color:var(--mut)}
#editor{display:none;margin-top:10px}
#editor textarea{width:100%;min-height:420px;background:var(--panel);color:var(--fg);border:1px solid var(--br);border-radius:8px;padding:10px;font:inherit;font-size:12.5px}
#toast{position:fixed;bottom:14px;right:14px;max-width:420px;background:var(--panel);border:1px solid var(--br);border-left:3px solid var(--ac);border-radius:8px;padding:8px 12px;display:none}
#toast.err{border-left-color:var(--bad)}#toast.show{display:block}
.note{color:var(--mut);font-size:12px}
</style></head><body><div class="wrap">
<h1><a href="/">← dashboard</a> &nbsp;·&nbsp; ⚙ Lin Settings</h1>
<p class="note">Every save backs up the file first (backups/settings/). Threshold changes apply on the next run; resume/profile edits apply on the next build. Numbers are validated server-side.</p>

<h2>Thresholds &amp; caps</h2>
<form id="cfg">${cfgHtml}</form>
<button class="pri" id="save-cfg">Save thresholds &amp; caps</button>

<h2>Features &amp; channels</h2>
${chHtml}
<p class="note">Channel toggles edit scan-channels.json (next scan run picks them up). The follow-ups toggle pauses/resumes its cron job.</p>

<h2>Profile files</h2>
<div>${filesHtml}</div>
<div id="editor">
  <p><b id="ed-name"></b> <span class="note" id="ed-meta"></span></p>
  <textarea id="ed-text" spellcheck="false"></textarea>
  <p><button class="pri" id="ed-save">Save (backs up first)</button> <button id="ed-close">Close</button></p>
</div>
<div id="toast"></div>
</div><script>
const $=s=>document.querySelector(s);let tt=null;
function toast(m,e){const t=$("#toast");t.textContent=m;t.classList.toggle("err",!!e);t.classList.add("show");clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("show"),6000)}
async function post(p,b){const r=await fetch(p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false){toast(d.error||"HTTP "+r.status,true);return null}return d}
$("#save-cfg").onclick=async()=>{const vals={};for(const i of document.querySelectorAll("#cfg input"))if(i.value!=="")vals[i.name]=Number(i.value);const d=await post("/settings-config",{values:vals});if(d)toast("saved — backup: "+d.backup)};
for(const c of document.querySelectorAll("input.ch"))c.onchange=async()=>{const d=await post("/settings-channels",{channel:c.dataset.channel,enabled:c.checked});if(d)toast(c.dataset.channel+" → "+(c.checked?"enabled (next scan run)":"disabled"));else c.checked=!c.checked};
$("#autorun-master").onchange=async function(){const d=await post("/cron-toggle",{job:"all-lin",enabled:this.checked});if(d)toast("Lin autorun "+(this.checked?"ON — schedule resumes":"OFF — schedule paused; manual runs still work"));else this.checked=!this.checked};
$("#followups").onchange=async function(){const d=await post("/cron-toggle",{job:"lin-followups",enabled:this.checked});if(d)toast("follow-ups cron "+(this.checked?"resumed":"paused"));else this.checked=!this.checked};
let curFile=null,loadedAt=null;
for(const b of document.querySelectorAll("button.file"))b.onclick=async()=>{const f=b.dataset.file;const r=await fetch("/profile-file?name="+encodeURIComponent(f));const d=await r.json();if(!d.ok)return toast(d.error,true);curFile=f;loadedAt=d.mtime;$("#ed-name").textContent=f;$("#ed-meta").textContent="loaded "+(d.mtime||"");$("#ed-text").value=d.content;$("#editor").style.display="block";window.scrollTo(0,document.body.scrollHeight)};
$("#ed-close").onclick=()=>{$("#editor").style.display="none";curFile=null};
$("#ed-save").onclick=async()=>{if(!curFile)return;const d=await post("/profile-file",{name:curFile,content:$("#ed-text").value,loaded_mtime:loadedAt});if(d){loadedAt=d.mtime;toast("saved — backup: "+d.backup)}};
</script></body></html>`;
}
