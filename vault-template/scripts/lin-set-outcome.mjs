#!/usr/bin/env node
/**
 * lin-set-outcome.mjs — record a manual outcome / furthest-stage override.
 *
 * The dashboard's outcome editor posts here. Manual values are STICKY: they set
 * `*_source: manual`, which the Gmail-status scanner refuses to overwrite (see
 * lib/outcome.mjs). Targets a job folder by `co/slug`.
 *
 * Usage:
 *   node scripts/lin-set-outcome.mjs --ref <co/slug> [--outcome <x>] [--stage <y>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'yaml';
import { applyManual, normalizeState, deriveStatus, OUTCOMES, STAGES } from './lib/outcome.mjs';

const VAULT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Apply a manual override to one job.yml. Returns the merged state.
export function setOutcome(ymlPath, { outcome, stage } = {}) {
  const job = yaml.parse(fs.readFileSync(ymlPath, 'utf8')) || {};
  const before = normalizeState({
    outcome: job.outcome,
    furthest_stage: job.furthest_stage,
    outcome_source: job.outcome_source,
    furthest_stage_source: job.furthest_stage_source,
  });
  const state = applyManual(before, { outcome, stage });

  if (state.outcome !== null) {
    job.outcome = state.outcome;
    job.outcome_source = state.outcome_source;
  }
  job.furthest_stage = state.furthest_stage;
  job.furthest_stage_source = state.furthest_stage_source;

  // Keep the legacy forward status coherent, but only when an outcome was set —
  // a depth-only correction on a live row must not change its status.
  if (outcome) {
    const ns = deriveStatus(state);
    if (ns) job.status = ns;
    job.status_detail = `${state.outcome}: set manually (${new Date().toISOString().slice(0, 10)})`;
  }
  fs.writeFileSync(ymlPath, yaml.stringify(job), 'utf8');

  const historyPath = path.join(path.dirname(ymlPath), 'status-history.md');
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    fs.appendFileSync(historyPath, `${ts}  outcome(manual)   ${state.outcome || '—'} / ${state.furthest_stage}\n`, 'utf8');
  } catch {}
  return state;
}

function argVal(argv, k) {
  const i = argv.indexOf(k);
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const pref = argv.find((a) => a.startsWith(`${k}=`));
  return pref ? pref.split('=').slice(1).join('=') : null;
}

function main() {
  const argv = process.argv.slice(2);
  const ref = argVal(argv, '--ref') || '';
  const outcome = argVal(argv, '--outcome');
  const stage = argVal(argv, '--stage');
  const jsonOut = argv.includes('--json');

  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(ref)) {
    console.error('--ref <co/slug> required'); process.exit(1);
  }
  if (outcome && !OUTCOMES.includes(outcome)) {
    console.error(`--outcome must be one of: ${OUTCOMES.join(', ')}`); process.exit(1);
  }
  if (stage && !STAGES.includes(stage)) {
    console.error(`--stage must be one of: ${STAGES.join(', ')}`); process.exit(1);
  }
  if (!outcome && !stage) { console.error('nothing to set: pass --outcome and/or --stage'); process.exit(1); }

  const [co, slug] = ref.split('/');
  const ymlPath = path.join(VAULT, 'companies', co, 'jobs', slug, 'job.yml');
  if (!fs.existsSync(ymlPath)) { console.error(`no job.yml at ${ref}`); process.exit(1); }

  const state = setOutcome(ymlPath, { outcome: outcome || undefined, stage: stage || undefined });
  const tracker = path.join(VAULT, 'scripts', 'lin-tracker.mjs');
  if (fs.existsSync(tracker)) {
    try { spawnSync('node', [tracker], { cwd: VAULT }); } catch {}
  }
  if (jsonOut) console.log(JSON.stringify({ ok: true, ref, ...state }));
  else console.log(`set ${ref}: outcome=${state.outcome ?? '—'} furthest_stage=${state.furthest_stage} (manual)`);
  process.exit(0);
}

if (path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
