import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_SCRIPT = path.resolve('scripts/lin-evaluation-queue.mjs');

function makeRole(overrides = {}) {
  return {
    id: '119',
    company: 'Riva International',
    co_slug: 'riva-international',
    role: 'Technical Product Owner',
    job_slug: 'technical-product-owner',
    url: 'https://example.com/jobs/119',
    score: 4.0,
    verdict: 'Strong apply',
    recommendation: 'review',
    queue_state: 'evaluated',
    geo_gate: { reason: null, blocks_stage: false },
    canada_eligible: 'yes',
    canada_eligible_reason: 'Remote Canada listed',
    promotion: { promoted_at: null, job_folder: null, error: null },
    liveness: { checked_at: null, result: null, reason: null },
    notes: [],
    ...overrides,
  };
}

function makeVault(queueRoles, config = { promote_threshold: 3.95 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-eval-queue-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'career-profile'), { recursive: true });
  fs.copyFileSync(SOURCE_SCRIPT, path.join(dir, 'scripts', 'lin-evaluation-queue.mjs'));
  fs.writeFileSync(
    path.join(dir, 'career-profile', 'pipeline-config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'data', 'evaluation-queue.json'),
    JSON.stringify({ schema_version: 1, generated_at: '2026-06-06T00:00:00.000Z', bootstrap: {}, roles: queueRoles }, null, 2) + '\n',
  );
  return dir;
}

function runScript(vault, args, input = '') {
  return spawnSync('node', ['scripts/lin-evaluation-queue.mjs', ...args], {
    cwd: vault,
    input,
    encoding: 'utf8',
  });
}

function readQueue(vault) {
  return JSON.parse(fs.readFileSync(path.join(vault, 'data', 'evaluation-queue.json'), 'utf8'));
}

test('reclassify --write promotes old evaluated/review rows at configured threshold 3.95', () => {
  const vault = makeVault([
    makeRole(),
    makeRole({ id: '120', score: 3.9, job_slug: 'below-threshold' }),
    makeRole({ id: '121', score: 4.2, job_slug: 'blocked', geo_gate: { reason: 'visa', blocks_stage: true }, canada_eligible: 'unknown' }),
  ]);

  const res = runScript(vault, ['reclassify', '--write']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /#119: evaluated\/review → recommended\/auto_stage/);
  const roles = Object.fromEntries(readQueue(vault).roles.map((r) => [r.id, r]));
  assert.equal(roles['119'].queue_state, 'recommended');
  assert.equal(roles['119'].recommendation, 'auto_stage');
  assert.equal(roles['120'].queue_state, 'evaluated');
  assert.equal(roles['120'].recommendation, 'review');
  assert.equal(roles['121'].queue_state, 'evaluated');
  assert.equal(roles['121'].recommendation, 'review');
});

test('upsert normalizes recommendation using configured threshold, not hardcoded 4.2', () => {
  const vault = makeVault([]);
  const incoming = JSON.stringify({
    company: 'Dropbox',
    co_slug: 'dropbox',
    role: 'Staff Product Manager',
    job_slug: 'staff-product-manager',
    url: 'https://example.com/jobs/130',
    score: 4.0,
    verdict: 'Strong apply',
    recommendation: 'review',
    queue_state: 'evaluated',
    geo_gate: { reason: null, blocks_stage: false },
    canada_eligible: 'yes',
  });

  const res = runScript(vault, ['upsert', '--id', '130'], incoming);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const role = readQueue(vault).roles[0];
  assert.equal(role.queue_state, 'recommended');
  assert.equal(role.recommendation, 'auto_stage');
});

test('reclassify --write syncs old queue rows that already have applied Lin folders', () => {
  const vault = makeVault([makeRole({ id: '163', co_slug: 'loblaw', job_slug: 'sr-pm-fraud-payments' })]);
  const existing = path.join(vault, 'companies', 'loblaw', 'jobs', 'sr-pm-fraud-payments');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'job.yml'), 'status: applied\nats_winner: forge\n');

  const res = runScript(vault, ['reclassify', '--write']);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /#163: .* → applied\/auto_stage/);
  const role = readQueue(vault).roles[0];
  assert.equal(role.queue_state, 'applied');
  assert.equal(role.promotion.job_folder, 'companies/loblaw/jobs/sr-pm-fraud-payments');
});

