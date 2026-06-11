import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/lin-migrate-status.mjs');

function mkVault(folders) { // {co, slug, yml, resumes?: ['forge.pdf','pathfinder.pdf'], pkg?, gate?}
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-mig-'));
  for (const f of folders) {
    const d = path.join(v, 'companies', f.co, 'jobs', f.slug);
    fs.mkdirSync(path.join(d, 'resumes'), { recursive: true });
    fs.writeFileSync(path.join(d, 'job.yml'), f.yml);
    fs.writeFileSync(path.join(d, 'status-history.md'), '');
    for (const r of f.resumes || []) fs.writeFileSync(path.join(d, 'resumes', r), 'pdf');
    if (f.pkg) fs.writeFileSync(path.join(d, 'PACKAGE.md'), '# pkg');
    if (f.gate) fs.writeFileSync(path.join(d, 'resumes', 'gate-pass.json'), JSON.stringify({ result: 'pass' }));
  }
  return v;
}

const status = (v, co, slug) =>
  /^status:\s*(\S+)/m.exec(fs.readFileSync(path.join(v, 'companies', co, 'jobs', slug, 'job.yml'), 'utf8'))[1];

function run(v, ...args) {
  return spawnSync(process.execPath, [SCRIPT, '--vault', v, '--verifier', 'echo-pass', ...args], { encoding: 'utf8' });
}

test('dry-run proposes staged for bare new folders and leaves applied untouched', () => {
  const v = mkVault([
    { co: 'a', slug: 'bare', yml: 'status: new\nats_winner: null\n' },
    { co: 'b', slug: 'done', yml: 'status: applied\nats_winner: forge\napplied_at: 2026-06-01\n' },
  ]);
  const res = run(v);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /a\tbare\tnew\t.*\tstaged\t/);
  assert.match(res.stdout, /b\tdone\tapplied\t.*\tunchanged\tterminal/);
  assert.equal(status(v, 'a', 'bare'), 'new'); // dry-run does not write
});

test('apply migrates: bare→staged, both-PDFs→built with gate marker, applied unchanged', () => {
  const v = mkVault([
    { co: 'a', slug: 'bare', yml: 'status: new\nats_winner: null\n' },
    { co: 'c', slug: 'pdfs', yml: 'status: decoding\nats_winner: null\n', resumes: ['forge.pdf', 'pathfinder.pdf'] },
    { co: 'b', slug: 'done', yml: 'status: applied\nats_winner: forge\napplied_at: 2026-06-01\n' },
  ]);
  const res = run(v, '--apply');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(status(v, 'a', 'bare'), 'staged');
  assert.equal(status(v, 'c', 'pdfs'), 'built');
  assert.ok(fs.existsSync(path.join(v, 'companies', 'c', 'jobs', 'pdfs', 'resumes', 'gate-pass.json')));
  assert.equal(status(v, 'b', 'done'), 'applied');
});

test('winner + package migrates to materials_ready', () => {
  const v = mkVault([
    { co: 'd', slug: 'ready', yml: 'status: new\nats_winner: forge\n', resumes: ['forge.pdf', 'pathfinder.pdf'], pkg: true },
  ]);
  const res = run(v, '--apply');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(status(v, 'd', 'ready'), 'materials_ready');
});

test('--check flags built without gate marker and applied without applied_at', () => {
  const v = mkVault([
    { co: 'e', slug: 'lying', yml: 'status: built\nats_winner: null\n', resumes: ['forge.pdf', 'pathfinder.pdf'] }, // no gate marker
    { co: 'f', slug: 'noat', yml: 'status: applied\nats_winner: forge\n' }, // no applied_at
  ]);
  const res = run(v, '--check');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /built without PDFs\+gate/);
  assert.match(res.stderr, /applied without applied_at/);
});
