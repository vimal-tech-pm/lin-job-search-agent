import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SCRIPTS = ['lin-serve.mjs', 'lin-apply.mjs', 'lin-wont-apply.mjs', 'lin-evaluation-queue.mjs', 'lin-tracker.mjs'];

function makeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-serve-'));
  fs.mkdirSync(path.join(v, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(v, 'scripts', 'templates'), { recursive: true });
  for (const s of SCRIPTS) fs.copyFileSync(path.resolve('scripts', s), path.join(v, 'scripts', s));
  for (const f of fs.readdirSync(path.resolve('scripts/lib'))) fs.copyFileSync(path.resolve('scripts/lib', f), path.join(v, 'scripts/lib', f));
  for (const f of fs.readdirSync(path.resolve('scripts/templates'))) fs.copyFileSync(path.resolve('scripts/templates', f), path.join(v, 'scripts/templates', f));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Jane Doe\n');
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), JSON.stringify({ promote_threshold: 3.95, auto_build_floor: 4.2, auto_build_top_n: 3, daily: { score_cap: 100 }, greenfield: {} }));
  fs.writeFileSync(path.join(v, 'career-profile', 'scan-channels.json'), JSON.stringify({ linkedin: { enabled: false }, indeed: { enabled: false }, gmail: { enabled: false } }));
  fs.writeFileSync(path.join(v, 'career-profile', 'resume.md'), '# Resume\noriginal content\n');
  fs.writeFileSync(path.join(v, 'data', 'pipeline.md'), '');
  fs.writeFileSync(path.join(v, 'data', 'evaluation-queue.json'), JSON.stringify({
    schema_version: 1, generated_at: '2026-06-10T00:00:00Z', bootstrap: {},
    roles: [{
      id: '700', company: 'Acme', co_slug: 'acme', role: 'PM', job_slug: 'pm-queue-only',
      url: 'https://example.com/jobs/700', score: 4.0, verdict: 'Strong apply',
      recommendation: 'review', queue_state: 'evaluated',
      geo_gate: { reason: null, blocks_stage: false }, canada_eligible: 'yes',
      promotion: { promoted_at: null, job_folder: null, error: null },
      liveness: { checked_at: null, result: null, reason: null }, notes: [],
    }],
  }, null, 2));
  const ready = path.join(v, 'companies', 'acme', 'jobs', 'pm-ready');
  fs.mkdirSync(path.join(ready, 'resumes'), { recursive: true });
  fs.writeFileSync(path.join(ready, 'job.yml'), 'job_slug: pm-ready\ncompany_slug: acme\ntitle: PM\nstatus: materials_ready\nats_winner: forge\n');
  fs.writeFileSync(path.join(ready, 'status-history.md'), '');
  const staged = path.join(v, 'companies', 'acme', 'jobs', 'pm-staged');
  fs.mkdirSync(path.join(staged, 'resumes'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'job.yml'), 'job_slug: pm-staged\ncompany_slug: acme\ntitle: PM2\nstatus: staged\nats_winner: null\n');
  fs.writeFileSync(path.join(staged, 'status-history.md'), '');
  return v;
}

