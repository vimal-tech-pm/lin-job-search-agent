import test from 'node:test';
import assert from 'node:assert/strict';
import { geoGate } from '../scripts/lib/geo-gate.mjs';

// This is the SHARED block decision used by both the pipeline (lin-promote-evaluations.mjs
// promotionBlock) and the dashboard (tracker-data buildRows). Lock the contract here so the
// two consumers can't drift.

test('geoGate: geo_gate.blocks_stage wins, reason carried through', () => {
  const g = geoGate({ geo_gate: { blocks_stage: true, reason: 'remote-only' }, canada_eligible: 'no' });
  assert.equal(g.blocked, true);
  assert.equal(g.cause, 'geo');
  assert.equal(g.displayReason, 'remote-only');
});

test('geoGate: blocks_stage is matched as strict boolean true', () => {
  assert.equal(geoGate({ geo_gate: { blocks_stage: true } }).cause, 'geo');
  // a stray non-boolean must NOT block via the gate (no truthiness trap)
  for (const v of ['true', 'false', '0', 1, 0, null]) {
    const g = geoGate({ geo_gate: { blocks_stage: v } });
    assert.equal(g.cause, null, `blocks_stage=${JSON.stringify(v)} must not block via the geo gate`);
    assert.equal(g.blocked, false);
  }
});

test('geoGate: null geo reason falls back to canada_eligible_reason, then literal', () => {
  const rich = geoGate({ geo_gate: { blocks_stage: true, reason: null }, canada_eligible_reason: 'Onsite — Mountain View, CA' });
  assert.equal(rich.cause, 'geo');
  assert.equal(rich.displayReason, 'Onsite — Mountain View, CA');

  const bare = geoGate({ geo_gate: { blocks_stage: true, reason: null } });
  assert.equal(bare.displayReason, 'location-blocked');
});

test('geoGate: canada_eligible=no blocks (case-insensitive) when no gate', () => {
  for (const v of ['no', 'No', 'NO']) {
    const g = geoGate({ canada_eligible: v });
    assert.equal(g.blocked, true, `canada_eligible=${v} should block`);
    assert.equal(g.cause, 'canada');
  }
  assert.equal(geoGate({ canada_eligible: 'no', canada_eligible_reason: 'US citizens only' }).displayReason, 'US citizens only');
  assert.equal(geoGate({ canada_eligible: 'no' }).displayReason, 'not Canada-eligible');
});

test('geoGate: unblocked rows', () => {
  assert.deepEqual(geoGate({ canada_eligible: 'yes', geo_gate: { blocks_stage: false, reason: '' } }), { blocked: false, cause: null, displayReason: '' });
  assert.equal(geoGate({ canada_eligible: 'unknown' }).blocked, false);
  assert.equal(geoGate({}).blocked, false);
  assert.equal(geoGate(undefined).blocked, false);
});
