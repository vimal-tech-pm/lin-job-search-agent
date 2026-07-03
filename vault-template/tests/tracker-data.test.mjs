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
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Jane Doe\n');
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
      // geo-blocked top matches — must surface geoBlocked + a short reason (mirrors promotionBlock)
      { id: '5', company: 'Remote', co_slug: 'rm', role: 'PM', job_slug: 'pm5', url: 'https://x/5', score: 4.3, queue_state: 'evaluated', recommendation: 'review', canada_eligible: 'no', geo_gate: { reason: 'remote-only', blocks_stage: true } },
      { id: '6', company: 'NoCa', co_slug: 'nc', role: 'PM', job_slug: 'pm6', url: 'https://x/6', score: 4.1, queue_state: 'evaluated', recommendation: 'review', canada_eligible: 'no' },
      // blocked with a null geo_gate.reason but a rich canada_eligible_reason — the UI must surface the rich text, not "location-blocked"
      { id: '7', company: 'NullR', co_slug: 'nr', role: 'PM', job_slug: 'pm7', url: 'https://x/7', score: 3.5, queue_state: 'evaluated', recommendation: 'review', canada_eligible: 'no', canada_eligible_reason: 'Remote US only — no Canada', geo_gate: { reason: null, blocks_stage: true } },
      // a closed queue row must archive to "closed" (no Prepare button), not fall through to "review"
      { id: '8', company: 'Closed', co_slug: 'cl', role: 'PM', job_slug: 'pm8', url: 'https://x/8', score: 4.0, queue_state: 'closed', recommendation: 'review' },
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
  assert.deepEqual(by['#2'].actions, ['prepare', 'wont']); // below-floor "Other matches" rows are now Preparable (superuser override)
  assert.equal(by['#3'].stage, 'skip');
  assert.deepEqual(by['#3'].actions, ['prepare', 'wont']); // SKIP <3.0 is Preparable too — superuser override (e.g. sub-3.0 Cohere roles)
  assert.equal(by['#4'], undefined); // deduped into the folder row

  // geo-block derivation (source of truth for the dashboard's Prepare guard)
  assert.equal(by['#1'].geoBlocked, false); // canada=yes, no gate
  assert.equal(by['#5'].geoBlocked, true);
  assert.equal(by['#5'].geoReason, 'remote-only'); // from geo_gate.reason
  assert.equal(by['#6'].geoBlocked, true);
  assert.equal(by['#6'].geoReason, 'not Canada-eligible'); // canada_eligible=no, no gate
  assert.equal(by['#7'].geoBlocked, true);
  assert.equal(by['#7'].geoReason, 'Remote US only — no Canada'); // null geo reason → falls back to the rich canada reason
  assert.equal(by['#8'].stage, 'closed'); // closed queue rows archive, not mis-filed as review
  assert.deepEqual(by['#8'].actions, []); // and carry no Prepare button

  const pending = rows.filter((r) => r.stage === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].source, 'manual');
  assert.deepEqual(pending[0].actions, []);

  const c = d.railCounts(rows);
  assert.equal(c['review-hi'], 3); // #1 + geo-blocked #5 + #6
  assert.equal(c.ready, 1);
  assert.equal(c.staged, 2); // staged + normalized legacy
  assert.equal(c.wont, 1);
  assert.equal(c.pending, 1);
});

function makeOutcomeVault(jobs) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-oc-'));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), JSON.stringify({ promote_threshold: 3.95 }));
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Jane Doe\n');
  fs.writeFileSync(path.join(v, 'data', 'pipeline.md'), '# Pipeline\n');
  fs.writeFileSync(path.join(v, 'data', 'evaluation-queue.json'), JSON.stringify({ schema_version: 1, roles: [] }));
  for (const [slug, yml] of Object.entries(jobs)) {
    const d = path.join(v, 'companies', 'acme', 'jobs', slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'job.yml'), yml);
    fs.writeFileSync(path.join(d, 'status-history.md'), '2026-06-09T00:00:00Z  applied  test\n');
  }
  return v;
}

