#!/usr/bin/env node
/**
 * lin-serve.mjs — localhost control server for the Lin dashboard.
 *
 * Bound to 127.0.0.1 only. Serves the static tracker HTML same-origin and
 * exposes action endpoints that spawn the existing deterministic scripts
 * (argv arrays, no shell). When this server is down the dashboard buttons
 * degrade to copy-the-CLI-command — nothing breaks.
 *
 *   GET  /                 → data/applications.html (open THIS in the browser)
 *   GET  /health           → { ok: true, vault }
 *   POST /apply            { co, slug }
 *   POST /wont-apply       { items: [{ ref: "#123"|"co/slug", reason?, rejected? }] }
 *   POST /request-build    { ids: ["123", …], clear? }
 *   POST /run-stage        { stage: "score"|"stage"|"build"|"finalize" }
 *   POST /add-jobs         { urls: ["https://…", …] }
 *   POST /promote          { id: "123" }            (admin; holds unless liveness-active)
 *
 * Usage: node scripts/lin-serve.mjs   (LIN_SERVE_PORT overrides 7777)
 */
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderSettingsPage, PROFILE_FILES, CONFIG_FIELDS, CHANNELS } from "./lib/settings-page.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");
const PORT = Number(process.env.LIN_SERVE_PORT) || 7777;
// Default binds all interfaces so the dashboard works from other devices on your
// LAN/Tailscale. Lock down with LIN_SERVE_HOST=127.0.0.1 if the machine sits on
// an untrusted network — these endpoints mutate vault data.
const HOST = process.env.LIN_SERVE_HOST || "0.0.0.0";
const HERMES = process.env.LIN_HERMES_BIN || "hermes"; // test hook

const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const REF_RE = /^(#?\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)$/;
const ID_RE = /^#?\d+$/;
const STAGES = new Set(["score", "stage", "build", "finalize", "build-forge"]);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req, res) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e4) req.destroy(); // 10KB guard
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { sendJson(res, 400, { ok: false, error: "invalid JSON body" }); resolve(null); }
    });
  });
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: VAULT });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    child.on("error", (e) => resolve({ code: -1, out: "", err: e.message }));
  });
}

function lastJson(out) {
  const line = String(out || "").trim().split("\n").pop() || "";
  try { return JSON.parse(line); } catch { return null; }
}

const script = (name) => path.join(__dirname, name);

// ---------- endpoint handlers ----------
async function hApply(body, res) {
  const { co, slug } = body;
  if (!co || !slug || !SLUG_RE.test(co) || !SLUG_RE.test(slug)) {
    return sendJson(res, 400, { ok: false, error: "co and slug required (alnum . _ - only)" });
  }
  const r = await run(process.execPath, [script("lin-apply.mjs"), `${co}/${slug}`, "--yes", "--json"]);
  const parsed = lastJson(r.out) || { ok: false, error: (r.err || r.out || `exit ${r.code}`) };
  return sendJson(res, parsed.ok ? 200 : 409, parsed);
}

async function hWontApply(body, res) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : null;
  if (!items?.length) return sendJson(res, 400, { ok: false, error: "items[] required" });
  const results = [];
  for (const it of items) {
    const ref = String(it.ref || "");
    if (!REF_RE.test(ref)) { results.push({ ref, ok: false, error: "bad ref" }); continue; }
    const args = [script("lin-wont-apply.mjs")];
    if (it.rejected) args.push("--rejected");
    args.push(ref.startsWith("#") || /^\d+$/.test(ref) ? `#${ref.replace(/^#/, "")}` : ref);
    if (it.reason) args.push(String(it.reason).slice(0, 300));
    const r = await run(process.execPath, args);
    results.push({ ref, ok: r.code === 0, error: r.code === 0 ? undefined : (r.err || r.out || `exit ${r.code}`).slice(0, 300) });
  }
  return sendJson(res, 200, { ok: results.every((x) => x.ok), results });
}

// NOTE: geo-blocked rows are intentionally allowed through here. Flagging a role
// for build (build_requested) is the deliberate override the pipeline honors; the
// dashboard's confirm dialog is a mis-click guard, NOT a cost/security policy
// boundary. Don't add a server-side geo check without changing that design intent.
async function hRequestBuild(body, res) {
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 50) : null;
  if (!ids?.length) return sendJson(res, 400, { ok: false, error: "ids[] required" });
  const results = [];
  for (const raw of ids) {
    const id = String(raw).replace(/^#/, "");
    if (!ID_RE.test(id)) { results.push({ ref: `#${id}`, ok: false, error: "bad id" }); continue; }
    const args = [script("lin-evaluation-queue.mjs"), "request-build", "--id", id];
    if (body.clear) args.push("--clear");
    const r = await run(process.execPath, args);
    results.push({ ref: `#${id}`, ok: r.code === 0, error: r.code === 0 ? undefined : (r.err || `exit ${r.code}`).slice(0, 300) });
  }
  return sendJson(res, 200, { ok: results.every((x) => x.ok), results });
}

