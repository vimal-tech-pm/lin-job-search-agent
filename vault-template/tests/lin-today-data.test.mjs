import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process';

test('lin-today-data CLI writes valid json + snapshot, atomic', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lintoday-'));
  const vault = path.join(tmp, 'vault'); const out = path.join(tmp, 'out');
  // minimal vault: one applied job + empty queue/pipeline
  const jobDir = path.join(vault, 'companies/acme/jobs/pm');
  fs.mkdirSync(jobDir, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(vault, 'data'), { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.yml'),
    'title: PM\nstatus: applied\napplied_at: "2026-06-20"\n');
  fs.writeFileSync(path.join(vault, 'data/evaluation-queue.json'), '{"roles":[]}');
  execFileSync('node', ['scripts/lin-today-data.mjs'],
    { cwd: '~/.hermes/profiles/lin/lin',
      env: { ...process.env, LIN_VAULT: vault, LIN_TODAY_OUT_DIR: out } });
  const vm = JSON.parse(fs.readFileSync(path.join(out, 'lin-today.json'), 'utf8'));
  assert.equal(vm.page, 'lin-today');
  assert.equal(vm.kpis.length, 4);
  assert.ok(fs.existsSync(path.join(out, 'lin-today.prev.json')));
  assert.equal(fs.readdirSync(out).filter((f) => f.endsWith('.tmp')).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
