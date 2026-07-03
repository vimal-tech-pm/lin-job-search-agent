import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { setOutcome } from '../scripts/lin-set-outcome.mjs';

function tmpJob(yml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-so-'));
  const p = path.join(dir, 'job.yml');
  fs.writeFileSync(p, yml);
  return p;
}

test('setOutcome writes a manual outcome + depth and marks both sources manual', () => {
  const p = tmpJob('job_slug: pm\nstatus: applied\ntitle: Senior PM\nfurthest_stage: applied\nfurthest_stage_source: email\n');
  setOutcome(p, { outcome: 'rejected', stage: 'final' });
  const job = yaml.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(job.outcome, 'rejected');
  assert.equal(job.outcome_source, 'manual');
  assert.equal(job.furthest_stage, 'final');
  assert.equal(job.furthest_stage_source, 'manual');
  assert.equal(job.status, 'closed'); // legacy forward status kept in sync
});

test('setOutcome can correct depth on a live row without inventing an outcome', () => {
  const p = tmpJob('job_slug: pm\nstatus: interviewing\ntitle: Senior PM\nfurthest_stage: offer\nfurthest_stage_source: email\n');
  setOutcome(p, { stage: 'interviewing' }); // user fixes an over-eager email inference
  const job = yaml.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(job.furthest_stage, 'interviewing');
  assert.equal(job.furthest_stage_source, 'manual');
  assert.equal(job.outcome ?? null, null); // no outcome fabricated
  assert.equal(job.status, 'interviewing'); // live status untouched
});

test('a manual outcome set here survives a later email fold (provenance is persisted)', async () => {
  const { foldMatchesIntoJob } = await import('../scripts/lin-gmail-status.mjs');
  const p = tmpJob('job_slug: pm\nstatus: applied\ntitle: Senior PM\n');
  setOutcome(p, { outcome: 'declined', stage: 'offer' });
  const job = yaml.parse(fs.readFileSync(p, 'utf8'));
  const state = foldMatchesIntoJob(job, [{ classification: 'rejection', subject: 'x', snippet: 'unfortunately', date: '2026-06-13' }]);
  assert.equal(state.outcome, 'declined');       // email cannot overwrite the manual decline
  assert.equal(state.outcome_source, 'manual');
});
