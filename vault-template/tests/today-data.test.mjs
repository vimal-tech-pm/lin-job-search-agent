import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveToday, followupsDue, FOLLOWUP_DAYS } from '../scripts/lib/today-data.mjs';

const NOW = new Date('2026-07-03T12:00:00Z');
const row = (o) => ({ kind: 'job', key: 'acme/pm', id: null, company: 'acme', role: 'PM',
  stage: 'applied', score: 4.3, updated: '2026-06-20', outcome: null,
  furthestStage: 'applied', depthLabel: '', geoBlocked: false, url: null, ...o });

test('followupsDue: applied, open, >=7 days old', () => {
  const due = followupsDue([
    row({}),                                            // 13 days -> due
    row({ key: 'b/pm', updated: '2026-07-01' }),        // 2 days -> not due
    row({ key: 'c/pm', outcome: 'rejected' }),          // closed -> not due
    row({ key: 'd/pm', stage: 'staged' }),              // not applied -> not due
  ], NOW);
  assert.deepEqual(due.map((r) => r.key), ['acme/pm']);
});

test('deriveToday: sections, KPIs, and diff vs prev snapshot', () => {
  const rows = [
    row({}),
    row({ key: 'ivy/pm', company: 'ivy', stage: 'interviewing', furthestStage: 'interviewing' }),
    row({ key: 'rex/pm', company: 'rex', stage: 'rejected', outcome: 'rejected', depthLabel: 'after applying' }),
    row({ key: 'top/pm', company: 'top', stage: 'staged', score: 4.6 }),
  ];
  const prev = { generated_at: '2026-07-02T12:00:00Z',
    stages: { 'acme/pm': 'applied', 'ivy/pm': 'applied', 'rex/pm': 'applied', 'top/pm': 'staged' } };
  const { viewModel, snapshot } = deriveToday({ rows, prev, now: NOW });

  assert.equal(viewModel.page, 'lin-today');
  const ids = viewModel.sections.map((s) => s.id);
  assert.deepEqual(ids, ['attention', 'followups', 'changes', 'funnel', 'topstaged']);
  // interviewing row lands in attention
  assert.match(JSON.stringify(viewModel.sections[0].rows), /ivy/);
  // changes: ivy advanced, rex newly rejected; acme unchanged is absent
  const changes = JSON.stringify(viewModel.sections[2].rows);
  assert.match(changes, /interviewing/); assert.match(changes, /rejected/);
  assert.doesNotMatch(changes, /acme/);
  // snapshot records current stages for the next diff
  assert.equal(snapshot.stages['ivy/pm'], 'interviewing');
  // KPIs present: interviewing / follow-ups / new rejections / staged
  assert.equal(viewModel.kpis.length, 4);
  assert.equal(viewModel.kpis[2].value, '1'); // rex newly rejected
});

test('deriveToday: no prev snapshot -> empty changes, no crash', () => {
  const { viewModel } = deriveToday({ rows: [row({})], prev: null, now: NOW });
  assert.equal(viewModel.sections.find((s) => s.id === 'changes').rows.length, 0);
});
