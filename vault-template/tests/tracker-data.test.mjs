import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-td-'));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), JSON.stringify({ promote_threshold: 3.95 }));
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Alex Morgan\n');
  fs.writeFileSync(path.join(v, 'data', 'pipeline.md'),
    '- [ ] 2026-06-10 | NewCo | Platform PM | https://example.com/jobs/p1 | src=manual\n');
  const mk = (slug, yml) => {
    const d = path.join(v, 'companies', 'acme', 'jobs', slug);
    fs.mkdirSync(path.join(d, 'resumes'), { recursive: true });
    fs.writeFileSync(path.join(d, 'job.yml'), yml);
    fs.writeFileSync(path.join(d, 'status-history.md'), '2026-06-09T00:00:00Z  staged  test\n');
  };
  mk('r-ready', 'job_slug: r-ready\ncompany_slug: acme\ntitle: Ready PM\nstatus: materials_ready\nats_winner: forge\npathfinder_score: 4.4\n');
  mk('r-staged', 'job_slug: r-staged\ncompany_slug: acme\ntitle: Staged PM\nstatus: staged\nats_winner: null\n');
  mk('r-legacy', 'job_slug: r-legacy\ncompany_slug: acme\ntitle: Legacy PM\nstatus: new\nats_winner: null\n');
  mk('r-wont', 'job_slug: r-wont\ncompany_slug: acme\ntitle: Declined PM\nstatus: closed\nstatus_detail: "won\'t_apply: nah"\n');
  fs.writeFileSync(path.join(v, 'data', 'evaluation-queue.json'), JSON.stringify({
    schema_version: 1, bootstrap: {}, roles: [
      { id: '1', company: 'Hi', co_slug: 'hi', role: 'A', job_slug: 'a', url: 'https://x/1', score: 4.2, queue_state: 'evaluated', recommendation: 'review', canada_eligible: 'yes', build_requested: true, build_requested_at: '2026-06-10T12:00:00Z' },
      { id: '2', company: 'Lo', co_slug: 'lo', role: 'B', job_slug: 'b', url: 'https://x/2', score: 3.2, queue_state: 'evaluated', recommendation: 'review', canada_eligible: 'unknown' },
      { id: '3', company: 'Skip', co_slug: 'sk', role: 'C', job_slug: 'c', url: 'https://x/3', score: 2.0, queue_state: 'evaluated', recommendation: 'skip', canada_eligible: 'no' },
      // mirrors the declined folder → must dedup to the folder row
      { id: '4', company: 'Acme', co_slug: 'acme', job_slug: 'r-wont', role: 'Declined PM', url: 'https://x/4', score: 4.0, queue_state: 'skipped', recommendation: 'manual_override', notes: ["won't_apply"] },
    ],
  }));
  return v;
}

test('buildRows: stages, actions, dedup, legacy normalization, pending', async () => {
  const d = await import('../scripts/lib/tracker-data.mjs');
  d.init(makeVault());
  const jobs = d.walkJobs();
  const queue = d.readEvaluationQueue(jobs);
  const rows = d.buildRows({ jobs, queue, pipelineRows: d.readPipelineRows() });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));

  assert.equal(by['acme/r-ready'].stage, 'ready');
  assert.deepEqual(by['acme/r-ready'].actions, ['apply', 'wont']); // rebuild+cover live in the expand's secondary actions
  assert.equal(by['acme/r-staged'].stage, 'staged');
  assert.equal(by['acme/r-legacy'].stage, 'staged'); // legacy "new" normalizes
  assert.equal(by['acme/r-wont'].stage, 'wont');

  assert.equal(by['#1'].stage, 'review-hi');
  assert.deepEqual(by['#1'].actions, ['prepare', 'wont']);
  assert.equal(by['#1'].buildRequestedAt, '2026-06-10T12:00:00Z');
  assert.equal(by['#2'].stage, 'review');
  assert.deepEqual(by['#2'].actions, ['wont']);
  assert.equal(by['#3'].stage, 'skip');
  assert.equal(by['#4'], undefined); // deduped into the folder row

  const pending = rows.filter((r) => r.stage === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].source, 'manual');
  assert.deepEqual(pending[0].actions, []);

  const c = d.railCounts(rows);
  assert.equal(c['review-hi'], 1);
  assert.equal(c.ready, 1);
  assert.equal(c.staged, 2); // staged + normalized legacy
  assert.equal(c.wont, 1);
  assert.equal(c.pending, 1);
});