test('upsert moves free-text geo_gate.reason into detail and derives enum reason', () => {
  const vault = makeVault([]);
  const incoming = JSON.stringify({
    company: 'Stripe',
    co_slug: 'stripe',
    role: 'Product Manager',
    job_slug: 'product-manager',
    url: 'https://example.com/jobs/200',
    score: 4.3,
    verdict: 'Strong apply',
    recommendation: 'review',
    queue_state: 'evaluated',
    geo_gate: { reason: 'US-only remote; no Canada eligibility', blocks_stage: true },
    canada_eligible: 'no',
  });

  const res = runScript(vault, ['upsert', '--id', '200'], incoming);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const role = readQueue(vault).roles[0];
  assert.equal(role.geo_gate.reason, 'remote-only');
  assert.equal(role.geo_gate.detail, 'US-only remote; no Canada eligibility');
  assert.equal(role.geo_gate.blocks_stage, true);
});

test('upsert keeps a valid enum geo_gate.reason unchanged (passthrough)', () => {
  const vault = makeVault([]);
  const incoming = JSON.stringify({
    company: 'Shopify',
    co_slug: 'shopify',
    role: 'Senior PM',
    job_slug: 'senior-pm',
    url: 'https://example.com/jobs/201',
    score: 4.1,
    verdict: 'Apply',
    recommendation: 'review',
    queue_state: 'evaluated',
    geo_gate: { reason: 'visa', blocks_stage: true },
    canada_eligible: 'unknown',
  });

  const res = runScript(vault, ['upsert', '--id', '201'], incoming);

  assert.equal(res.status, 0, res.stderr || res.stdout);
  const role = readQueue(vault).roles[0];
  assert.equal(role.geo_gate.reason, 'visa');
  assert.equal(role.geo_gate.detail, '');
  assert.equal(role.geo_gate.blocks_stage, true);
});

test('geo_gate normalization is idempotent across a second upsert', () => {
  const vault = makeVault([]);
  const incoming = JSON.stringify({
    company: 'Notion',
    co_slug: 'notion',
    role: 'PM',
    job_slug: 'pm',
    url: 'https://example.com/jobs/202',
    score: 4.0,
    verdict: 'Apply',
    recommendation: 'review',
    queue_state: 'evaluated',
    geo_gate: { reason: 'Requires visa sponsorship we cannot provide', blocks_stage: true },
    canada_eligible: 'unknown',
  });
  assert.equal(runScript(vault, ['upsert', '--id', '202'], incoming).status, 0);
  const first = readQueue(vault).roles[0].geo_gate;
  assert.equal(first.reason, 'visa');
  assert.equal(first.detail, 'Requires visa sponsorship we cannot provide');

  // Re-upsert the normalized payload — must be stable.
  const reapply = JSON.stringify({ score: 4.0, geo_gate: first });
  assert.equal(runScript(vault, ['upsert', '--id', '202'], reapply).status, 0);
  const second = readQueue(vault).roles[0].geo_gate;
  assert.deepEqual(second, first);
});

// ---------- re-architecture (2026-06): built state, manual source, request-build ----------

test('exports: SOURCE_VALUES has manual, QUEUE_STATES has built, mapJobStatusToQueueState maps new states', async () => {
  const m = await import(SOURCE_SCRIPT);
  assert.ok(m.SOURCE_VALUES.has('manual'));
  assert.ok(m.QUEUE_STATES.has('built'));
  assert.equal(m.mapJobStatusToQueueState('built'), 'built');
  assert.equal(m.mapJobStatusToQueueState('staged'), 'staged');
  assert.equal(m.mapJobStatusToQueueState('materials_ready'), 'materials_ready');
  assert.equal(m.mapJobStatusToQueueState('applied'), 'applied');
  assert.equal(m.mapJobStatusToQueueState('mystery-status'), 'staged'); // unknown collapses to staged (unchanged)
});

