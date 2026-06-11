import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PACKAGE_SCRIPT = path.resolve('scripts/lin-package.mjs');
const TRACKER_SCRIPT = path.resolve('scripts/lin-tracker.mjs');

function makeVault(jobYml) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-pkg-'));
  fs.mkdirSync(path.join(v, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.copyFileSync(PACKAGE_SCRIPT, path.join(v, 'scripts', 'lin-package.mjs'));
  fs.copyFileSync(TRACKER_SCRIPT, path.join(v, 'scripts', 'lin-tracker.mjs'));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Alex Morgan\n');
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), '{"promote_threshold":3.95,"daily":{}}\n');
  fs.writeFileSync(path.join(v, 'data', 'evaluation-queue.json'), JSON.stringify({ schema_version: 1, bootstrap: {}, roles: [] }));
  fs.writeFileSync(path.join(v, 'data', 'pipeline.md'), '');
  const d = path.join(v, 'companies', 'acme', 'jobs', 'pm-role');
  fs.mkdirSync(path.join(d, 'resumes'), { recursive: true });
  fs.writeFileSync(path.join(d, 'job.yml'), jobYml);
  fs.writeFileSync(path.join(d, 'job.md'), '# Acme — PM Role\n');
  fs.writeFileSync(path.join(d, 'status-history.md'), '');
  fs.writeFileSync(path.join(d, 'resumes', 'forge.pdf'), 'pdf');
  fs.writeFileSync(path.join(d, 'resumes', 'forge.docx'), 'docx');
  return v;
}

function run(v) {
  return spawnSync(process.execPath, ['scripts/lin-package.mjs', 'pm-role'], { cwd: v, encoding: 'utf8' });
}

function status(v) {
  const t = fs.readFileSync(path.join(v, 'companies', 'acme', 'jobs', 'pm-role', 'job.yml'), 'utf8');
  return /^status:\s*(\S+)/m.exec(t)[1];
}

test('built + winner bumps to materials_ready', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\ntitle: PM\nstatus: built\nats_winner: forge\n');
  const res = run(v);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.equal(status(v), 'materials_ready');
});

test('built without winner is refused, status unchanged', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\ntitle: PM\nstatus: built\nats_winner: null\n');
  const res = run(v);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /ats_winner is null/);
  assert.equal(status(v), 'built');
});

test('legacy new + winner still bumps (back-compat until migration)', () => {
  const v = makeVault('job_slug: pm-role\ncompany_slug: acme\ntitle: PM\nstatus: new\nats_winner: forge\n');
  const res = run(v);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.equal(status(v), 'materials_ready');
});
