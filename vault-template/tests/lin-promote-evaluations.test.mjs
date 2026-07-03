import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_SCRIPT = path.resolve('scripts/lin-promote-evaluations.mjs');

function makeRole(overrides = {}) {
  return {
    id: '101',
    queue_state: 'recommended',
    recommendation: 'auto_stage',
    score: 4.6,
    company: 'Acme AI',
    co_slug: 'acme-ai',
    role: 'Senior Product Manager',
    job_slug: 'senior-product-manager',
    url: 'https://example.com/jobs/101',
    location: 'Remote Canada',
    verdict: 'Strong apply',
    canada_eligible: 'yes',
    canada_eligible_reason: 'Remote Canada listed',
    geo_gate: { blocks_stage: false, reason: '' },
    jd_snapshot: 'Senior Product Manager JD body with enough useful context for testing.',
    keywords: ['AI', 'Product'],
    ...overrides,
  };
}

function makeVault(queueRoles, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-promote-test-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'career-profile'), { recursive: true });
  fs.copyFileSync(SOURCE_SCRIPT, path.join(dir, 'scripts', 'lin-promote-evaluations.mjs'));
  // the script imports the shared geo-gate decision; copy it so the temp vault resolves it
  fs.copyFileSync(path.resolve('scripts/lib/geo-gate.mjs'), path.join(dir, 'scripts', 'lib', 'geo-gate.mjs'));
  // it also imports the shared canonical-identity helpers (cross-source dedup)
  fs.copyFileSync(path.resolve('scripts/lib/canonical.mjs'), path.join(dir, 'scripts', 'lib', 'canonical.mjs'));
  fs.writeFileSync(
    path.join(dir, 'data', 'evaluation-queue.json'),
    JSON.stringify({ schema_version: 1, generated_at: '2026-06-02T00:00:00.000Z', roles: queueRoles }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'career-profile', 'pipeline-config.json'),
    JSON.stringify({ promote_threshold: 3.95, promote_limit: 25, daily: { top_prepare_cap: 10 }, ...config }, null, 2) + '\n',
  );
  return dir;
}

function runScript(vault, args) {
  return spawnSync('node', ['scripts/lin-promote-evaluations.mjs', ...args], {
    cwd: vault,
    encoding: 'utf8',
  });
}

test('--list-candidates --json emits eligible promotion candidates without running liveness', () => {
  const vault = makeVault([
    makeRole(),
    makeRole({ id: '102', job_slug: 'low-score', score: 4.1, url: 'https://example.com/jobs/102' }),
    makeRole({
      id: '103',
      job_slug: 'geo-blocked',
      url: 'https://example.com/jobs/103',
      geo_gate: { blocks_stage: true, reason: 'US-only' },
    }),
  ]);

  const res = runScript(vault, ['--list-candidates', '--json', '--threshold=4.2', '--limit=10']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.candidates.map((c) => c.id), ['101']);
  assert.equal(payload.candidates[0].source_url, 'https://example.com/jobs/101');
  assert.equal(payload.candidates[0].title, 'Senior Product Manager');
});

test('--list-candidates includes old evaluated/review rows when score meets configured threshold', () => {
  const vault = makeVault([
    makeRole({
      id: '119',
      queue_state: 'evaluated',
      recommendation: 'review',
      score: 4.0,
      job_slug: 'technical-product-owner',
      url: 'https://example.com/jobs/119',
    }),
    makeRole({
      id: '120',
      queue_state: 'evaluated',
      recommendation: 'review',
      score: 3.9,
      job_slug: 'below-threshold',
      url: 'https://example.com/jobs/120',
    }),
  ]);

  const res = runScript(vault, ['--list-candidates', '--json', '--threshold=3.95', '--limit=10']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.candidates.map((c) => c.id), ['119']);
});

test('--list-candidates excludes rows that already have a Lin-managed folder', () => {
  const vault = makeVault([
    makeRole({
      id: '119',
      queue_state: 'evaluated',
      recommendation: 'review',
      score: 4.0,
      co_slug: 'riva-international',
      job_slug: 'technical-product-owner',
      url: 'https://example.com/jobs/119',
    }),
  ]);
  const existing = path.join(vault, 'companies', 'riva-international', 'jobs', 'technical-product-owner');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'job.yml'), 'status: applied\nats_winner: forge\n');

  const res = runScript(vault, ['--list-candidates', '--json', '--threshold=3.95', '--limit=10']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.candidates.map((c) => c.id), []);
});