const lastTrigger = new Map(); // stage → ts; platform drops mid-run triggers, this just stops spamming
// Manual outcome / furthest-stage override from the dashboard's outcome editor.
// Sticky (source: manual) — the email scanner won't overwrite it.
async function hSetOutcome(body, res) {
  const { co, slug, outcome, stage } = body;
  if (!co || !slug || !SLUG_RE.test(co) || !SLUG_RE.test(slug)) {
    return sendJson(res, 400, { ok: false, error: "co and slug required (alnum . _ - only)" });
  }
  if (!outcome && !stage) return sendJson(res, 400, { ok: false, error: "outcome and/or stage required" });
  const args = [script("lin-set-outcome.mjs"), "--ref", `${co}/${slug}`, "--json"];
  if (outcome) args.push("--outcome", String(outcome));
  if (stage) args.push("--stage", String(stage));
  const r = await run(process.execPath, args);
  const parsed = lastJson(r.out) || { ok: false, error: (r.err || r.out || `exit ${r.code}`).slice(0, 300) };
  return sendJson(res, parsed.ok ? 200 : 409, parsed);
}

async function hRunStage(body, res) {
  const stage = String(body.stage || "");
  if (!STAGES.has(stage)) return sendJson(res, 400, { ok: false, error: `stage must be one of ${[...STAGES].join("|")}` });
  const now = Date.now();
  if (now - (lastTrigger.get(stage) || 0) < 120000) {
    return sendJson(res, 429, { ok: false, error: `lin-${stage} already triggered <2min ago` });
  }
  // "build" stage routes to lin-build-forge when the fastpath is active
  const cronId = stage === "build" ? "lin-build-forge" : `lin-${stage}`;
  const r = await run(HERMES, ["-p", "lin", "cron", "run", cronId]);
  if (r.code !== 0) return sendJson(res, 502, { ok: false, error: (r.err || r.out || `exit ${r.code}`).slice(0, 300) });
  lastTrigger.set(stage, now);
  return sendJson(res, 200, { ok: true, stage, note: "fires on the next scheduler tick (≤60s)" });
}

