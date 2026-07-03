import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const APPLY_SCRIPT = path.resolve('scripts/lin-apply.mjs');
const TRACKER_SCRIPT = path.resolve('scripts/lin-tracker.mjs');

function makeVault(jobYml) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-apply-'));
  fs.mkdirSync(path.join(v, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.copyFileSync(APPLY_SCRIPT, path.join(v, 'scripts', 'lin-apply.mjs'));
  fs.copyFileSync(TRACKER_SCRIPT, path.join(v, 'scripts', 'lin-tracker.mjs'));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Jane Doe\n');
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), '{"promote_threshold":3.95,"daily":{}}\n');
  fs.writeFileSync(path.join(v, 'data', 'evaluation-queue.json'), JSON.stringify({ schema_version: 1, bootstrap: {}, roles: [] }));
  fs.writeFileSync(path.join(v, 'data', 'pipeline.md'), '');
  const d = path.join(v, 'companies', 'acme', 'jobs', 'pm-role');
  fs.mkdirSync(path.join(d, 'resumes'), { recursive: true });
  fs.writeFileSync(path.join(d, 'job.yml'), jobYml);
  fs.writeFileSync(path.join(d, 'status-history.md'), '');
  return v;
}

function run(v) {
  return spawnSync(process.execPath, ['scripts/lin-apply.mjs', 'acme/pm-role', '--yes', '--json'], { cwd: v, encoding: 'utf8' });
}

test('staged role is refused', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\nstatus: staged\nats_winner: null\n');
  const res = run(v);
  assert.notEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /not materials_ready/);
});

test('built role without winner is refused (no forge default)', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\nstatus: built\nats_winner: null\n');
  const res = run(v);
  assert.notEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /not materials_ready/);
});

test('materials_ready without winner is refused', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\nstatus: materials_ready\nats_winner: null\n');
  const res = run(v);
  assert.notEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /no ats_winner/);
});

test('materials_ready with pathfinder winner applies with that winner', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\nstatus: materials_ready\nats_winner: pathfinder\n');
  const res = run(v);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const yml = fs.readFileSync(path.join(v, 'companies', 'acme', 'jobs', 'pm-role', 'job.yml'), 'utf8');
  assert.match(yml, /^status:\s*applied/m);
  assert.match(yml, /resume:\s*pathfinder/);
});