test('--liveness-file stages only externally active roles and does not call Playwright liveness', () => {
  const vault = makeVault([makeRole()]);
  const livenessPath = path.join(vault, 'liveness.json');
  fs.writeFileSync(
    livenessPath,
    JSON.stringify({
      checked_by: 'hermes-browser',
      results: [
        {
          id: '101',
          checked_url: 'https://example.com/jobs/101',
          status: 'active',
          checked_at: '2026-06-02T00:00:00.000Z',
          evidence: 'Role title and apply button visible via browser_navigate.',
        },
      ],
    }, null, 2),
  );

  const res = runScript(vault, ['--dry-run', `--liveness-file=${livenessPath}`, '--threshold=4.2', '--limit=10']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /external liveness/i);
  assert.match(res.stdout, /→ active: Role title and apply button visible/);
  assert.match(res.stdout, /\[stage\]/);
  assert.doesNotMatch(res.stdout, /check-liveness\.mjs|Playwright|liveness script missing/i);
});

test('missing external liveness defaults to uncertain and does not stage or close', () => {
  const vault = makeVault([makeRole()]);
  const livenessPath = path.join(vault, 'liveness.json');
  fs.writeFileSync(livenessPath, JSON.stringify({ checked_by: 'hermes-browser', results: [] }, null, 2));

  const res = runScript(vault, ['--dry-run', `--liveness-file=${livenessPath}`, '--threshold=4.2', '--limit=10']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /→ uncertain: no external liveness result/i);
  assert.match(res.stdout, /\[hold\]/);
  assert.doesNotMatch(res.stdout, /\[stage\]|\[closed\]/);
});

test('--top-prepare selects configurable top scoring eligible roles regardless of recommendation threshold', () => {
  const vault = makeVault([
    makeRole({ id: '201', queue_state: 'evaluated', recommendation: 'review', score: 3.2, job_slug: 'third', url: 'https://example.com/jobs/201' }),
    makeRole({ id: '202', queue_state: 'evaluated', recommendation: 'review', score: 4.8, job_slug: 'first', url: 'https://example.com/jobs/202' }),
    makeRole({ id: '203', queue_state: 'recommended', recommendation: 'auto_stage', score: 4.1, job_slug: 'second', url: 'https://example.com/jobs/203' }),
    makeRole({ id: '204', queue_state: 'evaluated', recommendation: 'review', score: 4.9, job_slug: 'geo-blocked', url: 'https://example.com/jobs/204', canada_eligible: 'no', geo_gate: { blocks_stage: true, reason: 'US-only' } }),
    makeRole({ id: '205', queue_state: 'evaluated', recommendation: 'skip', score: 4.7, job_slug: 'skip-rec', url: 'https://example.com/jobs/205' }),
  ], { daily: { top_prepare_cap: 2 } });

  const res = runScript(vault, ['--list-candidates', '--json', '--top-prepare']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection_mode, 'top_prepare');
  assert.equal(payload.limit, 2);
  assert.deepEqual(payload.candidates.map((c) => c.id), ['202', '203']);
});

test('--top-prepare includes already staged but not materials-ready roles and skips finished materials', () => {
  const vault = makeVault([
    makeRole({ id: '301', queue_state: 'staged', recommendation: 'auto_stage', score: 4.9, co_slug: 'readyco', job_slug: 'already-ready', url: 'https://example.com/jobs/301' }),
    makeRole({ id: '302', queue_state: 'staged', recommendation: 'auto_stage', score: 4.8, co_slug: 'newco', job_slug: 'staged-new', url: 'https://example.com/jobs/302' }),
    makeRole({ id: '303', queue_state: 'evaluated', recommendation: 'review', score: 4.7, co_slug: 'evalco', job_slug: 'needs-stage', url: 'https://example.com/jobs/303' }),
  ], { daily: { top_prepare_cap: 10 } });
  fs.mkdirSync(path.join(vault, 'companies', 'readyco', 'jobs', 'already-ready'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'companies', 'readyco', 'jobs', 'already-ready', 'job.yml'), 'status: materials_ready\nats_winner: forge\n');
  fs.mkdirSync(path.join(vault, 'companies', 'newco', 'jobs', 'staged-new'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'companies', 'newco', 'jobs', 'staged-new', 'job.yml'), 'status: new\nats_winner: null\n');

  const res = runScript(vault, ['--list-candidates', '--json', '--top-prepare']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.candidates.map((c) => c.id), ['302', '303']);
  assert.equal(payload.candidates[0].job_folder, 'companies/newco/jobs/staged-new');
  assert.equal(payload.candidates[0].needs_promotion, false);
  assert.equal(payload.candidates[1].needs_promotion, true);
});