test('validate accepts manual source and build_requested fields', () => {
  const vault = makeVault([
    makeRole({ id: '300', source: 'manual', build_requested: true, build_requested_at: '2026-06-10T12:00:00Z' }),
  ]);
  const res = runScript(vault, ['validate']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
});

test('validate rejects non-boolean build_requested', () => {
  const vault = makeVault([makeRole({ id: '301', build_requested: 'yes' })]);
  const res = runScript(vault, ['validate']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /build_requested/);
});

test('request-build demands --id', () => {
  const vault = makeVault([]);
  const res = runScript(vault, ['request-build']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr + res.stdout, /--id/);
});

test('request-build sets and clears the flag on an eligible row', () => {
  const vault = makeVault([makeRole({ id: '310', score: 4.0 })]);
  const set = runScript(vault, ['request-build', '--id', '310']);
  assert.equal(set.status, 0, set.stderr || set.stdout);
  let role = readQueue(vault).roles[0];
  assert.equal(role.build_requested, true);
  assert.ok(role.build_requested_at);
  const clear = runScript(vault, ['request-build', '--id', '310', '--clear']);
  assert.equal(clear.status, 0, clear.stderr || clear.stdout);
  role = readQueue(vault).roles[0];
  assert.equal(role.build_requested, false);
  assert.equal(role.build_requested_at, null);
});

test('request-build refuses terminal rows and sub-threshold scores', () => {
  const vault = makeVault([
    makeRole({ id: '320', queue_state: 'applied' }),
    makeRole({ id: '321', score: 3.5 }),
  ]);
  const terminal = runScript(vault, ['request-build', '--id', '320']);
  assert.notEqual(terminal.status, 0);
  assert.match(terminal.stderr, /terminal/);
  const low = runScript(vault, ['request-build', '--id', '321']);
  assert.notEqual(low.status, 0);
  assert.match(low.stderr, /promote_threshold/);
});

test('reclassify syncs a built job folder into queue_state built', () => {
  const vault = makeVault([makeRole({ id: '330', co_slug: 'acme', job_slug: 'built-role' })]);
  const dir = path.join(vault, 'companies', 'acme', 'jobs', 'built-role');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.yml'), 'status: built\nats_winner: null\n');
  const res = runScript(vault, ['reclassify', '--write']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.equal(readQueue(vault).roles[0].queue_state, 'built');
  assert.equal(runScript(vault, ['validate']).status, 0);
});

test('reclassify --write backfills legacy free-text geo_gate.reason and validate passes', () => {
  const vault = makeVault([
    makeRole({ id: '210', geo_gate: { reason: 'Onsite in NYC, relocation required', blocks_stage: true }, canada_eligible: 'unknown' }),
  ]);

  const dry = runScript(vault, ['reclassify']);
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  assert.match(dry.stdout, /#210: geo_gate\.reason .* → "onsite-only" \(detail preserved\)/);
  // dry-run must not mutate
  assert.equal(readQueue(vault).roles[0].geo_gate.reason, 'Onsite in NYC, relocation required');

  const wrote = runScript(vault, ['reclassify', '--write']);
  assert.equal(wrote.status, 0, wrote.stderr || wrote.stdout);
  const role = readQueue(vault).roles[0];
  assert.equal(role.geo_gate.reason, 'onsite-only');
  assert.equal(role.geo_gate.detail, 'Onsite in NYC, relocation required');
  assert.equal(role.geo_gate.blocks_stage, true);

  assert.equal(runScript(vault, ['validate']).status, 0);
});
