#!/usr/bin/env node
/**
 * lin-jds-backfill.mjs — one-shot: fetch missing JD snapshots for every
 * queue role with `needs_jd_refetch: true` (i.e. the rows migrated from
 * pipeline.md/reports/ before LIN01 was updated to write jds/ inline).
 *
 * Writes each JD to `jds/{id}-{co_slug}-{discovered_at}.md` and updates the
 * queue row to `jd_snapshot: <path>, needs_jd_refetch: false`. Failed fetches
 * leave the row unchanged and continue (silent for MVP).
 *
 * Usage:
 *   node scripts/lin-jds-backfill.mjs                    # backfill all
 *   node scripts/lin-jds-backfill.mjs --id=NNN           # just one
 *   node scripts/lin-jds-backfill.mjs --dry-run          # report-only
 *
 * Pure Node — uses native fetch. Mirrors fetchJd/htmlToText from
 * lin-promote-evaluations.mjs so the same extraction rules apply.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");
const QUEUE_PATH = path.join(VAULT, "data", "evaluation-queue.json");
const JDS_DIR = path.join(VAULT, "jds");

const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");
const argVal = (k) => {
  const a = argv.find((x) => x.startsWith(`${k}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
const ONLY_ID = argVal("--id");

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(h\d|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchJd(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "lin-jds-backfill/1.0" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      try {
        const data = JSON.parse(m[1].trim());
        const list = Array.isArray(data) ? data : [data];
        for (const d of list) {
          if (d["@type"] === "JobPosting" && d.description) {
            const text = htmlToText(String(d.description));
            if (text.length > 200) return { ok: true, text, source: "json-ld" };
          }
        }
      } catch {}
    }
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
    const text = htmlToText(body);
    if (text.length > 200) return { ok: true, text, source: "body-strip" };
    return { ok: false, error: "extracted text too short" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function renderJdMd(role, text, source) {
  return [
    `# ${role.company} — ${role.role}`,
    "",
    `**Source URL:** ${role.url}`,
    `**Captured:** ${new Date().toISOString().slice(0, 10)} (lin-jds-backfill, source=${source})`,
    `**Queue id:** #${role.id}`,
    "",
    "---",
    "",
    text,
    "",
  ].join("\n");
}

async function main() {
  if (!fs.existsSync(QUEUE_PATH)) {
    console.error(`Missing ${QUEUE_PATH}; run lin-evaluation-queue.mjs migrate first.`);
    process.exit(1);
  }
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  const all = queue.roles || [];
  let pool = all.filter((r) => r.needs_jd_refetch && !r.jd_snapshot);
  if (ONLY_ID) pool = pool.filter((r) => r.id === ONLY_ID);

  console.log(`lin-jds-backfill — ${isDryRun ? "DRY-RUN" : "LIVE"} — ${pool.length} role(s) to backfill`);
  if (!pool.length) return;

  if (!isDryRun) fs.mkdirSync(JDS_DIR, { recursive: true });

  let ok = 0, failed = 0, mutated = false;
  for (const role of pool) {
    const date = role.discovered_at || new Date().toISOString().slice(0, 10);
    const fname = `${role.id}-${role.co_slug}-${date}.md`;
    const rel = path.posix.join("jds", fname);
    const abs = path.join(JDS_DIR, fname);
    console.log(`[fetch]  #${role.id} ${role.company} — ${role.url}`);
    const r = await fetchJd(role.url);
    if (!r.ok) {
      console.log(`         ⚠ ${r.error} — skipping`);
      failed += 1;
      continue;
    }
    console.log(`         → ${r.text.length} chars (${r.source}) → ${rel}`);
    if (!isDryRun) {
      fs.writeFileSync(abs, renderJdMd(role, r.text, r.source));
      role.jd_snapshot = rel;
      role.needs_jd_refetch = false;
      mutated = true;
    }
    ok += 1;
  }

  if (!isDryRun && mutated) {
    queue.generated_at = new Date().toISOString();
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
  }
  console.log(`\nBackfill: ${ok} ok, ${failed} failed${isDryRun ? " (dry-run — no writes)" : ""}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
