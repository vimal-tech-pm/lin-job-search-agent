#!/usr/bin/env node
/**
 * lin-discovery-append.mjs — the ONE deterministic funnel every discovery
 * channel (portal / linkedin / indeed / gmail) pipes its candidates through.
 *
 * Browser/LLM scanners (and the Gmail API helper) only emit candidate JSON.
 * This script owns ALL data integrity: title filtering, canonicalization,
 * cross-source dedup, pipeline.md append, scan-history.tsv write, and the
 * per-channel cap. Keeping it in one place means the dedup/append logic can
 * never drift between channels.
 *
 *   node scripts/lin-discovery-append.mjs --source linkedin --file /tmp/cands.json
 *   cat cands.json | node scripts/lin-discovery-append.mjs --source gmail
 *
 * Candidate JSON = array of:
 *   { company, role, url, source, source_query?, source_item_id?,
 *     seen_at?, confidence?, notes? }
 *
 * Pure Node — no external deps. Importable: the pure helpers below are exported
 * for unit tests; the CLI only runs when the file is executed directly.
 *
 * Added by Lin (multichannel scanners plan v3). Not part of FORGE/PATHFINDER.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Source vocabulary in data is lowercase. camelCase verbs (scanLinkedIn) are
// aliases only and must never be written into data files.
export const SOURCES = new Set(["portal", "linkedin", "indeed", "gmail", "manual"]);

// Per-channel cap keys in career-profile/pipeline-config.json `daily`.
const CAP_KEY = {
  portal: "scan_cap",
  linkedin: "scan_linkedin_cap",
  indeed: "scan_indeed_cap",
  gmail: "scan_gmail_cap",
  manual: "scan_manual_cap",
};
const DEFAULT_CAP = { portal: 200, linkedin: 50, indeed: 50, gmail: 50, manual: 50 };

// scan-history.tsv schema (M1): legacy 4 columns first, byte-compatible; the
// next five are appended and never reordered.
export const SCAN_HISTORY_HEADER =
  "date\tcompany\ttitle\turl\tsource\tcanonical_url\tcanonical_key\tstatus\tsource_item_id";
const LEGACY_HEADER = "date\tcompany\ttitle\turl";

// ---------- pure helpers (exported for tests) ----------

export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Strip parenthetical location lists, trailing separators, collapse whitespace.
export function normalizeTitle(title) {
  return String(title ?? "")
    .replace(/\([^)]*\)/g, " ")        // "(San Francisco, CA | NYC)" → " "
    .replace(/\s+/g, " ")
    .replace(/[-–—,|]+\s*$/g, "")
    .trim()
    .toLowerCase();
}

export function canonicalKey(company, role) {
  return `${slugify(company)}::${slugify(normalizeTitle(role))}`;
}

// Source-specific canonical URL. The board is detected from the URL itself so
// old rows (whose source we don't know) canonicalize identically to new ones.
// Indeed → jk= job key; LinkedIn → /jobs/view/<id>; Greenhouse/Lever/Ashby and
// everything else → host+path with query/hash dropped (their id lives in path).
export function canonicalizeUrl(rawUrl) {
  const s = String(rawUrl ?? "").trim();
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    // Not a parseable URL — fall back to a trimmed lowercase string.
    return s.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  if (host.includes("indeed.")) {
    const jk = u.searchParams.get("jk") || /\/viewjob\/([A-Za-z0-9]+)/.exec(u.pathname)?.[1];
    if (jk) return `indeed.com/viewjob?jk=${jk}`;
  }
  if (host.includes("linkedin.")) {
    const id =
      /\/jobs\/view\/(\d+)/.exec(u.pathname)?.[1] ||
      u.searchParams.get("currentJobId");
    if (id) return `linkedin.com/jobs/view/${id}`;
  }
  // Greenhouse: collapse boards.greenhouse.io / job-boards.greenhouse.io.
  let normHost = host.replace(/^job-boards\.greenhouse\.io$/, "boards.greenhouse.io");
  const cleanPath = u.pathname.replace(/\/+$/, "");
  return `${normHost}${cleanPath}`.toLowerCase();
}

/**
 * Minimal, purpose-built title_filter block parser (S1). NOT a general YAML
 * parser. Enters the `title_filter:` block, reads only the positive / negative
 * / seniority_boost sub-keys, collects `- "…"` / `- …` items, ignores comments
 * and blanks, and stops at the next top-level key.
 */