// ---------- re-architecture (2026-06): staged status, manual provenance, --auto ----------

test('promotion writes status: staged and manual source maps to intake-manual', () => {
  const vault = makeVault([
    makeRole({ id: '401', co_slug: 'handco', job_slug: 'hand-added', source: 'manual', url: 'https://example.com/jobs/401' }),
  ]);
  const liveness = path.join(vault, 'liveness.json');
  fs.writeFileSync(liveness, JSON.stringify({
    checked_by: 'test',
    results: [{ id: '401', checked_url: 'https://example.com/jobs/401', status: 'active', apply_path_found: true, checked_at: '2026-06-10T00:00:00Z', evidence: 'test' }],
  }));
  const res = runScript(vault, [`--liveness-file=${liveness}`, '--threshold=3.95', '--limit=5']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const yml = fs.readFileSync(path.join(vault, 'companies', 'handco', 'jobs', 'hand-added', 'job.yml'), 'utf8');
  assert.match(yml, /^status: staged$/m);
  assert.match(yml, /^discovered_via: intake-manual$/m);
});

test('a queue row posted_date threads into the staged job.yml', () => {
  const vault = makeVault([
    makeRole({ id: '411', co_slug: 'freshco', job_slug: 'fresh-role', url: 'https://example.com/jobs/411', posted_date: '2026-06-12' }),
    makeRole({ id: '412', co_slug: 'datelessco', job_slug: 'no-date', url: 'https://example.com/jobs/412' }),
  ]);
  const liveness = path.join(vault, 'liveness.json');
  fs.writeFileSync(liveness, JSON.stringify({
    checked_by: 'test',
    results: [
      { id: '411', checked_url: 'https://example.com/jobs/411', status: 'active', apply_path_found: true, evidence: 'test' },
      { id: '412', checked_url: 'https://example.com/jobs/412', status: 'active', apply_path_found: true, evidence: 'test' },
    ],
  }));
  const res = runScript(vault, [`--liveness-file=${liveness}`, '--threshold=3.95', '--limit=5']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(fs.readFileSync(path.join(vault, 'companies', 'freshco', 'jobs', 'fresh-role', 'job.yml'), 'utf8'), /^posted_date: 2026-06-12$/m);
  assert.match(fs.readFileSync(path.join(vault, 'companies', 'datelessco', 'jobs', 'no-date', 'job.yml'), 'utf8'), /^posted_date: null$/m);
});

test('liveness cover_required threads into staged job.yml.cover_required', () => {
  const vault = makeVault([
    makeRole({ id: '801', co_slug: 'covco', job_slug: 'needs-cover', url: 'https://example.com/jobs/801' }),
    makeRole({ id: '802', co_slug: 'nocov', job_slug: 'no-cover', url: 'https://example.com/jobs/802' }),
  ]);
  const liveness = path.join(vault, 'liveness.json');
  fs.writeFileSync(liveness, JSON.stringify({
    checked_by: 'test',
    results: [
      { id: '801', checked_url: 'https://example.com/jobs/801', status: 'active', apply_path_found: true, cover_required: true, evidence: 'cover-letter field on Greenhouse form' },
      { id: '802', checked_url: 'https://example.com/jobs/802', status: 'active', apply_path_found: true, evidence: 'no cover field seen' },
    ],
  }));
  const res = runScript(vault, [`--liveness-file=${liveness}`, '--threshold=3.95', '--limit=5']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(fs.readFileSync(path.join(vault, 'companies', 'covco', 'jobs', 'needs-cover', 'job.yml'), 'utf8'), /^cover_required: true$/m);
  assert.match(fs.readFileSync(path.join(vault, 'companies', 'nocov', 'jobs', 'no-cover', 'job.yml'), 'utf8'), /^cover_required: false$/m);
});

test('--list-candidates --auto returns top-N floor rows plus every build_requested row (any score)', () => {
  const vault = makeVault([
    makeRole({ id: '501', score: 4.6, job_slug: 'r501', url: 'https://example.com/jobs/501' }),
    makeRole({ id: '502', score: 4.4, job_slug: 'r502', url: 'https://example.com/jobs/502' }),
    makeRole({ id: '503', score: 4.3, job_slug: 'r503', url: 'https://example.com/jobs/503' }),
    makeRole({ id: '504', score: 4.25, job_slug: 'r504', url: 'https://example.com/jobs/504' }),
    makeRole({ id: '505', score: 4.0, job_slug: 'r505', url: 'https://example.com/jobs/505', build_requested: true }),
    makeRole({ id: '506', score: 3.8, job_slug: 'r506', url: 'https://example.com/jobs/506', build_requested: true }),
    makeRole({ id: '507', score: 3.5, job_slug: 'r507', url: 'https://example.com/jobs/507' }),
  ], { auto_build_floor: 4.2, auto_build_top_n: 3 });

  const res = runScript(vault, ['--list-candidates', '--json', '--auto']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection_mode, 'auto');
  // top-3 ≥ floor (501,502,503) + EVERY build_requested row regardless of score:
  // 505 (4.0) and 506 (3.8, below promote_threshold) are both explicit superuser requests.
  assert.deepEqual(payload.candidates.map((c) => c.id), ['501', '502', '503', '505', '506']);
  const by = Object.fromEntries(payload.candidates.map((c) => [c.id, c.selected_by]));
  assert.equal(by['501'], 'auto-top-n');
  assert.equal(by['505'], 'build_requested');
  assert.equal(by['506'], 'build_requested'); // below floor + below promote_threshold, but explicitly requested
});

test('--auto skips geo-blocked rows before top-N slicing and reports skip count', () => {
  const vault = makeVault([
    makeRole({ id: '601', score: 4.9, job_slug: 'blocked-high', url: 'https://example.com/jobs/601', geo_gate: { blocks_stage: true, reason: 'remote-only' } }),
    makeRole({ id: '602', score: 4.4, job_slug: 'eligible-one', url: 'https://example.com/jobs/602' }),
    makeRole({ id: '603', score: 4.3, job_slug: 'eligible-two', url: 'https://example.com/jobs/603' }),
    makeRole({ id: '604', score: 4.2, job_slug: 'eligible-three', url: 'https://example.com/jobs/604' }),
  ], { auto_build_floor: 4.2, auto_build_top_n: 2 });

  const res = runScript(vault, ['--list-candidates', '--json', '--auto']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.geo_blocked_auto_skipped, 1);
  assert.deepEqual(payload.candidates.map((c) => c.id), ['602', '603']);
});

test('--auto includes build_requested geo-blocked rows as explicit overrides', () => {
  const vault = makeVault([
    makeRole({ id: '701', score: 4.6, job_slug: 'eligible-auto', url: 'https://example.com/jobs/701' }),
    makeRole({ id: '702', score: 4.0, job_slug: 'blocked-requested', url: 'https://example.com/jobs/702', build_requested: true, geo_gate: { blocks_stage: true, reason: 'onsite-only' } }),
  ], { auto_build_floor: 4.2, auto_build_top_n: 1 });

  const res = runScript(vault, ['--list-candidates', '--json', '--auto']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.candidates.map((c) => c.id), ['701', '702']);
  const requested = payload.candidates.find((c) => c.id === '702');
  assert.equal(requested.selected_by, 'build_requested');
  assert.equal(requested.geo_gate_bypassed, true);
  assert.equal(requested.geo_gate_reason, 'onsite-only');
});

test('--id bypasses geo gate and proceeds to liveness/stage', () => {
  const vault = makeVault([
    makeRole({ id: '801', score: 4.6, co_slug: 'blockedco', job_slug: 'blocked-manual', url: 'https://example.com/jobs/801', geo_gate: { blocks_stage: true, reason: 'visa' } }),
  ]);
  const liveness = path.join(vault, 'liveness.json');
  fs.writeFileSync(liveness, JSON.stringify({
    checked_by: 'test',
    results: [{ id: '801', checked_url: 'https://example.com/jobs/801', status: 'active', apply_path_found: true, checked_at: '2026-06-10T00:00:00Z', evidence: 'test' }],
  }));

  const res = runScript(vault, [`--liveness-file=${liveness}`, '--id=801']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /\[override\].*building despite geo gate \(visa\)/);
  assert.match(res.stdout, /\[stage\]/);
  const yml = fs.readFileSync(path.join(vault, 'companies', 'blockedco', 'jobs', 'blocked-manual', 'job.yml'), 'utf8');
  assert.match(yml, /^status: staged$/m);
});