async function hAddJobs(body, res) {
  const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((u) => /^https?:\/\/\S+$/.test(u)).slice(0, 25);
  if (!urls.length) return sendJson(res, 400, { ok: false, error: "urls[] of http(s) links required" });
  // URL-only candidates — the append helper fills readable placeholders and the
  // scorer derives the real company/role from the JD. (Sending fake "?" values
  // here used to get every add rejected by the title filter.)
  const candidates = urls.map((url) => ({ url }));
  const tmp = path.join(os.tmpdir(), `lin-addjobs-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(candidates));
  const r = await run(process.execPath, [script("lin-discovery-append.mjs"), "--source", "manual", "--file", tmp, "--json"]);
  fs.unlinkSync(tmp);
  if (r.code !== 0) return sendJson(res, 502, { ok: false, error: (r.err || r.out || `exit ${r.code}`).slice(0, 400) });
  // --json prints a machine-readable stats line on stdout; the digest is on stderr.
  const stats = lastJson(r.out) || {};
  await run(process.execPath, [script("lin-tracker.mjs")]);
  return sendJson(res, 200, {
    ok: true,
    added: Number.isFinite(stats.added) ? stats.added : null,
    duplicates: Number.isFinite(stats.duplicates) ? stats.duplicates : null,
    filtered: Number.isFinite(stats.filtered) ? stats.filtered : null,
    out: (r.err || r.out).slice(-400),
  });
}

// ---------- settings ----------
function backupFile(abs) {
  const dir = path.join(VAULT, "backups", "settings");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(dir, `${path.basename(abs)}.${ts}.bak`);
  fs.copyFileSync(abs, dest);
  return path.relative(VAULT, dest);
}

function setPath(obj, dotted, value) {
  const keys = dotted.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys[keys.length - 1]] = value;
}

async function hSettingsConfig(body, res) {
  const vals = body.values && typeof body.values === "object" ? body.values : null;
  if (!vals) return sendJson(res, 400, { ok: false, error: "values{} required" });
  const p = path.join(VAULT, "career-profile", "pipeline-config.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  const rejected = [];
  for (const [key, raw] of Object.entries(vals)) {
    const spec = CONFIG_FIELDS[key];
    const n = Number(raw);
    if (!spec || !Number.isFinite(n) || n < spec[3] || n > spec[4]) { rejected.push(key); continue; }
    setPath(cfg, key, spec[5] ? n : Math.round(n));
  }
  if (rejected.length === Object.keys(vals).length) {
    return sendJson(res, 400, { ok: false, error: `no valid keys (rejected: ${rejected.join(", ")})` });
  }
  const backup = backupFile(p);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  return sendJson(res, 200, { ok: true, backup, rejected: rejected.length ? rejected : undefined });
}

async function hSettingsChannels(body, res) {
  const ch = String(body.channel || "");
  if (!CHANNELS[ch]) return sendJson(res, 400, { ok: false, error: `channel must be one of ${Object.keys(CHANNELS).join("|")}` });
  const p = path.join(VAULT, "career-profile", "scan-channels.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!cfg[ch] || typeof cfg[ch] !== "object") return sendJson(res, 409, { ok: false, error: `channel '${ch}' missing from scan-channels.json` });
  const backup = backupFile(p);
  cfg[ch].enabled = Boolean(body.enabled);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 1) + "\n");
  return sendJson(res, 200, { ok: true, backup, channel: ch, enabled: cfg[ch].enabled });
}

const AUTORUN_JOBS = ["lin-scan","lin-status","lin-score","lin-stage","lin-build-forge","lin-deep-prep","lin-track"];

function autorunState() {
  try {
    const jobs = JSON.parse(fs.readFileSync(path.join(VAULT, "..", "cron", "jobs.json"), "utf8")).jobs;
    const enabled = AUTORUN_JOBS.filter((id) => jobs.find((j) => j.id === id)?.enabled).length;
    return { enabled, total: AUTORUN_JOBS.length };
  } catch { return { enabled: 0, total: AUTORUN_JOBS.length }; }
}

async function hCronToggle(body, res) {
  const verb = body.enabled ? "resume" : "pause";
  if (body.job === "all-lin") {
    const results = [];
    for (const id of AUTORUN_JOBS) {
      const r = await run(HERMES, ["-p", "lin", "cron", verb, id]);
      results.push({ id, ok: r.code === 0, error: r.code === 0 ? undefined : (r.err || r.out || `exit ${r.code}`).slice(0, 120) });
    }
    const st = autorunState();
    return sendJson(res, 200, { ok: results.every((x) => x.ok), results, ...st });
  }
  if (body.job !== "lin-followups") return sendJson(res, 400, { ok: false, error: "job must be lin-followups or all-lin" });
  const r = await run(HERMES, ["-p", "lin", "cron", verb, "lin-followups"]);
  if (r.code !== 0) return sendJson(res, 502, { ok: false, error: (r.err || r.out || `exit ${r.code}`).slice(0, 300) });
  return sendJson(res, 200, { ok: true, job: "lin-followups", enabled: Boolean(body.enabled) });
}

function profilePath(name, res) {
  if (!PROFILE_FILES.includes(name)) { sendJson(res, 400, { ok: false, error: `name must be one of ${PROFILE_FILES.join("|")}` }); return null; }
  return path.join(VAULT, "career-profile", name);
}

function hProfileFileGet(url, res) {
  const p = profilePath(url.searchParams.get("name") || "", res);
  if (!p) return;
  if (!fs.existsSync(p)) return sendJson(res, 404, { ok: false, error: "file missing" });
  return sendJson(res, 200, { ok: true, content: fs.readFileSync(p, "utf8"), mtime: fs.statSync(p).mtime.toISOString() });
}

async function hProfileFilePost(body, res) {
  const p = profilePath(String(body.name || ""), res);
  if (!p) return;
  const content = String(body.content ?? "");
  if (content.length > 300000) return sendJson(res, 400, { ok: false, error: "content too large (300KB cap)" });
  if (!content.trim()) return sendJson(res, 400, { ok: false, error: "refusing to write an empty file" });
  if (fs.existsSync(p) && body.loaded_mtime && fs.statSync(p).mtime.toISOString() !== body.loaded_mtime) {
    return sendJson(res, 409, { ok: false, error: "file changed on disk since you loaded it — reload before saving" });
  }
  const backup = fs.existsSync(p) ? backupFile(p) : null;
  fs.writeFileSync(p, content);
  return sendJson(res, 200, { ok: true, backup, mtime: fs.statSync(p).mtime.toISOString() });
}

// ---------- cover generation (detached one-shot on the frontier build model) ----------
const coverRunning = new Map(); // co/slug → ts
async function hCover(body, res) {
  const { co, slug } = body;
  if (!co || !slug || !SLUG_RE.test(co) || !SLUG_RE.test(slug)) {
    return sendJson(res, 400, { ok: false, error: "co and slug required" });
  }
  const ref = `${co}/${slug}`;
  const ymlPath = path.join(VAULT, "companies", co, "jobs", slug, "job.yml");
  if (!fs.existsSync(ymlPath)) return sendJson(res, 404, { ok: false, error: `no job folder for ${ref}` });
  const status = /^status:\s*['"]?([^'"\n#]+)/m.exec(fs.readFileSync(ymlPath, "utf8"))?.[1]?.trim();
  if (!["materials_ready", "applied", "built"].includes(status)) {
    return sendJson(res, 409, { ok: false, error: `${ref} is '${status}' — covers need built materials` });
  }
  if (Date.now() - (coverRunning.get(ref) || 0) < 10 * 60 * 1000) {
    return sendJson(res, 429, { ok: false, error: `cover for ${ref} already generating (<10min ago)` });
  }
  let model = "gpt-5.5", provider = "openai-codex";
  try {
    const jobs = JSON.parse(fs.readFileSync(path.join(VAULT, "..", "cron", "jobs.json"), "utf8")).jobs;
    const b = jobs.find((j) => j.id === "lin-build-forge") || jobs.find((j) => j.id === "lin-build");
    if (b?.model) { model = b.model; provider = b.provider || provider; }
  } catch {}
  const logPath = path.join(os.tmpdir(), `lin-cover-${co}-${slug}.log`);
  const fd = fs.openSync(logPath, "a");
  const bin = process.env.LIN_COVER_BIN || path.join(VAULT, "scripts", "lin-run");
  const child = spawn("bash", [bin, "finalize", `cover ${ref}`, "-m", model, "--provider", provider],
    { cwd: VAULT, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  fs.closeSync(fd);
  coverRunning.set(ref, Date.now());
  return sendJson(res, 200, { ok: true, ref, model, note: "generating (~1-3 min) — reload the dashboard after; log: " + logPath });
}

// ---------- run-pipeline: detached stage → build-forge chain ----------
// The one-click answer to "I flagged a role, run it NOW": lin-run executes each
// stage synchronously on its pinned cron model, chained in a detached shell.
let pipelineStartedAt = 0;
async function hRunPipeline(body, res) {
  if (Date.now() - pipelineStartedAt < 15 * 60 * 1000) {
    return sendJson(res, 429, { ok: false, error: "pipeline chain already running (<15min ago) — reload to see progress" });
  }
  const bin = process.env.LIN_PIPELINE_BIN || path.join(VAULT, "scripts", "lin-run");
  const logPath = path.join(os.tmpdir(), `lin-pipeline-${Date.now()}.log`);
  const fd = fs.openSync(logPath, "a");
  const child = spawn("bash", ["-c", `"${bin}" stage auto && "${bin}" build-forge batch`],
    { cwd: VAULT, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  fs.closeSync(fd);
  pipelineStartedAt = Date.now();
  return sendJson(res, 200, { ok: true, note: "stage → build-forge chain started (~5-15 min); reload the dashboard after. log: " + logPath });
}

async function hPromote(body, res) {
  const id = String(body.id || "").replace(/^#/, "");
  if (!ID_RE.test(id)) return sendJson(res, 400, { ok: false, error: "id required" });
  const r = await run(process.execPath, [script("lin-promote-evaluations.mjs"), `--id=${id}`]);
  return sendJson(res, r.code === 0 ? 200 : 409, { ok: r.code === 0, out: (r.out || r.err).slice(-500) });
}

const POST_ROUTES = {
  "/apply": hApply,
  "/wont-apply": hWontApply,
  "/request-build": hRequestBuild,
  "/run-stage": hRunStage,
  "/add-jobs": hAddJobs,
  "/promote": hPromote,
  "/settings-config": hSettingsConfig,
  "/settings-channels": hSettingsChannels,
  "/cron-toggle": hCronToggle,
  "/profile-file": hProfileFilePost,
  "/cover": hCover,
  "/run-pipeline": hRunPipeline,
  "/set-outcome": hSetOutcome,
};

// ---------- read-only static artifact serving ----------
// The dashboard links to ../reports/…, ../companies/…/, ../jds/…, eval PDFs, etc.
// Those resolve under file:// but 404 over HTTP without this. We serve ONLY from a
// whitelist of vault subdirs, and only after resolving the REAL path (symlinks
// included) and confirming it stays inside the vault — so `..`/symlink escapes
// can't read arbitrary files. Read-only: GET streams the file, nothing mutates.
// career-profile is intentionally NOT here — those files are config, not linked
// artifacts, and the settings page serves the few it needs via /profile-file.
const STATIC_ROOTS = new Set(["reports", "companies", "jds", "deep-prep", "evals", "output"]);
const CONTENT_TYPES = {
  ".md": "text/markdown; charset=utf-8", ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".yml": "text/plain; charset=utf-8", ".yaml": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
};
function streamFile(abs, res) {
  const ct = CONTENT_TYPES[path.extname(abs).toLowerCase()] || "application/octet-stream";
  cors(res);
  res.writeHead(200, { "Content-Type": ct, "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(abs).pipe(res);
}

// Returns true when it owns the request (served a file/listing or sent an error),
// false when the path isn't a whitelisted artifact root (caller falls through to 404).
function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname.replace(/^\/+/, "")); }
  catch { sendJson(res, 400, { ok: false, error: "bad path" }); return true; }
  const segments = rel.split("/");
  const top = segments[0];
  if (!STATIC_ROOTS.has(top)) return false;
  // Defense in depth: after decoding, reject any traversal/current segment so a
  // %2e%2e%2f sequence can't climb out of the whitelisted root before we resolve.
  if (segments.some((s) => s === ".." || s === ".")) {
    sendJson(res, 403, { ok: false, error: "forbidden" }); return true;
  }
  // Confine to the REAL whitelisted root, not just the vault. Escaping `reports/`
  // into a sibling (career-profile/, data/) must be denied even though it stays
  // inside the vault — and resolving via realpath also blocks a symlink inside the
  // root that points elsewhere.
  let rootReal, real;
  try { rootReal = fs.realpathSync(path.join(VAULT, top)); }
  catch { sendJson(res, 404, { ok: false, error: "not found" }); return true; }
  try { real = fs.realpathSync(path.resolve(VAULT, rel)); }
  catch { sendJson(res, 404, { ok: false, error: "not found" }); return true; }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    sendJson(res, 403, { ok: false, error: "forbidden" }); return true;
  }
  const st = fs.statSync(real);
  if (st.isDirectory()) {
    // Serve a known index if one exists; do NOT enumerate directory contents.
    // The server binds 0.0.0.0 by design (phone/LAN/Tailscale), so a listing would
    // leak filenames across the LAN — an index keeps folder links working without it.
    const idx = ["index.html", "PACKAGE.md", "README.md"].map((f) => path.join(real, f)).find((p) => fs.existsSync(p));
    if (idx) { streamFile(idx, res); return true; }
    sendJson(res, 404, { ok: false, error: "no index for this directory" });
    return true;
  }
  streamFile(real, res);
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, vault: VAULT, service: "lin-serve" });
  }
  if (req.method === "GET" && url.pathname === "/autorun-state") {
    return sendJson(res, 200, { ok: true, ...autorunState() });
  }
  if (req.method === "GET" && url.pathname === "/settings") {
    try {
      cors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderSettingsPage({ vault: VAULT }));
    } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
  }
  if (req.method === "GET" && url.pathname === "/profile-file") {
    return hProfileFileGet(url, res);
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const htmlPath = path.join(VAULT, "data", "applications.html");
    if (!fs.existsSync(htmlPath)) return sendJson(res, 404, { ok: false, error: "tracker not generated yet" });
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(htmlPath, "utf8"));
  }
  if (req.method === "POST" && POST_ROUTES[url.pathname]) {
    const body = await readBody(req, res);
    if (body === null) return;
    try { return await POST_ROUTES[url.pathname](body, res); }
    catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
  }
  if (req.method === "GET" || req.method === "HEAD") {
    try { if (serveStatic(url.pathname, res)) return; }
    catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
  }
  sendJson(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`lin-serve listening on http://${HOST}:${PORT}`);
  console.log(`  vault: ${VAULT}`);
  console.log(`  GET  /          → dashboard (open this in your browser!)`);
  console.log(`  POST /apply /wont-apply /request-build /run-stage /add-jobs /promote`);
});
