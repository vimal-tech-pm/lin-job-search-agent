// Playwright click-through of the Phase-7 dashboard against a scratch vault.
// Uses the chromium vendored under engines/pathfinder. Skips cleanly when unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const PW_PATH = path.resolve('engines/pathfinder/node_modules/playwright');
const HAVE_PW = fs.existsSync(path.join(PW_PATH, 'package.json'));

const SCRIPTS = ['lin-serve.mjs', 'lin-apply.mjs', 'lin-wont-apply.mjs', 'lin-evaluation-queue.mjs', 'lin-tracker.mjs'];

function makeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-pwt-'));
  fs.mkdirSync(path.join(v, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(v, 'scripts', 'templates'), { recursive: true });
  for (const s of SCRIPTS) fs.copyFileSync(path.resolve('scripts', s), path.join(v, 'scripts', s));
  for (const f of fs.readdirSync(path.resolve('scripts/lib'))) fs.copyFileSync(path.resolve('scripts/lib', f), path.join(v, 'scripts/lib', f));
  for (const f of fs.readdirSync(path.resolve('scripts/templates'))) fs.copyFileSync(path.resolve('scripts/templates', f), path.join(v, 'scripts/templates', f));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.mkdirSync(path.join(v, 'companies'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Alex Morgan\n');
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), JSON.stringify({ promote_threshold: 3.95 }));
  fs.writeFileSync(path.join(v, 'data', 'pipeline.md'), '');
  fs.writeFileSync(path.join(v, 'data', 'evaluation-queue.json'), JSON.stringify({
    schema_version: 1, bootstrap: {}, roles: [{
      id: '800', company: 'ClickCo', co_slug: 'clickco', role: 'Senior PM', job_slug: 'senior-pm',
      url: 'https://example.com/jobs/800', score: 4.3, verdict: 'Strong apply',
      recommendation: 'review', queue_state: 'evaluated', canada_eligible: 'yes',
      geo_gate: { reason: null, blocks_stage: false },
      promotion: { promoted_at: null, job_folder: null, error: null },
      liveness: { checked_at: null, result: null, reason: null }, notes: [],
    }],
  }));
  return v;
}

test('dashboard click-through: Prepare flags the queue row; theme toggle persists', { skip: !HAVE_PW, timeout: 120000 }, async (t) => {
  const v = makeVault();
  const gen = spawnSync(process.execPath, [path.join(v, 'scripts', 'lin-tracker.mjs')], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);

  const port = 19000 + Math.floor(Math.random() * 2000);
  const server = spawn(process.execPath, [path.join(v, 'scripts', 'lin-serve.mjs')], {
    env: { ...process.env, LIN_SERVE_PORT: String(port), LIN_HERMES_BIN: '/bin/echo' },
  });
  t.after(() => server.kill());
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  const { chromium } = await import(PW_PATH + '/index.mjs').catch(() => import(PW_PATH));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

  // default rail stage = review-hi (no ready rows in fixture); the row is visible
  await page.waitForSelector('tr.r[data-id="800"]', { state: 'visible', timeout: 10000 });

  // click Prepare → request-build endpoint → queue mutated + button flips
  await page.click('tr.r[data-id="800"] button[data-act="prepare"]');
  await page.waitForFunction(() =>
    document.querySelector('tr.r[data-id="800"] td.act')?.textContent.includes('requested'), null, { timeout: 10000 });
  const queue = JSON.parse(fs.readFileSync(path.join(v, 'data', 'evaluation-queue.json'), 'utf8'));
  assert.equal(queue.roles[0].build_requested, true);

  // theme toggle persists to localStorage and flips data-theme
  const before = await page.getAttribute('html', 'data-theme');
  await page.click('#theme-toggle');
  const after = await page.getAttribute('html', 'data-theme');
  assert.notEqual(before, after);
  assert.equal(await page.evaluate(() => localStorage.getItem('lin-theme')), after);

  // expand row shows links/details
  await page.click('tr.r[data-id="800"] button.xbtn');
  const xpVisible = await page.isVisible('tr.r[data-id="800"] + tr.xp');
  assert.equal(xpVisible, true);
});
