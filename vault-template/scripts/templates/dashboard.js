/* Lin dashboard behaviors. Vanilla JS, no deps. Inlined into applications.html at build.
   Server actions are progressive enhancement: when lin-serve.mjs (same origin) is down,
   every action button falls back to copying its CLI command. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ---------- theme ----------
  const root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    localStorage.setItem("lin-theme", t);
    const b = $("#theme-toggle");
    if (b) b.textContent = t === "dark" ? "☀ light" : "● dark";
  }
  applyTheme(localStorage.getItem("lin-theme") ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  $("#theme-toggle")?.addEventListener("click", () =>
    applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark"));

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("err", !!isErr);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 6000);
  }

  // ---------- server discovery (works from file:// and the cloud copy too) ----------
  let serverUp = false;
  let BASE = null; // "" = same-origin; otherwise an absolute http://host:7777
  const CANDIDATES = (window.LIN_BASES || [""]).filter((b, i) => !(b === "" && location.protocol === "file:"));
  async function probe(base) {
    try {
      const r = await fetch(base + "/health", { method: "GET" });
      if (!r.ok) return false;
      const d = await r.json();
      return d && d.service === "lin-serve";
    } catch { return false; }
  }
  async function checkServer() {
    if (BASE !== null && (await probe(BASE))) { serverUp = true; }
    else {
      serverUp = false; BASE = null;
      for (const b of CANDIDATES) {
        if (await probe(b)) { BASE = b; serverUp = true; break; }
      }
    }
    const dot = $("#srv-dot");
    if (!dot) return;
    dot.classList.toggle("up", serverUp);
    dot.parentElement.title = serverUp
      ? "lin-serve reachable at " + (BASE === "" ? location.origin : BASE)
      : "lin-serve unreachable — click for help";
    const g = $("#gear");
    if (g) { g.style.display = serverUp ? "" : "none"; if (serverUp) g.href = (BASE || "") + "/settings"; }
  }
  function copyCli(cmd) {
    (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject())
      .then(() => toast("server unreachable — command copied:\n" + cmd, true))
      .catch(() => toast("server unreachable — run:\n" + cmd, true));
  }
  async function post(pathname, body, cli) {
    if (!serverUp) { await checkServer(); }
    if (!serverUp) { copyCli(cli); return null; }
    try {
      const r = await fetch((BASE || "") + pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) {
        toast((data.error || (data.results || []).map((x) => x.error).filter(Boolean).join("; ")) || ("HTTP " + r.status), true);
        return null;
      }
      return data;
    } catch (e) {
      serverUp = false;
      $("#srv-dot").classList.remove("up");
      copyCli(cli);
      return null;
    }
  }

  // ---------- rail + filters ----------
  const rows = $$("tr.r");
  const RAIL_MATCH = { "review-hi": ["review-hi"], review: ["review"], pending: ["pending"],
    staged: ["staged"], built: ["built"], ready: ["ready"], applied: ["applied"],
    interviewing: ["interviewing"], offer: ["offer"], wont: ["wont"], closed: ["closed"], skip: ["skip"] };
  const ALL = "all"; // "☰ All roles" — no stage filtering, back-to-everything affordance
  let railStage = document.body.dataset.defaultStage || "review-hi";

  function rowVisible(tr) {
    if (railStage !== ALL) {
      const stages = RAIL_MATCH[railStage] || [railStage];
      if (!stages.includes(tr.dataset.stage)) return false;
    }
    const q = ($("#q").value || "").toLowerCase().trim();
    if (q && !((tr.dataset.text || "").includes(q))) return false;
    const band = $("#f-score").value;
    const s = parseFloat(tr.dataset.score);
    if (band === "42" && !(s >= 4.2)) return false;
    if (band === "395" && !(s >= 3.95)) return false;
    if (band === "30" && !(s >= 3.0 && s < 3.95)) return false;
    if (band === "lo" && !(isNaN(s) || s < 3.0)) return false;
    const ca = $("#f-canada").value;
    if (ca !== "any" && tr.dataset.canada !== ca) return false;
    const src = $("#f-source").value;
    if (src !== "any" && tr.dataset.source !== src) return false;
    const lvl = $("#f-level").value;
    if (lvl !== "any" && tr.dataset.level !== lvl) return false;
    const ats = $("#f-ats").value;
    if (ats !== "any" && tr.dataset.ats !== ats) return false;
    return true;
  }

  function refresh() {
    let shown = 0;
    for (const tr of rows) {
      const vis = rowVisible(tr);
      tr.style.display = vis ? "" : "none";
      const xp = tr.nextElementSibling;
      if (xp && xp.classList.contains("xp")) xp.style.display = "none";
      if (!vis) { const cb = $("input.sel", tr); if (cb) cb.checked = false; }
      if (vis) shown++;
    }
    const z = $("#zero"); if (z) z.style.display = shown ? "none" : "";
    $$(".rail .stage").forEach((b) => b.classList.toggle("on", b.dataset.stage === railStage));
    updateSelbar();
  }

  $$(".rail .stage").forEach((b) => b.addEventListener("click", () => { railStage = b.dataset.stage; refresh(); }));
  $$(".rail .grouphead").forEach((h) => h.addEventListener("click", function () {
    const g = document.getElementById(this.dataset.group);
    if (!g) return;
    g.style.display = g.style.display === "none" ? "" : "none";
    this.textContent = (g.style.display === "none" ? "▸" : "▾") + this.textContent.slice(1);
  }));
  ["q", "f-score", "f-canada", "f-source", "f-level", "f-ats"].forEach((id) =>
    $("#" + id)?.addEventListener("input", refresh));

  // ---------- column sort (click a header; expand rows travel with their row) ----------
  let sortCol = null, sortDir = 1;
  function sortKey(tr, col) {
    if (col === "score") { const v = parseFloat(tr.dataset.score); return isNaN(v) ? -Infinity : v; }
    if (col === "pay") { const v = parseFloat(tr.dataset.payNum); return isNaN(v) ? -Infinity : v; } // unknown (-1) sorts last when desc
    if (col === "recency") { const v = parseFloat(tr.dataset.recencyDays); return v < 0 || isNaN(v) ? Infinity : v; } // fewest days = freshest; unknown last when asc
    if (col === "text") return tr.dataset.text || "";
    if (col === "ats") return tr.dataset.ats || "";
    if (col === "level") { const r = {Group:5,Director:4,Principal:3,Staff:2,Senior:1,PM:0}[tr.dataset.level] ?? -1; return r; }
    return tr.dataset[col] || "";
  }
  function sortRows(col) {
    if (sortCol === col) sortDir = -sortDir;
    else { sortCol = col; sortDir = col === "score" || col === "updated" || col === "pay" || col === "level" ? -1 : 1; } // pay/score/updated/level: highest first; recency: freshest (asc) first
    const tbody = rows[0]?.parentElement;
    if (!tbody) return;
    const pairs = rows.map((tr) => ({ tr, xp: tr.nextElementSibling?.classList.contains("xp") ? tr.nextElementSibling : null }));
    pairs.sort((a, b) => {
      const ka = sortKey(a.tr, col), kb = sortKey(b.tr, col);
      return (typeof ka === "number" ? ka - kb : String(ka).localeCompare(String(kb))) * sortDir;
    });
    for (const p of pairs) { tbody.appendChild(p.tr); if (p.xp) tbody.appendChild(p.xp); }
    rows.length = 0; rows.push(...pairs.map((p) => p.tr)); // keep filter order in sync
    $$("table.main th[data-col]").forEach((th) =>
      th.dataset.col === col ? th.setAttribute("data-dir", sortDir === 1 ? "asc" : "desc") : th.removeAttribute("data-dir"));
  }
  $$("table.main th[data-col]").forEach((th) => th.addEventListener("click", () => sortRows(th.dataset.col)));

  // ---------- expand ----------
  function toggleExpand(tr) {
    const xp = tr.nextElementSibling;
    if (!xp || !xp.classList.contains("xp")) return;
    const opening = xp.style.display === "none" || !xp.style.display;
    xp.style.display = opening ? "table-row" : "none";
    const btn = $(".xbtn", tr);
    if (btn) {
      btn.textContent = opening ? "▾" : "▸";
      btn.title = opening ? "hide details" : "details";
    }
  }
  function isRowToggleClick(e) {
    if (e.target.closest(".xbtn")) return true;
    return !e.target.closest("a,button,input,select,textarea,label,[role='button'],[data-act]");
  }
  rows.forEach((tr) => tr.addEventListener("click", (e) => {
    if (isRowToggleClick(e)) toggleExpand(tr);
  }));

  // ---------- selection + sticky bar ----------
  const BULK = { "review-hi": ["prepare", "wont"], review: ["prepare", "wont"], skip: ["prepare", "wont"], staged: ["wont"], built: ["wont"], ready: ["wont"], applied: [] };
  function selected() { return rows.filter((tr) => tr.style.display !== "none" && $("input.sel", tr)?.checked); }
  function updateSelbar() {
    const sel = selected();
    const bar = $("#selbar");
    bar.classList.toggle("show", sel.length > 0);
    if (!sel.length) return;
    $("#selbar .n").textContent = sel.length + " selected";
    const acts = BULK[railStage] || [];
    const canPrepare = sel.some((tr) => $("button[data-act=prepare]", tr));
    const canRun = sel.some((tr) => $("button[data-act=run-pipeline]", tr));
    const prep = $("#bulk-prepare");
    prep.textContent = railStage === "skip" ? "Prepare anyway" : "Prepare";
    prep.style.display = acts.includes("prepare") && canPrepare ? "" : "none";
    $("#bulk-wont").style.display = acts.includes("wont") ? "" : "none";
    $("#bulk-run-pipeline").style.display = canRun ? "" : "none";
  }
  document.addEventListener("change", (e) => { if (e.target.classList?.contains("sel")) updateSelbar(); });
  $("#sel-clear").addEventListener("click", () => { rows.forEach((tr) => { const cb = $("input.sel", tr); if (cb) cb.checked = false; }); updateSelbar(); });

  function refOf(tr) { return tr.dataset.id ? "#" + tr.dataset.id : tr.dataset.co + "/" + tr.dataset.slug; }

  // Returns true if the row was marked requested; false for liveness-stuck rows
  // (their retry button stays put — the caller emits the retry message).
  function markRequested(tr) {
    if (tr.dataset.livenessStuck === "1") return false;
    const btn = $("button[data-act=prepare]", tr);
    if (btn) {
      btn.textContent = "requested ✓"; btn.disabled = true; btn.classList.remove("pri", "geo"); btn.classList.add("done");
      btn.removeAttribute("data-act");
      btn.removeAttribute("data-geo-blocked");
      btn.removeAttribute("data-geo-reason");
      if (!$("button[data-act=run-pipeline]", tr)) {
        const z = document.createElement("button");
        z.className = "btn"; z.dataset.act = "run-pipeline"; z.textContent = "⚡ now";
        z.title = "run stage → build → finalize now (~5-15 min) instead of waiting for the next cycle";
        btn.after(" ", z);
      }
    }
    return true;
  }
  function markWont(tr) {
    tr.dataset.stage = "wont";
    const chip = $(".chip", tr);
    if (chip) { chip.textContent = "wont"; chip.className = "chip stage-wont"; }
    bumpCount("wont", +1);
    refresh();
  }
  function bumpCount(stage, d) {
    const n = $(`.rail .stage[data-stage="${stage}"] .n`);
    if (n) n.textContent = String(Math.max(0, parseInt(n.textContent || "0", 10) + d));
  }

  // ---------- actions ----------
  async function actPrepare(trs) {
    const actionable = trs.filter((tr) => $("button[data-act=prepare]", tr));
    const ids = actionable.map((tr) => tr.dataset.id).filter(Boolean);
    if (!ids.length) { toast("no selected roles need prepare"); return; }
    const skipped = actionable.filter((tr) => tr.dataset.stage === "skip");
    if (skipped.length) {
      const msg = skipped.length === 1
        ? "This job was skipped by Lin. Preparing it will override the skip decision and use resume-build tokens. Continue?"
        : `${skipped.length} selected jobs were skipped by Lin. Preparing them will override the skip decision and use resume-build tokens. Continue?`;
      if (!confirm(msg)) return;
    }
    // Geo-block guard: blocked roles need explicit confirmation — Prepare overrides the
    // location gate and spends a frontier-model build on a role the auto-pipeline skips.
    // Only rows showing a live Prepare button count (an already-requested row has no
    // data-act=prepare, so a bulk re-select doesn't re-trigger the confirm).
    const blocked = actionable.filter((tr) => tr.dataset.stage !== "skip" && tr.dataset.geoBlocked === "1");
    if (!skipped.length && blocked.length) {
      const reasons = [...new Set(blocked.map((tr) => tr.dataset.geoReason || "geo-blocked"))].join(", ");
      const msg = blocked.length === 1
        ? `This role is geo-blocked (${reasons}). Lin's auto-pipeline skips it because the location rules out applying.\n\nPrepare anyway? It overrides the gate and spends a frontier-model résumé build.`
        : `${blocked.length} selected roles are geo-blocked (${reasons}). Lin's auto-pipeline skips them.\n\nPrepare anyway? Each overrides the gate and spends a frontier-model résumé build.`;
      if (!confirm(msg)) return;
    }
    const data = await post("/request-build", { ids },
      ids.map((i) => `node scripts/lin-evaluation-queue.mjs request-build --id ${i}`).join(" && "));
    if (!data) return;
    let okN = 0, stuckN = 0;
    for (const tr of actionable) {
      const res = (data.results || []).find((x) => String(x.ref).replace(/^#/, "") === tr.dataset.id);
      if (!res || res.ok) { okN++; if (!markRequested(tr)) stuckN++; }
    }
    if (stuckN > 0 && stuckN === okN) {
      toast("retry requested — previous liveness failure stays visible until the next stage run verifies an apply path");
    } else if (stuckN > 0) {
      toast(`build requested for ${okN - stuckN} role(s); retried ${stuckN} stuck role(s) — stuck rows stay visible until stage verifies an apply path. Hit ⚡ now to run the chain immediately.`);
    } else {
      toast(`build requested for ${okN} role(s) — runs on the next cycle, or hit ⚡ now to run stage → build → finalize immediately`);
    }
    updateSelbar();
  }
  async function actWont(trs, rejected) {
    const reason = prompt(rejected ? "Rejection note (optional):" : "Reason (optional):", "") ?? null;
    if (reason === null) return;
    const items = trs.map((tr) => ({ ref: refOf(tr), reason, rejected: !!rejected }));
    const data = await post("/wont-apply", { items },
      items.map((it) => `node scripts/lin-wont-apply.mjs "${it.ref}"${reason ? ` ${JSON.stringify(reason)}` : ""}${rejected ? " --rejected" : ""}`).join(" && "));
    if (!data) return;
    let okN = 0;
    for (const tr of trs) {
      const res = (data.results || []).find((x) => x.ref === refOf(tr));
      if (!res || res.ok) { markWont(tr); okN++; }
      else toast(res.error || "failed: " + refOf(tr), true);
    }
    toast(`${okN} role(s) → won't apply`);
  }
  async function actApply(tr) {
    const co = tr.dataset.co, slug = tr.dataset.slug, winner = tr.dataset.winner || "?";
    if (!confirm(`Mark ${co}/${slug} APPLIED with resume=${winner}?\nOnly do this AFTER submitting on the company site.`)) return;
    const data = await post("/apply", { co, slug }, `node scripts/lin-apply.mjs ${co}/${slug} --yes`);
    if (!data) return;
    tr.dataset.stage = "applied";
    const chip = $(".chip", tr);
    if (chip) { chip.textContent = "applied"; chip.className = "chip stage-applied"; }
    const act = $("td.act", tr);
    if (act) act.innerHTML = '<span class="btn done">✓ applied</span>';
    bumpCount("ready", -1); bumpCount("applied", +1);
    toast(`${co}/${slug} recorded as applied`);
    refresh();
  }
  async function actSetOutcome(btn, tr) {
    const co = tr.dataset.co, slug = tr.dataset.slug;
    if (!co || !slug) { toast("manual outcome only applies to built/applied roles", true); return; }
    const xp = btn.closest("tr.xp");
    const outcome = $('select[data-field=outcome]', xp)?.value || "";
    const stage = $('select[data-field=stage]', xp)?.value || "";
    if (!outcome && !stage) { toast("pick an outcome and/or a depth first", true); return; }
    btn.textContent = "saving…"; btn.disabled = true;
    const data = await post("/set-outcome", { co, slug, outcome, stage },
      `node scripts/lin-set-outcome.mjs --ref ${co}/${slug}${outcome ? " --outcome " + outcome : ""}${stage ? " --stage " + stage : ""}`);
    if (!data) { btn.textContent = "Save outcome"; btn.disabled = false; return; }
    btn.textContent = "saved ✓";
    toast(`${co}/${slug} → ${data.outcome || "—"} (${data.furthest_stage}) — sticks; the email scan won't override it. Reload to re-bucket.`);
  }
  function actRebuild(tr) {
    const cmd = `~/.hermes/profiles/lin/bin/lin-run build ${tr.dataset.co}/${tr.dataset.slug}`;
    (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject())
      .then(() => toast("rebuild command copied — runs the frontier build for this role:\n" + cmd))
      .catch(() => toast("run: " + cmd));
  }
  async function actCover(tr) {
    const co = tr.dataset.co, slug = tr.dataset.slug;
    if (!confirm(`Generate a cover letter for ${co}/${slug}?\nRuns the dual-draft cover flow on the frontier model (~1-3 min, real tokens).`)) return;
    const data = await post("/cover", { co, slug }, `~/.hermes/profiles/lin/bin/lin-run finalize "cover ${co}/${slug}"`);
    if (!data) return;
    const btn = $("button[data-act=cover]", tr.nextElementSibling);
    if (btn) { btn.textContent = "⏳ Generating cover…"; btn.disabled = true; }
    toast(`cover generating for ${co}/${slug} on ${data.model} — reload in ~2 min; the row shows ✓ Cover generated when done`);
  }
  function setPipelineButtons(running) {
    for (const z of $$("button[data-act=run-pipeline]")) {
      z.disabled = running;
      z.textContent = running ? "⏳ running" : "⚡ now";
    }
  }
  async function actRunPipeline() {
    if (!confirm("Run the pipeline NOW for all flagged/staged roles?\nstage (liveness) → build-forge (Forge-only fastpath), ~5-15 min in the background.")) return;
    setPipelineButtons(true); // one chain at a time — server enforces it too (15 min guard)
    const data = await post("/run-pipeline", {},
      "~/.hermes/profiles/lin/bin/lin-run stage && ~/.hermes/profiles/lin/bin/lin-run build-forge");
    if (!data && !serverUp) { setPipelineButtons(false); return; } // server down: nothing started, allow retry
    // success OR 429 (already running): keep buttons disabled until reload
    if (data) toast("pipeline running: stage → build-forge (~5-15 min) — reload when done; Ready will light up");
  }
  async function actRunStage(btn) {
    const stage = btn.dataset.runStage;
    const cronId = stage === "build" ? "lin-build-forge" : `lin-${stage}`;
    const data = await post("/run-stage", { stage }, `hermes -p lin cron run ${cronId}`);
    if (!data) return;
    btn.textContent = "⏳";
    btn.disabled = true;
    toast(`${cronId} triggered — fires within ~60s`);
    setTimeout(() => {
      btn.textContent = "▶ done?";
      btn.disabled = false;
      toast(`${cronId} likely finished — reload the page for fresh data`);
    }, 90000);
  }
  async function actAddJobs() {
    const box = $("#add-urls");
    const urls = (box.value || "").split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
    if (!urls.length) { toast("paste one or more http(s) job URLs first", true); return; }
    const data = await post("/add-jobs", { urls },
      `/lin add ${urls.join(" ")}`);
    if (!data) return;
    box.value = "";
    const a = data.added ?? 0, d = data.duplicates ?? 0;
    if (a > 0) toast(`added ${a}${d ? ` · ${d} already pending` : ""} — appears under Pending after reload`);
    else if (d > 0) toast(`already in the pipeline (${d} duplicate${d > 1 ? "s" : ""}) — nothing new added`, true);
    else toast("nothing added — check the URL(s)", true);
    bumpCount("pending", a);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    let tr = b.closest("tr.r");
    if (!tr) { const xp = b.closest("tr.xp"); if (xp) tr = xp.previousElementSibling; }
    if (b.dataset.act === "run-pipeline") { actRunPipeline(); return; }
    if (b.dataset.act === "cover" && tr) actCover(tr);
    if (b.dataset.act === "prepare" && tr) actPrepare([tr]);
    if (b.dataset.act === "wont" && tr) actWont([tr], false);
    if (b.dataset.act === "wont-rejected" && tr) actWont([tr], true);
    if (b.dataset.act === "apply" && tr) actApply(tr);
    if (b.dataset.act === "rebuild" && tr) actRebuild(tr);
    if (b.dataset.act === "set-outcome" && tr) actSetOutcome(b, tr);
    if (b.dataset.runStage) actRunStage(b);
  });
  $("#bulk-prepare").addEventListener("click", () => actPrepare(selected()));
  $("#bulk-wont").addEventListener("click", () => actWont(selected(), false));
  $("#add-btn").addEventListener("click", actAddJobs);
  $("#reload").addEventListener("click", () => location.reload());

  // red dot → explain how to get the server back
  $("#srv-dot")?.parentElement?.addEventListener("click", () => {
    if (serverUp) { toast("server is up at " + (BASE === "" ? location.origin : BASE) + " — actions are live. Tip: open the dashboard from that URL for always-fresh data."); return; }
    const cmd = "node ~/.hermes/profiles/lin/lin/scripts/lin-serve.mjs";
    (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject())
      .then(() => toast("server unreachable from this device.\nStart command copied — or the lin-serve-watchdog cron revives it daily at 9:00.\nFrom another device, open this page via the server URL (same origin), e.g. http://<machine-ip>:7777/", true))
      .catch(() => toast("server unreachable — run: " + cmd, true));
  });
  // ---------- boot ----------
  checkServer().then(refresh);
  setInterval(checkServer, 60000);
})();
