import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/lin-worklist.mjs');

function mkVault(states) { // states: array of {co, slug, status, winner?, gate?}
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-wl-'));
  for (const s of states) {
    const d = path.join(v, 'companies', s.co, 'jobs', s.slug);
    fs.mkdirSync(path.join(d, 'resumes'), { recursive: true });
    fs.writeFileSync(path.join(d, 'job.yml'), `job_slug: ${s.slug}\ncompany_slug: ${s.co}\nstatus: ${s.status}\nats_winner: ${s.winner || 'null'}\n`);
    if (s.gate) fs.writeFileSync(path.join(d, 'resumes', 'gate-pass.json'), JSON.stringify({ result: 'pass' }));
  }
  return v;
}

test('worklist filters by status and gate marker', () => {
  const v = mkVault([
    { co: 'a', slug: 'x', status: 'staged' },
    { co: 'b', slug: 'y', status: 'built', gate: true },
    { co: 'c', slug: 'z', status: 'built' }, // built but NO gate marker → excluded from built worklist
    { co: 'd', slug: 'w', status: 'materials_ready', winner: 'forge' },
  ]);
  const staged = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--vault', v, '--status', 'staged', '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(staged.length, 1);
  assert.equal(staged[0].job_slug, 'x');
  const built = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--vault', v, '--status', 'built', '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(built.length, 1);
  assert.equal(built[0].job_slug, 'y');
});

test('worklist excludes rows with a winner already set and demands a valid --status', () => {
  const v = mkVault([{ co: 'a', slug: 'x', status: 'built', winner: 'forge', gate: true }]);
  const built = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--vault', v, '--status', 'built', '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(built.length, 0);
  const bad = spawnSync(process.execPath, [SCRIPT, '--vault', v, '--status', 'applied'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});
