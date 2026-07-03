import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { migrateJob, applyPatch } from '../scripts/lin-migrate-outcomes.mjs';

test('migrateJob backfills a rejected applied row with depth + email provenance', () => {
  const patch = migrateJob({ status: 'closed', status_detail: 'rejected: no thanks', last_email_status: 'rejection: ...' });
  assert.equal(patch.outcome, 'rejected');
  assert.equal(patch.outcome_source, 'email');
  assert.equal(patch.furthest_stage, 'applied');
  assert.equal(patch.furthest_stage_source, 'email');
});

test('migrateJob lifts depth to final from an interview email mentioning the final round', () => {
  const patch = migrateJob({ status: 'closed', status_detail: 'rejected: x', last_email_status: 'interview: onsite final round' });
  assert.equal(patch.furthest_stage, 'final');
});

test('migrateJob maps an offer row', () => {
  const patch = migrateJob({ status: 'offer', status_detail: '' });
  assert.equal(patch.outcome, 'offer');
  assert.equal(patch.furthest_stage, 'offer');
});

test('migrateJob is conservative: a pre-apply won’t-apply row is left untouched', () => {
  assert.equal(migrateJob({ status: 'closed', status_detail: "won't_apply: nah" }), null);
});

test('migrateJob is idempotent: an already-migrated row yields no patch', () => {
  assert.equal(migrateJob({ status: 'closed', outcome: 'rejected', furthest_stage: 'final' }), null);
  assert.equal(migrateJob({ status: 'applied', furthest_stage: 'applied' }), null);
});

test('migrateJob skips rows that never applied (nothing to backfill)', () => {
  assert.equal(migrateJob({ status: 'staged', status_detail: '' }), null);
});

test('applyPatch appends keys in place without disturbing existing yaml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-mig-'));
  const p = path.join(dir, 'job.yml');
  fs.writeFileSync(p, 'job_slug: pm\ncompany_slug: acme\nstatus: closed\nstatus_detail: "rejected: x"\n');
  applyPatch(p, { outcome: 'rejected', outcome_source: 'email', furthest_stage: 'applied', furthest_stage_source: 'email' });
  const job = yaml.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(job.job_slug, 'pm');           // original fields intact
  assert.equal(job.outcome, 'rejected');
  assert.equal(job.furthest_stage, 'applied');
  fs.rmSync(dir, { recursive: true, force: true });
});
