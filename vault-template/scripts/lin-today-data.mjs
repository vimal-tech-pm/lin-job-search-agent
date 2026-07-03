#!/usr/bin/env node
// lin-today-data.mjs — build-time adapter for the Lin Today dashboard page.
// Reads vault state through lib/tracker-data.mjs (the only vault reader) and
// emits a dashboard-ui `sectioned` view-model. Read-only over the vault; the
// only writes are lin-today{,.prev}.json in the dashboard-data dir (tmp+rename,
// never a partial file). Exit non-zero on any failure so the cron alerts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, walkJobs, readEvaluationQueue, readPipelineRows, buildRows } from './lib/tracker-data.mjs';
import { deriveToday } from './lib/today-data.mjs';

const VAULT = process.env.LIN_VAULT || path.join(os.homedir(), '.hermes/profiles/lin/lin');
const OUT_DIR = process.env.LIN_TODAY_OUT_DIR || path.join(os.homedir(), '.hermes/dashboard-data');

function writeAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

init(VAULT);
const jobs = walkJobs();
const queue = readEvaluationQueue(jobs);
const rows = buildRows({ jobs, queue, pipelineRows: readPipelineRows() });

let prev = null;
try { prev = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'lin-today.prev.json'), 'utf8')); } catch {}

const { viewModel, snapshot } = deriveToday({ rows, prev, now: new Date() });
writeAtomic(path.join(OUT_DIR, 'lin-today.json'), viewModel);
writeAtomic(path.join(OUT_DIR, 'lin-today.prev.json'), snapshot);
console.log(`lin-today: ${rows.length} rows -> ${path.join(OUT_DIR, 'lin-today.json')}`);
