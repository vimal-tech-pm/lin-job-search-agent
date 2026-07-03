#!/usr/bin/env node
/**
 * lin-migrate-outcomes.mjs — one-time backfill of the outcome funnel fields
 * (`outcome` / `furthest_stage` + `*_source`) onto existing job.yml rows from
 * their legacy `status` / `status_detail` / `last_email_status`.
 *
 * SAFE BY DEFAULT: dry-run unless `--write`. `--write` backs every changed file
 * up under `backups/outcome-migration-<ts>/` first. Idempotent — re-running skips
 * rows that already carry the fields. Conservative — never fabricates a `withdrew`
 * from a pre-apply "won't apply".
 *
 * Usage:
 *   node scripts/lin-migrate-outcomes.mjs            # dry-run table
 *   node scripts/lin-migrate-outcomes.mjs --write    # back up + apply
 *   node scripts/lin-migrate-outcomes.mjs --vault <path>
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { parseLegacy } from './lib/outcome.mjs';

// Pure: the patch of new keys for one job, or null if nothing to add.
export function migrateJob(job) {
  if (job?.outcome !== undefined || job?.furthest_stage !== undefined) return null; // already migrated / manual
  const parsed = parseLegacy({
    status: job?.status,
    status_detail: job?.status_detail,
    last_email_status: job?.last_email_status,
  });
  const patch = {};
  if (parsed.outcome) {
    patch.outcome = parsed.outcome;
    patch.outcome_source = parsed.outcome_source || 'email';
  }
  if (parsed.furthest_stage && parsed.furthest_stage !== 'none') {
    patch.furthest_stage = parsed.furthest_stage;
    patch.furthest_stage_source = parsed.furthest_stage_source || 'email';
  }
  return Object.keys(patch).length ? patch : null;
}

// Append the patch keys in place — lowest-churn write that leaves the rest of the
// file byte-identical. Idempotency upstream guarantees no duplicate keys.
export function applyPatch(ymlPath, patch) {
  let raw = fs.readFileSync(ymlPath, 'utf8');
  if (!raw.endsWith('\n')) raw += '\n';
  const add = Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(ymlPath, `${raw}${add}\n`, 'utf8');
}

function walkJobYmls(vault) {
  const out = [];
  const companies = path.join(vault, 'companies');
  if (!fs.existsSync(companies)) return out;
  for (const co of fs.readdirSync(companies)) {
    const jobsDir = path.join(companies, co, 'jobs');
    if (!fs.existsSync(jobsDir)) continue;
    for (const slug of fs.readdirSync(jobsDir)) {
      const p = path.join(jobsDir, slug, 'job.yml');
      if (fs.existsSync(p)) out.push({ ref: `${co}/${slug}`, ymlPath: p });
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const vIdx = argv.indexOf('--vault');
  const vault = vIdx !== -1 && argv[vIdx + 1]
    ? path.resolve(argv[vIdx + 1])
    : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(vault, 'backups', `outcome-migration-${ts}`);

  const changes = [];
  for (const { ref, ymlPath } of walkJobYmls(vault)) {
    let job;
    try { job = yaml.parse(fs.readFileSync(ymlPath, 'utf8')); } catch { continue; }
    const patch = migrateJob(job || {});
    if (patch) changes.push({ ref, ymlPath, patch, status: job?.status, detail: job?.status_detail });
  }

  console.log(`${write ? 'MIGRATE' : 'DRY-RUN'} — ${changes.length} job(s) to backfill (of the scanned set)\n`);
  console.log('| Job | status | → outcome | → stage |');
  console.log('|-----|--------|-----------|---------|');
  for (const c of changes) {
    console.log(`| ${c.ref} | ${c.status || '—'} | ${c.patch.outcome || '—'} | ${c.patch.furthest_stage || '—'} |`);
  }

  if (!write) {
    console.log(`\nNothing written. Re-run with --write to back up + apply.`);
    return;
  }
  if (changes.length === 0) { console.log('\nNothing to write.'); return; }

  fs.mkdirSync(backupDir, { recursive: true });
  for (const c of changes) {
    const dest = path.join(backupDir, c.ref.replace(/\//g, '__') + '.job.yml');
    fs.copyFileSync(c.ymlPath, dest);
    applyPatch(c.ymlPath, c.patch);
  }
  console.log(`\nBacked up ${changes.length} file(s) → ${backupDir}`);
  console.log(`Applied ${changes.length} backfill(s). Run: node scripts/lin-tracker.mjs`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
