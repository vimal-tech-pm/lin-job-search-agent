#!/usr/bin/env node
// Deterministic worklist for the build/finalize stages.
// Usage: node scripts/lin-worklist.mjs --status staged|built [--vault <path>] [--json]
// "built" rows additionally require resumes/gate-pass.json (gate evidence, not status string alone).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const VAULT = flag("--vault") || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS = flag("--status");
if (!["staged", "built"].includes(STATUS || "")) {
  console.error("usage: lin-worklist.mjs --status staged|built [--vault p] [--json]");
  process.exit(2);
}

const out = [];
const companies = path.join(VAULT, "companies");
for (const co of fs.existsSync(companies) ? fs.readdirSync(companies) : []) {
  const jobs = path.join(companies, co, "jobs");
  if (!fs.existsSync(jobs)) continue;
  for (const slug of fs.readdirSync(jobs)) {
    const yml = path.join(jobs, slug, "job.yml");
    if (!fs.existsSync(yml)) continue;
    const text = fs.readFileSync(yml, "utf8");
    const status = /^status:\s*['"]?([^'"\n#]+)/m.exec(text)?.[1]?.trim();
    const winner = /^ats_winner:\s*['"]?([^'"\n#]+)/m.exec(text)?.[1]?.trim();
    if (status !== STATUS || (winner && winner !== "null" && winner !== "~")) continue;
    if (STATUS === "built" && !fs.existsSync(path.join(jobs, slug, "resumes", "gate-pass.json"))) continue;
    out.push({ company_slug: co, job_slug: slug, folder: path.relative(VAULT, path.join(jobs, slug)) });
  }
}
console.log(argv.includes("--json") ? JSON.stringify(out) : out.map((r) => `${r.company_slug}/${r.job_slug}`).join("\n"));