async function startServer(v, port) {
  const child = spawn(process.execPath, [path.join(v, 'scripts', 'lin-serve.mjs')], {
    env: { ...process.env, LIN_SERVE_PORT: String(port), LIN_HERMES_BIN: '/bin/echo', LIN_PIPELINE_BIN: '/bin/echo' },
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error('server did not start');
}

const post = (port, p, body) =>
  fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('lin-serve endpoints', async (t) => {
  const v = makeVault();
  const port = 17000 + Math.floor(Math.random() * 2000);
  const child = await startServer(v, port);
  t.after(() => child.kill());

  await t.test('request-build flags an eligible row', async () => {
    const r = await post(port, '/request-build', { ids: ['700'] });
    const data = await r.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    const queue = JSON.parse(fs.readFileSync(path.join(v, 'data', 'evaluation-queue.json'), 'utf8'));
    assert.equal(queue.roles[0].build_requested, true);
  });

  await t.test('apply succeeds on materials_ready and refuses staged', async () => {
    const ok = await (await post(port, '/apply', { co: 'acme', slug: 'pm-ready' })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const yml = fs.readFileSync(path.join(v, 'companies', 'acme', 'jobs', 'pm-ready', 'job.yml'), 'utf8');
    assert.match(yml, /^status:\s*applied/m);
    const bad = await post(port, '/apply', { co: 'acme', slug: 'pm-staged' });
    assert.equal(bad.status, 409);
  });

  await t.test('wont-apply closes a staged folder via bulk items', async () => {
    const r = await post(port, '/wont-apply', { items: [{ ref: 'acme/pm-staged', reason: 'test decline' }] });
    const data = await r.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    const yml = fs.readFileSync(path.join(v, 'companies', 'acme', 'jobs', 'pm-staged', 'job.yml'), 'utf8');
    assert.match(yml, /^status:\s*closed/m);
  });

  await t.test('run-stage validates, triggers via hermes shim, and rate-limits', async () => {
    const bad = await post(port, '/run-stage', { stage: 'scan' });
    assert.equal(bad.status, 400);
    const ok = await (await post(port, '/run-stage', { stage: 'build' })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const again = await post(port, '/run-stage', { stage: 'build' });
    assert.equal(again.status, 429);
  });

  await t.test('add-jobs validates urls', async () => {
    const bad = await post(port, '/add-jobs', { urls: ['not-a-url'] });
    assert.equal(bad.status, 400);
  });

  await t.test('serves the dashboard HTML at /', async () => {
    // generate it first inside the temp vault
    const { spawnSync } = await import('node:child_process');
    const gen = spawnSync(process.execPath, [path.join(v, 'scripts', 'lin-tracker.mjs')], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    const r = await fetch(`http://127.0.0.1:${port}/`);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, /nav class="rail"/);
    assert.match(html, /data-act="apply"|✓ applied|stage-applied/);
  });

  await t.test('settings page renders live config', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/settings`);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, /auto_build_floor/);
    assert.match(html, /follow-ups cron/);
    assert.match(html, /resume\.md/);
  });

  await t.test('settings-config validates, backs up, writes', async () => {
    const bad = await post(port, '/settings-config', { values: { 'auto_build_floor': 9 } });
    assert.equal(bad.status, 400); // out of range
    const ok = await (await post(port, '/settings-config', { values: { 'auto_build_floor': 4.0, 'daily.score_cap': 50 } })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.ok(ok.backup.includes('backups/settings/'));
    const cfg = JSON.parse(fs.readFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), 'utf8'));
    assert.equal(cfg.auto_build_floor, 4.0);
    assert.equal(cfg.daily.score_cap, 50);
  });

  await t.test('settings-channels toggles with backup', async () => {
    const ok = await (await post(port, '/settings-channels', { channel: 'linkedin', enabled: true })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const ch = JSON.parse(fs.readFileSync(path.join(v, 'career-profile', 'scan-channels.json'), 'utf8'));
    assert.equal(ch.linkedin.enabled, true);
  });

  await t.test('profile-file roundtrip with backup and conflict guard', async () => {
    const got = await (await fetch(`http://127.0.0.1:${port}/profile-file?name=resume.md`)).json();
    assert.equal(got.ok, true);
    assert.match(got.content, /original content/);
    const saved = await (await post(port, '/profile-file', { name: 'resume.md', content: '# Resume\nedited\n', loaded_mtime: got.mtime })).json();
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.ok(saved.backup.includes('backups/settings/'));
    // stale mtime → 409
    const conflict = await post(port, '/profile-file', { name: 'resume.md', content: 'x', loaded_mtime: got.mtime });
    assert.equal(conflict.status, 409);
    // unknown file → 400
    const bad = await post(port, '/profile-file', { name: '../evil.md', content: 'x' });
    assert.equal(bad.status, 400);
  });

  await t.test('autorun-state reports and all-lin toggle shells per job', async () => {
    const st = await (await fetch(`http://127.0.0.1:${port}/autorun-state`)).json();
    assert.equal(st.ok, true);
    // 7 tiered autorun crons: scan, status, score, stage, build-forge, deep-prep, track.
    // (build/finalize are deprecated→build-forge; followups toggles separately.)
    assert.equal(st.total, 7);
    const ok = await (await post(port, '/cron-toggle', { job: 'all-lin', enabled: false })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.results.length, 7);
  });

  await t.test('run-pipeline triggers the chain and rate-limits', async () => {
    const ok = await (await post(port, '/run-pipeline', {})).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match(ok.note, /stage → build-forge/);
    const again = await post(port, '/run-pipeline', {});
    assert.equal(again.status, 429);
  });

  await t.test('cover endpoint validates status and spawns the shim', async () => {
    const missing = await post(port, '/cover', { co: 'acme', slug: 'nope' });
    assert.equal(missing.status, 404);
    // pm-ready was applied earlier in this suite → applied is allowed for covers
    const ok = await (await post(port, '/cover', { co: 'acme', slug: 'pm-ready' })).json();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const again = await post(port, '/cover', { co: 'acme', slug: 'pm-ready' });
    assert.equal(again.status, 429); // one at a time per role
  });
});

test('lin-serve static artifacts: serves whitelisted files, blocks traversal and config', async (t) => {
  const v = makeVault();
  fs.mkdirSync(path.join(v, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(v, 'reports', '620-ebay.md'), '# eBay report\nbody\n');
  // pm-ready gets an index file (PACKAGE.md); pm-staged intentionally has none.
  fs.writeFileSync(path.join(v, 'companies', 'acme', 'jobs', 'pm-ready', 'PACKAGE.md'), '# package\n');
  const port = 19000 + Math.floor(Math.random() * 2000);
  const child = await startServer(v, port);
  t.after(() => child.kill());

  await t.test('serves a report as markdown', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/reports/620-ebay.md`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/markdown/);
    assert.match(await r.text(), /eBay report/);
  });
  await t.test('serves a folder index but never a directory listing', async () => {
    // folder WITH an index → 200 serving the index
    const idx = await fetch(`http://127.0.0.1:${port}/companies/acme/jobs/pm-ready/`);
    assert.equal(idx.status, 200);
    assert.match(await idx.text(), /package/);
    // folder WITHOUT an index → 404 (no enumeration of filenames)
    const bare = await fetch(`http://127.0.0.1:${port}/companies/acme/jobs/pm-staged/`);
    assert.equal(bare.status, 404);
  });
  await t.test('blocks path traversal', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/reports/..%2f..%2f..%2f..%2fetc%2fpasswd`);
    assert.ok(r.status === 404 || r.status === 403, `got ${r.status}`);
  });
  await t.test('blocks encoded-slash escape OUT of a whitelisted root into a sibling', async () => {
    // %2e%2e%2f decodes to ../ — must not climb from reports/ into career-profile/ or data/.
    const a = await fetch(`http://127.0.0.1:${port}/reports/%2e%2e%2fcareer-profile%2fresume.md`);
    const b = await fetch(`http://127.0.0.1:${port}/reports/%2e%2e%2fdata%2fevaluation-queue.json`);
    assert.ok(a.status === 403 || a.status === 404, `career-profile escape got ${a.status}`);
    assert.ok(b.status === 403 || b.status === 404, `data escape got ${b.status}`);
  });
  await t.test('blocks a symlink inside a whitelisted root that points outside it', async () => {
    fs.symlinkSync(path.join(v, 'career-profile', 'resume.md'), path.join(v, 'reports', 'leak.md'));
    const r = await fetch(`http://127.0.0.1:${port}/reports/leak.md`);
    assert.ok(r.status === 403 || r.status === 404, `symlink leak got ${r.status}`);
  });
  await t.test('404s non-whitelisted roots (config stays private)', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${port}/career-profile/resume.md`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/data/evaluation-queue.json`)).status, 404);
  });
  await t.test('still serves the dashboard at /', async () => {
    // tracker not generated in this fixture → 404 is the documented "not generated yet"
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.ok(r.status === 200 || r.status === 404, `got ${r.status}`);
  });
});
