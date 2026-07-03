#!/usr/bin/env node
/**
 * mark-pipeline.mjs — Mark lines 846-888 in pipeline.md as processed
 * with their score/PDF/verdict info.
 */
import fs from "node:fs";
import path from "node:path";

const VAULT = path.resolve(process.argv[2] || ".");
const PIPELINE = path.join(VAULT, "data", "pipeline.md");

let content = fs.readFileSync(PIPELINE, "utf8");
const lines = content.split("\n");

// Mapping: line_number → { score, verdict_prefix }
const marks = {
  846: { score: "2.1", note: "SKIP" },
  847: { score: "3.4", note: "Long-Shot Stretch" },
  848: { score: "4.0", note: "Investable Stretch" },
  849: { score: "4.0", note: "Investable Stretch" },
  850: { score: "3.8", note: "Investable Stretch" },
  851: { score: "3.5", note: "Investable Stretch" },
  852: { score: "3.6", note: "Investable Stretch" },
  853: { score: "3.6", note: "Investable Stretch" },
  854: { score: "3.5", note: "Investable Stretch" },
  855: { score: "3.4", note: "Long-Shot Stretch" },
  856: { score: "3.2", note: "Long-Shot Stretch" },
  857: { score: "2.9", note: "SKIP" },
  858: { score: "3.9", note: "Investable Stretch" },
  859: { score: "3.2", note: "Long-Shot Stretch" },
  860: { score: "3.7", note: "Investable Stretch" },
  861: { score: "3.5", note: "Investable Stretch" },
  862: { score: "3.0", note: "Long-Shot Stretch" },
  863: { score: "2.7", note: "SKIP" },
  864: { score: "2.7", note: "SKIP" },
  865: { score: "2.7", note: "SKIP" },
  866: { score: "3.2", note: "Long-Shot Stretch" },
  867: { score: "3.4", note: "Long-Shot Stretch" },
  868: { score: "3.3", note: "SKIP" },
  869: { score: "3.6", note: "Investable Stretch" },
  870: { score: "3.0", note: "Long-Shot Stretch" },
  871: { score: "1.8", note: "SKIP" },
  872: { score: "2.2", note: "SKIP" },
  873: { score: "2.7", note: "SKIP" },
  874: { score: "2.6", note: "SKIP" },
  875: { score: "3.5", note: "Investable Stretch" },
  876: { score: "2.6", note: "SKIP" },
  877: { score: "2.7", note: "SKIP" },
  878: { score: "2.3", note: "SKIP" },
  879: { score: "4.0", note: "Investable" },
  880: { score: "2.9", note: "SKIP" },
  881: { score: "3.4", note: "Long-Shot Stretch" },
  882: { score: "3.7", note: "Investable Stretch" },
  883: { score: "3.7", note: "Investable Stretch" },
  884: { score: "3.5", note: "Investable Stretch" },
  885: { score: "2.3", note: "SKIP" },
  886: { score: "3.0", note: "Long-Shot Stretch" },
  887: { score: "2.5", note: "SKIP" },
  888: { score: "3.5", note: "Investable Stretch" },
};

let changed = 0;
for (let i = 0; i < lines.length; i++) {
  const match = lines[i].match(/^(\- \[ \])/);
  if (!match) continue;

  // Parse line number - look at the start of line content
  // The pipeline format: - [ ] DATE | Company | Role | URL | ...
  for (const [ln, info] of Object.entries(marks)) {
    const lineNum = parseInt(ln);
    // Find the correct line by looking at whether this line includes the company/role
    // Since we know line numbers, let's just use index + 1 approach
  }
}

// Since grep -n shows us line numbers, let's use the actual line index
// The file is 0-indexed, so line 846 is lines[845]
for (const [ln, info] of Object.entries(marks)) {
  const idx = parseInt(ln) - 1; // 0-indexed
  if (idx >= lines.length) {
    console.error(`Line ${ln} out of range`);
    continue;
  }
  const line = lines[idx];
  if (!line.startsWith("- [ ]")) {
    console.log(`Line ${ln} already processed or not a pending row: ${line.substring(0,60)}`);
    continue;
  }
  // Replace - [ ] with - [x] and append score/PDF info
  const newLine = line.replace("- [ ]", "- [x]") + ` | ${info.score}/5 | PDF ❌ | ${info.note}`;
  lines[idx] = newLine;
  changed++;
}

fs.writeFileSync(PIPELINE, lines.join("\n"), "utf8");
console.log(`Marked ${changed} pipeline rows as processed.`);