test('buildRows: terminal outcomes split the old Closed bucket and carry funnel depth', async () => {
  const d = await import('../scripts/lib/tracker-data.mjs');
  d.init(makeOutcomeVault({
    rej: 'job_slug: rej\ncompany_slug: acme\ntitle: Rejected PM\nstatus: closed\noutcome: rejected\nfurthest_stage: final\noutcome_source: email\n',
    wdr: 'job_slug: wdr\ncompany_slug: acme\ntitle: Withdrew PM\nstatus: closed\noutcome: withdrew\nfurthest_stage: interviewing\n',
    dec: 'job_slug: dec\ncompany_slug: acme\ntitle: Declined PM\nstatus: offer\noutcome: declined\nfurthest_stage: offer\n',
    exp: 'job_slug: exp\ncompany_slug: acme\ntitle: Expired PM\nstatus: closed\noutcome: expired\nfurthest_stage: applied\n',
    dup: 'job_slug: dup\ncompany_slug: acme\ntitle: Dup PM\nstatus: closed\noutcome: duplicate\n',
    liveoffer: 'job_slug: liveoffer\ncompany_slug: acme\ntitle: Live Offer PM\nstatus: offer\nfurthest_stage: offer\n',
    interview: 'job_slug: interview\ncompany_slug: acme\ntitle: Interviewing PM\nstatus: interviewing\nfurthest_stage: final\n',
  }));
  const jobs = d.walkJobs();
  const rows = d.buildRows({ jobs, queue: d.readEvaluationQueue(jobs), pipelineRows: [] });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));

  assert.equal(by['acme/rej'].stage, 'rejected');
  assert.equal(by['acme/rej'].furthestStage, 'final');
  assert.equal(by['acme/rej'].depthLabel, 'after final round');   // the chip the user asked for
  assert.equal(by['acme/wdr'].stage, 'withdrew');
  assert.equal(by['acme/dec'].stage, 'declined');                 // declined wins over the forward "offer" status
  assert.equal(by['acme/exp'].stage, 'expired');
  assert.equal(by['acme/dup'].stage, 'closed');                   // housekeeping stays in plain Closed
  assert.equal(by['acme/liveoffer'].stage, 'offer');              // live offer, no terminal outcome
  assert.equal(by['acme/interview'].stage, 'interviewing');
  assert.equal(by['acme/interview'].depthLabel, 'after final round'); // depth chip on a live interviewing row too

  const c = d.railCounts(rows);
  assert.equal(c.rejected, 1);
  assert.equal(c.withdrew, 1);
  assert.equal(c.declined, 1);
  assert.equal(c.expired, 1);
  assert.equal(c.closed, 1);
});

test('payTier buckets stated pay, handling trailing-k ranges and rejecting untrustworthy hourly/short numbers', async () => {
  const d = await import('../scripts/lib/tracker-data.mjs');
  assert.equal(d.payTier('CAD $124,000 – $160,000').label, '120–160');
  assert.equal(d.payTier('$120-160k').label, '120–160');         // k on the 2nd number must apply (the classic parse trap)
  assert.equal(d.payTier('$210,000–$240,000').label, '200k+');
  assert.equal(d.payTier('$95,000-$110,000').label, '<120');
  assert.equal(d.payTier('US$170k-190k').label, '160–200');
  assert.equal(d.payTier('').label, '—');                        // unknown
  assert.equal(d.payTier('$95-105/hr').label, '—');              // hourly shorthand → not trustworthy, don't mislabel
  assert.ok(d.payTier('$210,000–$240,000').num > d.payTier('CAD $124,000 – $160,000').num); // sortable
  assert.equal(d.payTier('').num, -1);                           // unknown sorts last
});

test('recencyOf prefers a real posted_date, falls back to discovered_at "seen", and buckets by age', async () => {
  const d = await import('../scripts/lib/tracker-data.mjs');
  const today = new Date('2026-06-14T12:00:00Z');
  assert.deepEqual(
    (({ bucket, source }) => ({ bucket, source }))(d.recencyOf({ posted_date: '2026-06-14', discovered_at: '2026-05-01' }, today)),
    { bucket: 'd1', source: 'posted' }); // real posted date wins, fresh
  let r = d.recencyOf({ discovered_at: '2026-06-10' }, today);
  assert.equal(r.bucket, 'd7'); assert.equal(r.source, 'seen'); assert.match(r.label, /^seen 4d$/);
  assert.equal(d.recencyOf({ discovered_at: '2026-05-20' }, today).bucket, 'd30');   // 25 days
  assert.equal(d.recencyOf({ posted_date: '2026-03-01' }, today).bucket, 'old');     // >30d
  assert.equal(d.recencyOf({}, today).label, '—');                                   // nothing known
  assert.equal(d.recencyOf({ discovered_at: '2026-06-14' }, today).label, 'seen today');
});

