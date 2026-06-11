#!/usr/bin/env node

/**
 * check-agent-docs.mjs — Ensure CLAUDE.md and AGENTS.md stay in sync.
 *
 * Run:
 *   node check-agent-docs.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const sourcePath = join(root, 'CLAUDE.md');
const targetPath = join(root, 'AGENTS.md');

if (!existsSync(sourcePath)) {
  console.error('❌ Missing CLAUDE.md');
  process.exit(1);
}

if (!existsSync(targetPath)) {
  console.error('❌ Missing AGENTS.md');
  process.exit(1);
}

const source = readFileSync(sourcePath, 'utf-8');
const target = readFileSync(targetPath, 'utf-8');

if (source === target) {
  console.log('✅ CLAUDE.md and AGENTS.md are in sync');
  process.exit(0);
}

const sourceLines = source.split('\n');
const targetLines = target.split('\n');
const maxLines = Math.max(sourceLines.length, targetLines.length);

let firstMismatch = null;
for (let i = 0; i < maxLines; i++) {
  if ((sourceLines[i] ?? '') !== (targetLines[i] ?? '')) {
    firstMismatch = i + 1;
    break;
  }
}

console.error('❌ CLAUDE.md and AGENTS.md have drifted');
if (firstMismatch !== null) {
  console.error(`   First mismatch at line ${firstMismatch}`);
}
console.error('   Update AGENTS.md to match CLAUDE.md exactly.');
process.exit(1);
