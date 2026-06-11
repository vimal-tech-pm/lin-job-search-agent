#!/usr/bin/env node
/**
 * lin-render.mjs — Lin-added helper for PATHFINDER resume tailoring.
 *
 * Renders a tailored resume PDF by:
 *   1. Loading a substitution JSON (the LLM's tailored fields)
 *   2. Applying those substitutions to engines/pathfinder/templates/cv-template.html
 *   3. Writing the filled HTML to a temp file
 *   4. Invoking engines/pathfinder/generate-pdf.mjs to render the PDF
 *
 * Usage:
 *   node engines/pathfinder/lin-render.mjs <subs.json> <output.pdf> [--format=letter|a4]
 *
 * The JSON must contain keys matching `{{TOKEN}}` placeholders in the template:
 *   LANG, NAME, PAGE_WIDTH, CONTACT_ITEMS, SUMMARY_TEXT, COMPETENCIES,
 *   EXPERIENCE, EDUCATION, CERTIFICATIONS, SKILLS, PROJECTS,
 *   SECTION_SUMMARY, SECTION_EXPERIENCE, SECTION_COMPETENCIES,
 *   SECTION_SKILLS, SECTION_PROJECTS, SECTION_EDUCATION, SECTION_CERTIFICATIONS.
 *
 * Any token in the template not present in the JSON is replaced with an empty string.
 *
 * Added by Lin on 2026-05-26. Not part of stock PATHFINDER.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: lin-render.mjs <subs.json> <output.pdf> [--format=letter|a4]");
  process.exit(1);
}

const [subsPath, outputPdfPath, ...flags] = args;
const format = flags.find((f) => f.startsWith("--format="))?.split("=")[1] ?? "letter";

const templatePath = path.join(__dirname, "templates", "cv-template.html");
const generatorPath = path.join(__dirname, "generate-pdf.mjs");

if (!fs.existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}
if (!fs.existsSync(subsPath)) {
  console.error(`Substitutions JSON not found: ${subsPath}`);
  process.exit(1);
}

const template = fs.readFileSync(templatePath, "utf8");
const subs = JSON.parse(fs.readFileSync(subsPath, "utf8"));

// Replace every {{KEY}} with its value; missing keys → empty string.
const placeholderRegex = /\{\{([A-Z_]+)\}\}/g;
const rendered = template.replace(placeholderRegex, (_, key) => subs[key] ?? "");

// Warn if template tokens are unfilled.
const unfilled = [...rendered.matchAll(placeholderRegex)].map((m) => m[1]);
if (unfilled.length > 0) {
  console.warn(`Warning: template tokens left unfilled: ${[...new Set(unfilled)].join(", ")}`);
}

const tmpHtml = `/tmp/lin-pathfinder-${path.basename(outputPdfPath, ".pdf")}.html`;
fs.writeFileSync(tmpHtml, rendered);
console.log(`Wrote tailored HTML: ${tmpHtml}`);

// Invoke PATHFINDER's stock generate-pdf.mjs.
const result = spawnSync("node", [generatorPath, tmpHtml, outputPdfPath, `--format=${format}`], {
  stdio: "inherit",
});
if (result.status !== 0) {
  console.error("generate-pdf.mjs failed");
  process.exit(result.status ?? 1);
}