export function parseTitleFilter(portalsYmlText) {
  const out = { positive: [], negative: [], seniority_boost: [] };
  const lines = String(portalsYmlText ?? "").split("\n");
  let inBlock = false;
  let subKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const topLevel = /^[A-Za-z0-9_]+:/.test(line); // column-0 key
    if (topLevel) {
      if (/^title_filter:/.test(line)) {
        inBlock = true;
        subKey = null;
        continue;
      }
      if (inBlock) break; // next top-level key ends the block
      continue;
    }
    if (!inBlock) continue;

    // Sub-key line like "  positive:" (2-space indent, no list dash)
    const sub = /^\s{1,4}([a-z_]+):\s*$/.exec(line);
    if (sub) {
      subKey = ["positive", "negative", "seniority_boost"].includes(sub[1]) ? sub[1] : null;
      continue;
    }
    // List item "    - \"Foo\"" or "    - Foo"
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && subKey) {
      let v = item[1].trim();
      // strip an inline comment that isn't inside quotes
      if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, "").trim();
      v = v.replace(/^["']|["']$/g, "");
      if (v) out[subKey].push(v);
    }
  }
  return out;
}

// At least 1 positive matches AND 0 negatives match (case-insensitive),
// matching portals.yml's documented contract.
export function passesTitleFilter(title, filter) {
  const t = String(title ?? "").toLowerCase();
  const pos = (filter?.positive || []).map((x) => x.toLowerCase());
  const neg = (filter?.negative || []).map((x) => x.toLowerCase());
  if (neg.some((n) => n && t.includes(n))) return { pass: false, reason: "negative" };
  if (pos.length && !pos.some((p) => p && t.includes(p))) return { pass: false, reason: "no-positive" };
  return { pass: true, reason: "" };
}

// Extract the FIRST https?:// token from an arbitrary pipeline line. Robust
// against Role fields that carry embedded ` | ` location pipes (M2): we never
// naive-split processed rows.
export function firstUrlToken(line) {
  const m = /(https?:\/\/[^\s|]+)/.exec(String(line ?? ""));
  return m ? m[1].replace(/[)\].,;]+$/, "") : null;
}

// Parse a pending row: `- [ ] DATE | Company | Role | URL [| src=… [dup_of=…]]`.
// Role may legitimately contain pipes, and the URL may carry `?src=` query
// params — so we anchor on the https token, not on split(" | ").
export function parsePendingRow(line) {
  const m = /^- \[ \] (\d{4}-\d{2}-\d{2}) \| (.+)$/u.exec(line);
  if (!m) return null;
  const date = m[1];
  const rest = m[2];
  const url = firstUrlToken(rest);
  if (!url) return null;
  const firstPipe = rest.indexOf(" | ");
  const company = firstPipe >= 0 ? rest.slice(0, firstPipe).trim() : "";
  const afterCompany = firstPipe >= 0 ? rest.slice(firstPipe + 3) : rest;
  const urlIdx = afterCompany.indexOf(url);
  const role = afterCompany.slice(0, urlIdx).replace(/\s*\|\s*$/, "").trim();
  // trailing metadata after the URL: " | src=linkedin dup_of=https://…"
  const tail = afterCompany.slice(urlIdx + url.length);
  const source = /src=([^\s|]+)/.exec(tail)?.[1] || "portal";
  const duplicate_of = /dup_of=([^\s|]+)/.exec(tail)?.[1] || null;
  return {
    date, company, role, url, source, duplicate_of,
    canonical_url: canonicalizeUrl(url),
    canonical_key: canonicalKey(company, role),
  };
}

