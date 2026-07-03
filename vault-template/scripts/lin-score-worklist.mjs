#!/usr/bin/env node
/**
 * lin-score-worklist.mjs — compact deterministic pending-row worklist for
 * lin-score. Keeps cron agents from reading the full historical pipeline.md.
 *
 * Usage:
 *   node scripts/lin-score-worklist.mjs [--vault <path>] [--limit N] [--json]
 *
 * Output contains only pending rows, capped by career-profile/pipeline-config.json
 * → daily.score_cap unless --limit is supplied. Historical processed rows never
 * leave this process.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePendingRow } from "./lin-discovery-append.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function argVal(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

function positiveInt(v, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readScoreCap(vault) {
  const cfgPath = path.join(vault, "career-profile", "pipeline-config.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return positiveInt(cfg?.daily?.score_cap, 20);
  } catch {
    return 20;
  }
}

function metadataValue(line, key) {
  const re = new RegExp(`(?:^|\\s)${key}=([^\\s|]+)`);
  return re.exec(line)?.[1] || null;
}

export function buildScoreWorklist({ vault, limit = null } = {}) {
  const root = vault || path.resolve(__dirname, "..");
  const cap = positiveInt(limit, readScoreCap(root));
  const pipelinePath = path.join(root, "data", "pipeline.md");
  const lines = fs.readFileSync(pipelinePath, "utf8").split("\n");
  const pending = [];

  lines.forEach((line, idx) => {
    if (!line.startsWith("- [ ]")) return;
    const row = parsePendingRow(line);
    if (!row) return;
    pending.push({
      line_number: idx + 1,
      date: row.date,
      company: row.company,
      role: row.role,
      url: row.url,
      source: row.source,
      duplicate_of: row.duplicate_of,
      canonical_key: metadataValue(line, "canonical_key") || row.canonical_key,
      posted_date: row.posted_date,
    });
  });

  return {
    cap,
    pending_total: pending.length,
    items: pending.slice(0, cap),
  };
}

function printHuman(out) {
  console.log(`Pending score worklist: ${out.items.length}/${out.pending_total} (cap ${out.cap})`);
  for (const r of out.items) {
    const meta = [
      `src=${r.source}`,
      r.duplicate_of ? `dup_of=${r.duplicate_of}` : null,
      r.posted_date ? `posted=${r.posted_date}` : null,
    ].filter(Boolean).join(" ");
    console.log(`line ${r.line_number} | ${r.date} | ${r.company} | ${r.role} | ${r.url} | ${meta}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log("usage: lin-score-worklist.mjs [--vault path] [--limit N] [--json]");
    return;
  }
  const vault = argVal(argv, "--vault") || path.resolve(__dirname, "..");
  const limit = argVal(argv, "--limit");
  const out = buildScoreWorklist({ vault, limit });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    printHuman(out);
  }
}

if (path.resolve(process.argv[1] || "") === __filename) {
  main();
}