test('computeFunnel: per-stage conversion + rejection-depth over the applied cohort', async () => {
  const d = await import('../scripts/lib/tracker-data.mjs'); // computeFunnel is pure — no vault init needed
  const jobs = [
    { status: 'closed', outcome: 'rejected', furthest_stage: 'applied' },   // rejected at apply
    { status: 'closed', outcome: 'rejected', furthest_stage: 'final' },     // rejected after final
    { status: 'interviewing', furthest_stage: 'interviewing' },             // live, reached interview
    { status: 'offer', outcome: 'offer', furthest_stage: 'offer' },         // got an offer
    { status: 'staged' },                                                   // never applied — excluded
  ];
  const f = d.computeFunnel(jobs);
  assert.equal(f.total, 4);                 // applied cohort excludes the staged row
  assert.equal(f.counts.applied, 4);
  assert.equal(f.counts.interviewing, 3);   // 2 rejected(final/interview) + the live interview... wait: final(1)+interviewing(1)+offer(1)=3
  assert.equal(f.counts.final, 2);          // the final-round reject + the offer (passed through final)
  assert.equal(f.counts.offer, 1);
  assert.equal(f.outcomeCounts.rejected, 2);
  assert.equal(f.outcomeCounts.offer, 1);
  assert.equal(f.rejDepth.applied, 1);      // one rejection at the application stage
  assert.equal(f.rejDepth.final, 1);        // one rejection after the final round
});

test('collapseDuplicates: same canonical job collapses to one primary with siblings', async () => {
  const { collapseDuplicates } = await import('../scripts/lib/tracker-data.mjs');
  const rows = [
    // Same real job under three keys/layers (folder applied + 2 pending greenhouse ids).
    { kind: 'pending', key: 'https://job-boards.greenhouse.io/instacart/jobs/8014060', company: 'instacart', role: 'Senior Product Manager, Retailer Platform', stage: 'pending', score: null, source: 'portal', url: 'https://job-boards.greenhouse.io/instacart/jobs/8014060', id: null, updated: '2026-06-24' },
    { kind: 'pending', key: 'https://job-boards.greenhouse.io/instacart/jobs/8014062', company: 'instacart', role: 'Senior Product Manager, Retailer Platform', stage: 'pending', score: null, source: 'portal', url: 'https://job-boards.greenhouse.io/instacart/jobs/8014062', id: null, updated: '2026-06-24' },
    { kind: 'job', key: 'instacart/senior-product-manager-retailer-platform', company: 'instacart', role: 'Senior Product Manager, Retailer Platform', stage: 'applied', score: 4.3, source: 'portal', url: 'https://x/applied', id: null, updated: '2026-06-23' },
    // An unrelated role at the same company — must NOT collapse (different normalized title).
    { kind: 'queue', key: '#99', company: 'instacart', role: 'Staff Designer', stage: 'review-hi', score: 4.1, source: 'linkedin', url: 'https://x/99', id: '99', updated: '2026-06-22' },
  ];
  const out = collapseDuplicates(rows);
  assert.equal(out.length, 2, 'two distinct jobs survive');
  const primary = out.find((r) => r.role.startsWith('Senior Product Manager'));
  assert.equal(primary.kind, 'job', 'the authoritative folder row wins as primary');
  assert.equal(primary.stage, 'applied');
  assert.equal(primary.dupCount, 2, 'both pending greenhouse rows are collapsed siblings');
  assert.equal(primary.dupSiblings.length, 2);
  assert.ok(primary.dupSiblings.every((s) => s.kind === 'pending'));
});

test('collapseDuplicates: picks furthest-stage row among same-kind queue rows; blank identity never merges', async () => {
  const { collapseDuplicates } = await import('../scripts/lib/tracker-data.mjs');
  const rows = [
    { kind: 'queue', key: '#694', company: 'forcemetrics', role: 'Product Manager', stage: 'review-hi', score: 4.0, source: 'linkedin', url: 'https://x/694', id: '694', updated: '2026-06-20' },
    { kind: 'queue', key: '#696', company: 'forcemetrics', role: 'Product Manager', stage: 'skip', score: 2.1, source: 'linkedin', url: 'https://x/696', id: '696', updated: '2026-06-19' },
    { kind: 'queue', key: '#741', company: 'forcemetrics', role: 'Product Manager', stage: 'skip', score: 2.0, source: 'linkedin', url: 'https://x/741', id: '741', updated: '2026-06-18' },
    // Two rows with blank company/role — degenerate keys must stay separate.
    { kind: 'pending', key: 'u-a', company: '', role: '', stage: 'pending', score: null, source: 'portal', url: 'https://x/a', id: null, updated: '2026-06-24' },
    { kind: 'pending', key: 'u-b', company: '', role: '', stage: 'pending', score: null, source: 'portal', url: 'https://x/b', id: null, updated: '2026-06-24' },
  ];
  const out = collapseDuplicates(rows);
  const fm = out.find((r) => r.company === 'forcemetrics');
  assert.equal(fm.stage, 'review-hi', 'the highest-scoring/most-advanced queue row is primary');
  assert.equal(fm.dupCount, 2);
  assert.equal(out.filter((r) => r.company === '').length, 2, 'blank-identity rows are never merged');
});
