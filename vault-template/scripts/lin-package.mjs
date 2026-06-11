#!/usr/bin/env node
/**
 * lin-package.mjs — Deterministic packaging step.
 *
 * For a given job slug:
 *   1. Reads job.yml; resolves ats_winner + cover_winner.
 *   2. Surfaces winners at the job folder root with **recruiter-friendly filenames**:
 *        First_Last_Resume_{Company}_{YYYYMMDD}.pdf  (always — symlink to winner)
 *        First_Last_Resume_{Company}_{YYYYMMDD}.docx (only if FORGE won)
 *        First_Last_Cover_{Company}_{YYYYMMDD}.md    (only if `lin cover` was run)
 *      Date freezes to applied_at if the job has been applied, otherwise today.
 *      Any prior root-level final/First_Last_* files are cleaned up first
 *      (idempotent — re-run safely after manual edits).
 *   3. Writes PACKAGE.md — the submit checklist with paths, JD URL, screening-question
 *      answers (parsed from job.md), and a pre-submit checklist.
 *   4. Sets job.yml.status → materials_ready if currently 'decoding' or 'new'.
 *   5. Calls scripts/lin-tracker.mjs to refresh data/applications.{md,html}.
 *
 * Usage:
 *   node scripts/lin-package.mjs <job-slug>
 *   node scripts/lin-package.mjs <co-slug>/<job-slug>     # disambiguate
 *
 * Idempotent. Safe to re-run after manual ats_winner edits.
 * Added by Lin on 2026-05-26.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, "..");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: lin-package.mjs <job-slug> | <co-slug>/<job-slug>");
  process.exit(1);
}

// ---------- recruiter-friendly filename helpers ----------
function loadProfileFullName() {
  const profilePath = path.join(VAULT, "career-profile", "profile.yml");
  const fallback = "Candidate";
  if (!fs.existsSync(profilePath)) return fallback;
  const text = fs.readFileSync(profilePath, "utf8");
  // Look for `  full_name: "Foo Bar"` under a `candidate:` block; tolerant of quoting.
  const m = text.match(/^\s*full_name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  return m ? m[1].trim() : fallback;
}

function nameStem(fullName) {
  return fullName
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .join("_");
}

function companyDisplay(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function packageDate(yml) {
  const src = yml.applied_at && /^\d{4}-\d{2}-\d{2}/.test(yml.applied_at)
    ? yml.applied_at
    : new Date().toISOString();
  return src.slice(0, 10).replace(/-/g, "");
}

function recruiterFilenames(fullName, coSlug, yml) {
  const stem = nameStem(fullName);
  const co = companyDisplay(coSlug);
  const date = packageDate(yml);
  return {
    resumePdf:  `${stem}_Resume_${co}_${date}.pdf`,
    resumeDocx: `${stem}_Resume_${co}_${date}.docx`,
    // Covers are PDF-only now. No coverMd here: keeping it would add the stale
    // `_Cover_*.md` name to the cleanup keep-set and prevent old markdown cover
    // symlinks from being swept.
    coverPdf:   `${stem}_Cover_${co}_${date}.pdf`,
  };
}

// Remove any root-level symlinks/files that look like a previously-staged final
// artifact (old `final-resume.*` / `final-cover.*` from older Lin versions, or a
// stale `First_Last_*` from a previous package run with a different date/winner).
function cleanupStaleFinals(jobPath, currentNames) {
  const keep = new Set(Object.values(currentNames));
  for (const entry of fs.readdirSync(jobPath)) {
    const isLegacyFinal = /^final-(resume|cover)\./.test(entry);
    const isOldRecruiter = /_Resume_|_Cover_/.test(entry) && /\.(pdf|docx|md)$/i.test(entry);
    if ((isLegacyFinal || isOldRecruiter) && !keep.has(entry)) {
      const p = path.join(jobPath, entry);
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      // Only remove symlinks at this level; never delete a regular file we don't recognize.
      if (st.isSymbolicLink()) fs.unlinkSync(p);
    }
  }
}

// ---------- find the job folder ----------
function findJob(query) {
  const companiesDir = path.join(VAULT, "companies");
  if (query.includes("/")) {
    const [co, slug] = query.split("/");
    const p = path.join(companiesDir, co, "jobs", slug);
    if (fs.existsSync(path.join(p, "job.yml"))) return { co, slug, path: p };
    return null;
  }
  const matches = [];
  for (const co of fs.readdirSync(companiesDir)) {
    const p = path.join(companiesDir, co, "jobs", query);
    if (fs.existsSync(path.join(p, "job.yml"))) matches.push({ co, slug: query, path: p });
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.error(`Ambiguous slug '${query}'; found in: ${matches.map((m) => m.co).join(", ")}`);
    console.error(`Disambiguate with: lin-package.mjs <co-slug>/${query}`);
    process.exit(1);
  }
  return matches[0];
}

const job = findJob(arg);
if (!job) {
  console.error(`No job folder for '${arg}' under ${path.join(VAULT, "companies")}`);
  process.exit(1);
}

// ---------- minimal job.yml loader (same shape as lin-tracker.mjs) ----------
function loadJobYml(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const out = { artifacts: {}, applied_with: {} };
  let currentBlock = null;
  for (const rawLine of lines) {
    const line = rawLine;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^[a-z_]+:\s*$/.test(line)) {
      const key = line.split(":")[0].trim();
      if (key === "artifacts" || key === "applied_with") { currentBlock = key; continue; }
      currentBlock = null;
    }
    if (currentBlock && /^\s{2,}[a-z_]+:/.test(line)) {
      const [k, ...rest] = line.trim().split(":");
      out[currentBlock][k] = parseScalar(rest.join(":").trim());
      continue;
    }
    if (/^[a-z_]+:\s*.+$/.test(line)) {
      const [k, ...rest] = line.split(":");
      out[k.trim()] = parseScalar(rest.join(":").trim());
      currentBlock = null;
    }
  }
  return out;
}
function parseScalar(v) {
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v.replace(/^["']|["']$/g, "");
}

const ymlPath = path.join(job.path, "job.yml");
const yml = loadJobYml(ymlPath);

// ---------- compute symlink targets ----------
const winner = yml.ats_winner;
const coverWinnerPath = yml.artifacts?.cover_winner;
const coverWinnerEngine =
  coverWinnerPath && coverWinnerPath.includes("forge")     ? "forge" :
  coverWinnerPath && coverWinnerPath.includes("pathfinder") ? "pathfinder" : null;

if (!winner) {
  console.error(`job.yml.ats_winner is null — run /lin compare ${job.slug} first.`);
  process.exit(1);
}

// ---------- recreate root-level symlinks with recruiter-friendly names ----------
function relink(name, target) {
  const linkPath = path.join(job.path, name);
  if (fs.lstatSync(linkPath, { throwIfNoEntry: false })) fs.unlinkSync(linkPath);
  fs.symlinkSync(target, linkPath);
}

const fullName = loadProfileFullName();
const names = recruiterFilenames(fullName, job.co, yml);

const sourceResumePdf = `resumes/${winner}.pdf`;
const sourceResumeDocx = winner === "forge" ? "resumes/forge.docx" : null;
const sourceCoverPdf = coverWinnerEngine ? `covers/${coverWinnerEngine}.pdf` : null;

// Clean up any stale root-level finals (old final-* names, or First_Last_* from a
// previous package date / winner) before laying down fresh symlinks.
cleanupStaleFinals(job.path, names);

if (fs.existsSync(path.join(job.path, sourceResumePdf))) {
  relink(names.resumePdf, sourceResumePdf);
}
if (sourceResumeDocx && fs.existsSync(path.join(job.path, sourceResumeDocx))) {
  relink(names.resumeDocx, sourceResumeDocx);
}
if (sourceCoverPdf && fs.existsSync(path.join(job.path, sourceCoverPdf))) {
  relink(names.coverPdf, sourceCoverPdf);
}

// ---------- parse screening-question answers from job.md (Decode section) ----------
function parseScreeningAnswers(jobMdPath) {
  if (!fs.existsSync(jobMdPath)) return null;
  const md = fs.readFileSync(jobMdPath, "utf8");
  const m = md.match(/##\s*Application Questions[\s\S]*?(?=\n##\s|\n---|\n$)/i);
  return m ? m[0].trim() : null;
}

const screeningSection = parseScreeningAnswers(path.join(job.path, "job.md"));

// ---------- write PACKAGE.md ----------
const score = yml.pathfinder_score;
const verdict = yml.pathfinder_verdict;
const coverPresent = !!coverWinnerEngine;
const applyUrl = yml.external_apply_url || yml.application_url || yml.source_url;
const BUMPABLE_STATUSES = ["new", "decoding", "staged", "built"];
const displayStatus = BUMPABLE_STATUSES.includes(yml.status) ? "materials_ready" : (yml.status || "materials_ready");

const pkg = `# Application Package — ${yml.company_slug} / ${yml.title || yml.job_slug}

**Status:** ${displayStatus} · **Packaged:** ${new Date().toISOString().slice(0, 10)} · **Apply to:** ${applyUrl || "—"}
${applyUrl && yml.source_url && applyUrl !== yml.source_url ? `**Original JD:** ${yml.source_url}\n` : ""}
${score ? `**PATHFINDER score:** ${score}/5${verdict ? ` · ${verdict}` : ""} · see [pathfinder-eval.md](pathfinder-eval.md)\n\n` : ""}---

## Attach

| Slot | File (upload as-is — already named for the recruiter) | Why |
|---|---|---|
| **Resume** | [\`${names.resumePdf}\`](${names.resumePdf}) | ATS winner = **${winner}**. See [resumes/ats-compare.md](resumes/ats-compare.md). |
${winner === "forge" ? `| Resume (editable) | [\`${names.resumeDocx}\`](${names.resumeDocx}) | Editable backup if the form needs DOCX. |\n` : ""}${coverPresent ? `| **Cover letter** | [\`${names.coverPdf}\`](${names.coverPdf}) | Cover winner = **${coverWinnerEngine}**. One-page PDF, ready to submit. |\n` : `| _No cover letter generated._ | _Run \`lin cover ${job.slug}\` if the form asks for one._ | |\n`}

**Backup files (do NOT submit unless prompted):** \`resumes/${winner === "forge" ? "pathfinder" : "forge"}.pdf\`${winner === "forge" ? "" : ", `resumes/forge.docx`"}${coverPresent ? `, \`covers/${coverWinnerEngine === "forge" ? "pathfinder" : "forge"}.md\`` : ""}.

---

${screeningSection ? `## Screening question answers\n\n${screeningSection}\n\n---\n\n` : ""}## Pre-submit checklist

- [ ] Open \`${names.resumePdf}\` and sanity-check it renders cleanly.
- [ ] If the form needs DOCX, use \`${names.resumeDocx}\` (only present if FORGE won).
${coverPresent ? `- [ ] Open \`${names.coverPdf}\` and sanity-check it renders cleanly as a one-page letter.\n` : `- [ ] Cover letter NOT included by default. If the form requires one, run \`lin cover ${job.slug}\` and re-run packaging.\n`}- [ ] Submit on **${applyUrl || "the company's careers portal"}**.
- [ ] Run \`lin apply ${job.slug}\` immediately after submission to record the application.

---

*Regenerated by \`scripts/lin-package.mjs\`. Idempotent — re-run any time to refresh symlinks and this checklist.*
`;

fs.writeFileSync(path.join(job.path, "PACKAGE.md"), pkg);

// ---------- bump status if appropriate ----------
let bumped = false;
if (BUMPABLE_STATUSES.includes(yml.status)) {
  const ymlText = fs.readFileSync(ymlPath, "utf8");
  fs.writeFileSync(
    ymlPath,
    ymlText.replace(/^status:.*$/m, "status: materials_ready")
  );
  // Append status-history row
  const hist = path.join(job.path, "status-history.md");
  if (fs.existsSync(hist)) {
    fs.appendFileSync(
      hist,
      `${new Date().toISOString().replace(/\.\d+Z$/, "Z")}\tmaterials_ready\tlin-package.mjs: final-resume.pdf → ${winner}, PACKAGE.md regenerated${coverPresent ? `, final-cover.pdf → ${coverWinnerEngine}` : ", no cover"}\n`
    );
  }
  bumped = true;
}

// ---------- refresh tracker ----------
spawnSync("node", [path.join(__dirname, "lin-tracker.mjs")], { stdio: "inherit" });

// ---------- report ----------
console.log(`✓ package    ${job.co}/${job.slug}`);
console.log(`             ${names.resumePdf} → ${sourceResumePdf}`);
if (winner === "forge") console.log(`             ${names.resumeDocx} → ${sourceResumeDocx}`);
if (coverPresent) console.log(`             ${names.coverPdf} → ${sourceCoverPdf}`);
else console.log(`             (no cover letter — run \`lin cover ${job.slug}\` if needed)`);
console.log(`             PACKAGE.md regenerated`);
if (bumped) console.log(`             status → materials_ready`);
console.log(`             tracker refreshed`);