// Parse a processed row, current live format:
// `- [x] DATE | Company | Role(with pipes) | URL → X.X/5 PDF:❌ CANADA:n | NNN`
// (Also tolerates the never-realized legacy `- [x] #NNN | URL | Company | …`.)
export function parseProcessedRow(line) {
  if (!/^- \[x\] /u.test(line)) return null;
  const url = firstUrlToken(line);
  if (!url) return null;
  const dm = /^- \[x\] (\d{4}-\d{2}-\d{2})/u.exec(line);
  const date = dm ? dm[1] : null;
  // body after the checkbox (+ date if present)
  let body = line.replace(/^- \[x\]\s*/u, "");
  if (date) body = body.replace(new RegExp(`^${date}\\s*\\|\\s*`), "");
  const firstPipe = body.indexOf(" | ");
  const company = firstPipe >= 0 ? body.slice(0, firstPipe).trim() : "";
  const afterCompany = firstPipe >= 0 ? body.slice(firstPipe + 3) : body;
  const urlIdx = afterCompany.indexOf(url);
  const role = urlIdx >= 0 ? afterCompany.slice(0, urlIdx).replace(/\s*\|\s*$/, "").trim() : "";
  const id = /\|\s*(\d{3,})\s*$/.exec(line)?.[1] || null;
  return {
    date, company, role, url, id,
    canonical_url: canonicalizeUrl(url),
    canonical_key: canonicalKey(company, role),
  };
}

// Read every pipeline row (pending + processed) into a normalized list.
export function parsePipelineRows(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    const p = parsePendingRow(line);
    if (p) { rows.push({ ...p, kind: "pending" }); continue; }
    const x = parseProcessedRow(line);
    if (x) rows.push({ ...x, kind: "processed" });
  }
  return rows;
}

// Read scan-history.tsv — both legacy 4-col and new 9-col rows. Short rows are
// read as source=portal / canonical_url=canonicalize(url) / status=added, no
// migration required.
export function parseScanHistory(text) {
  const lines = String(text ?? "").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    if (c[0] === "date") continue; // header (legacy or 9-col)
    if (c.length < 4) continue;
    const url = c[3] || "";
    rows.push({
      date: c[0], company: c[1], title: c[2], url,
      source: c[4] || "portal",
      canonical_url: c[5] || canonicalizeUrl(url),
      canonical_key: c[6] || canonicalKey(c[1], c[2]),
      status: c[7] || "added",
      source_item_id: c[8] || "",
    });
  }
  return rows;
}

const TSV = (v) => String(v ?? "").replace(/[\t\n\r]/g, " ");
const PIPE = (v) => String(v ?? "")
  .replace(/[\t\n\r]/g, " ")
  .replace(/\s*\|\s*/g, " / ")
  .replace(/\s+/g, " ")
  .trim();

// ---------- core append (testable via temp vault) ----------

export function buildDedupSets(pipelineRows, historyRows) {
  const urlSet = new Set();
  const keyToFirst = new Map();
  const add = (canonUrl, key, originalUrl, source = "portal") => {
    if (canonUrl) urlSet.add(canonUrl);
    if (key && !keyToFirst.has(key)) keyToFirst.set(key, { url: originalUrl || canonUrl, source });
  };
  for (const r of pipelineRows) add(r.canonical_url, r.canonical_key, r.url, r.source || "portal");
  for (const r of historyRows) {
    // Title-filtered / exact-dup history rows must not block re-admission; only
    // rows that produced a pipeline entry participate in dedup.
    if (r.status === "skipped_title" || r.status === "skipped_dup") continue;
    add(r.canonical_url, r.canonical_key, r.url, r.source || "portal");
  }
  return { urlSet, keyToFirst };
}

/**
 * Classify + (where applicable) append candidates. Returns a result object with
 * the new pipeline lines, the new scan-history lines, and per-status counts.
 * Pure with respect to the inputs — the CLI does the file I/O around it.
 */
export function processCandidates({ candidates, source, filter, pipelineRows, historyRows, cap, today }) {
  const { urlSet, keyToFirst } = buildDedupSets(pipelineRows, historyRows);
  const pipelineLines = [];
  const historyLines = [];
  const stats = { added: 0, skipped_dup: 0, skipped_dup_crosssource: 0, skipped_title: 0, dropped_cap: 0 };

  for (const cand of candidates) {
    const company = PIPE(cand.company);
    const role = PIPE(cand.role);
    const url = String(cand.url ?? "").replace(/[\t\n\r]/g, "").trim();
    if (!url || !company || !role) continue; // malformed candidate, ignore
    if (!/^https?:\/\//i.test(url)) continue; // reject non-web URLs before pipeline write
    const date = (cand.seen_at && /^\d{4}-\d{2}-\d{2}/.test(cand.seen_at))
      ? cand.seen_at.slice(0, 10) : today;
    const canonUrl = canonicalizeUrl(url);
    const key = canonicalKey(company, role);
    const itemId = cand.source_item_id != null ? String(cand.source_item_id) : "";

    const histRow = (status, dupOf) => {
      historyLines.push([
        date, TSV(company), TSV(role), TSV(url), source,
        canonUrl, key, status, TSV(itemId),
      ].join("\t"));
      // Keep dedup sets live within this run too, but only for candidates that
      // actually produced a pending pipeline row. Title-filtered rows and exact
      // duplicates are audit history only; they must not suppress a later valid
      // row with the same URL/key.
      if (status !== "skipped_title" && status !== "skipped_dup") {
        urlSet.add(canonUrl);
        if (!keyToFirst.has(key)) keyToFirst.set(key, { url: dupOf || url, source });
      }
    };

    // 1) title filter
    const tf = passesTitleFilter(role, filter);
    if (!tf.pass) { stats.skipped_title++; histRow("skipped_title"); continue; }

    // 2) exact canonical-URL dup → genuinely redundant, do not append
    if (urlSet.has(canonUrl)) { stats.skipped_dup++; histRow("skipped_dup"); continue; }

    // 3) canonical-key dup at a different URL → cross-source duplicate. Keep
    //    BOTH rows; append the new one with a dup_of sibling pointer.
    const siblingInfo = keyToFirst.get(key) || null;
    if (siblingInfo && siblingInfo.source === source) {
      stats.skipped_dup++;
      histRow("skipped_dup");
      continue;
    }
    const sibling = siblingInfo?.url || null;
    const isCross = !!sibling;

    // 4) cap enforcement — both clean-new and cross-source appends count.
    if (cap > 0 && (stats.added + stats.skipped_dup_crosssource) >= cap) {
      stats.dropped_cap++;
      continue; // not written to history so it can be re-seen next run
    }

    let row = `- [ ] ${date} | ${company} | ${role} | ${url} | src=${source}`;
    if (isCross) row += ` dup_of=${sibling}`;
    pipelineLines.push(row);

    if (isCross) { stats.skipped_dup_crosssource++; histRow("skipped_dup_crosssource", sibling); }
    else { stats.added++; histRow("added"); }
  }

  return { pipelineLines, historyLines, stats };
}

// ---------- CLI ----------

function readConfigCap(vault, source) {
  const p = path.join(vault, "career-profile", "pipeline-config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  const key = CAP_KEY[source];
  const v = cfg?.daily?.[key];
  return Number.isFinite(v) ? v : DEFAULT_CAP[source];
}

function argVal(argv, k) {
  const i = argv.indexOf(k);
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const pref = argv.find((a) => a.startsWith(`${k}=`));
  return pref ? pref.split("=").slice(1).join("=") : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withAppendLock(vault, fn) {
  const lockDir = path.join(vault, "data", ".lin-discovery-append.lock");
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const staleMs = 10 * 60 * 1000;
  const deadline = Date.now() + 30 * 1000;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "owner"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\n");
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let stale = false;
      try {
        const st = fs.statSync(lockDir);
        stale = Date.now() - st.mtimeMs > staleMs;
      } catch {}
      if (stale) {
        try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for append lock ${lockDir}`);
      }
      sleepMs(200);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
  }
}

function main() {
  const argv = process.argv.slice(2);
  const source = (argVal(argv, "--source") || "").toLowerCase();
  if (!SOURCES.has(source)) {
    console.error(`--source must be one of: ${[...SOURCES].join(", ")} (got '${source}')`);
    process.exit(1);
  }
  const vault = argVal(argv, "--vault")
    ? path.resolve(argVal(argv, "--vault"))
    : path.resolve(__dirname, "..");

  // candidates: --file <path> or stdin
  const file = argVal(argv, "--file");
  let raw;
  if (file) {
    raw = fs.readFileSync(file, "utf8");
  } else if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, "utf8");
  } else {
    console.error("provide candidate JSON via --file <path> or stdin");
    process.exit(1);
  }
  let candidates;
  try {
    const parsed = JSON.parse(raw);
    candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed.candidates) ? parsed.candidates : null;
  } catch (err) {
    console.error(`candidate JSON parse error: ${err.message}`);
    process.exit(1);
  }
  if (!candidates) {
    console.error("candidate JSON must be an array (or { candidates: [...] })");
    process.exit(1);
  }

  const PIPELINE = path.join(vault, "data", "pipeline.md");
  const HISTORY = path.join(vault, "engines", "pathfinder", "data", "scan-history.tsv");
  const PORTALS = path.join(vault, "engines", "pathfinder", "portals.yml");

  const filter = fs.existsSync(PORTALS)
    ? parseTitleFilter(fs.readFileSync(PORTALS, "utf8"))
    : { positive: [], negative: [], seniority_boost: [] };

  const cap = readConfigCap(vault, source);
  if (cap <= 0) {
    console.log(`${source}: scan skipped (cap ${cap})`);
    process.exit(0);
  }

  const { stats } = withAppendLock(vault, () => {
    const pipelineText = fs.existsSync(PIPELINE) ? fs.readFileSync(PIPELINE, "utf8") : "# Lin Pipeline\n";
    const historyText = fs.existsSync(HISTORY) ? fs.readFileSync(HISTORY, "utf8") : "";
    const pipelineRows = parsePipelineRows(pipelineText);
    const historyRows = parseScanHistory(historyText);

    const result = processCandidates({
      candidates, source, filter, pipelineRows, historyRows, cap, today: todayIso(),
    });
    const { pipelineLines, historyLines } = result;

    // ---- append pipeline.md ----
    if (pipelineLines.length) {
      let out = pipelineText;
      if (!out.endsWith("\n")) out += "\n";
      out += pipelineLines.join("\n") + "\n";
      fs.mkdirSync(path.dirname(PIPELINE), { recursive: true });
      fs.writeFileSync(PIPELINE, out);
    }

    // ---- append scan-history.tsv (upgrade header to 9-col, keep data verbatim) ----
    if (historyLines.length) {
      fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
      let out;
      if (!historyText) {
        out = SCAN_HISTORY_HEADER + "\n";
      } else {
        const lines = historyText.replace(/\n$/, "").split("\n");
        if (lines[0] === LEGACY_HEADER) lines[0] = SCAN_HISTORY_HEADER; // first 4 cols byte-identical
        out = lines.join("\n") + "\n";
      }
      out += historyLines.join("\n") + "\n";
      fs.writeFileSync(HISTORY, out);
    }
    return result;
  });

  // ---- digest ----
  const cross = stats.skipped_dup_crosssource;
  const dupes = stats.skipped_dup + cross;
  let digest = `${source}: +${stats.added} new, ${dupes} dupes (${cross} cross-source), ${stats.skipped_title} filtered`;
  if (stats.dropped_cap) digest += `, ${stats.dropped_cap} dropped (cap ${cap})`;
  console.log(digest);
  process.exit(0);
}

if (path.resolve(process.argv[1] || "") === __filename) {
  main();
}
