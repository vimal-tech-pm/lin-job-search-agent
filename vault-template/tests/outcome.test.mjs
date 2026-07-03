import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES,
  OUTCOMES,
  stageRank,
  advanceStage,
  isFinalRound,
  emailSignals,
  foldEmailSignal,
  applyManual,
  normalizeState,
  parseLegacy,
} from '../scripts/lib/outcome.mjs';

test('the stage ladder is ordered low→high with none at the bottom', () => {
  assert.deepEqual(STAGES, ['none', 'applied', 'interviewing', 'final', 'offer']);
  assert.ok(stageRank('offer') > stageRank('final'));
  assert.ok(stageRank('final') > stageRank('interviewing'));
  assert.ok(stageRank('interviewing') > stageRank('applied'));
  assert.equal(stageRank('garbage'), stageRank('none')); // unknown floors to none
});

test('advanceStage is monotonic — it never regresses', () => {
  assert.equal(advanceStage('interviewing', 'applied'), 'interviewing'); // lower signal ignored
  assert.equal(advanceStage('applied', 'final'), 'final');               // higher signal wins
  assert.equal(advanceStage('none', 'offer'), 'offer');
  assert.equal(advanceStage('final', 'garbage'), 'final');               // unknown can't lower it
});

test('isFinalRound recognizes final/onsite/panel language but not a generic interview', () => {
  assert.ok(isFinalRound('We would like to invite you to the final round'));
  assert.ok(isFinalRound('Please join us for an onsite panel interview'));
  assert.equal(isFinalRound('We would like to schedule a phone screen'), false);
});

test('emailSignals maps each email class to stage + outcome signals', () => {
  assert.deepEqual(emailSignals('acknowledgement', 'application received'), { stage: 'applied', outcome: null });
  assert.deepEqual(emailSignals('interview', 'schedule a phone screen'), { stage: 'interviewing', outcome: null });
  assert.deepEqual(emailSignals('interview', 'invite to the final round panel'), { stage: 'final', outcome: null });
  assert.deepEqual(emailSignals('offer', 'pleased to offer'), { stage: 'offer', outcome: 'offer' });
  assert.deepEqual(emailSignals('rejection', 'unfortunately'), { stage: null, outcome: 'rejected' });
  assert.deepEqual(emailSignals('other', 'newsletter'), { stage: null, outcome: null });
});

test('a rejection after a final round freezes the high-water mark', () => {
  let s = normalizeState({});
  s = foldEmailSignal(s, emailSignals('acknowledgement', 'received'));
  s = foldEmailSignal(s, emailSignals('interview', 'final round onsite'));
  s = foldEmailSignal(s, emailSignals('rejection', 'not moving forward'));
  assert.equal(s.outcome, 'rejected');
  assert.equal(s.furthest_stage, 'final');          // depth preserved, not collapsed
  assert.equal(s.outcome_source, 'email');
  assert.equal(s.furthest_stage_source, 'email');
});

test('a manual furthest_stage is sticky — a later email cannot clobber or lower it', () => {
  let s = applyManual(normalizeState({}), { stage: 'final' });
  assert.equal(s.furthest_stage_source, 'manual');
  s = foldEmailSignal(s, emailSignals('interview', 'phone screen')); // would set interviewing
  assert.equal(s.furthest_stage, 'final');          // manual value untouched
  assert.equal(s.furthest_stage_source, 'manual');
});

test('a manual outcome survives a later contradicting email', () => {
  let s = applyManual(normalizeState({}), { outcome: 'declined' });
  s = foldEmailSignal(s, emailSignals('rejection', 'unfortunately'));
  assert.equal(s.outcome, 'declined');
  assert.equal(s.outcome_source, 'manual');
});

test('applyManual can correct a stage downward (it is a correction, not an advance)', () => {
  let s = foldEmailSignal(normalizeState({}), emailSignals('offer', 'offer letter'));
  assert.equal(s.furthest_stage, 'offer');
  s = applyManual(s, { stage: 'interviewing' });    // user fixes an over-eager inference
  assert.equal(s.furthest_stage, 'interviewing');
  assert.equal(s.furthest_stage_source, 'manual');
});

test('parseLegacy maps a rejected: status_detail to rejected at >= applied depth', () => {
  const out = parseLegacy({ status: 'closed', status_detail: 'rejected: thanks but no (2026-06-01)', last_email_status: 'rejection: ...' });
  assert.equal(out.outcome, 'rejected');
  assert.ok(stageRank(out.furthest_stage) >= stageRank('applied'));
  assert.equal(out.outcome_source, 'email');
});

test('parseLegacy lifts depth from last_email_status (interview/offer)', () => {
  assert.equal(parseLegacy({ status: 'closed', status_detail: 'rejected: x', last_email_status: 'interview: onsite final round' }).furthest_stage, 'final');
  assert.equal(parseLegacy({ status: 'offer', status_detail: '', last_email_status: 'offer: letter' }).outcome, 'offer');
});

test('parseLegacy is conservative: a pre-apply "won’t apply" stays an outcome-less wont row', () => {
  const out = parseLegacy({ status: 'closed', status_detail: 'won’t_apply: not interested', last_email_status: 'silent' });
  assert.equal(out.outcome, null);                  // never fabricate a withdraw
  assert.equal(out.furthest_stage, 'none');
});

test('parseLegacy maps duplicate/error housekeeping to same-named outcomes at stage none', () => {
  assert.deepEqual(parseLegacy({ status: 'duplicate', status_detail: '' }), { outcome: 'duplicate', furthest_stage: 'none', outcome_source: 'email', furthest_stage_source: null });
  assert.equal(parseLegacy({ status: 'error', status_detail: '' }).outcome, 'error');
});

test('OUTCOMES is the closed enum the rest of the system validates against', () => {
  assert.deepEqual(OUTCOMES, ['rejected', 'withdrew', 'declined', 'offer', 'accepted', 'expired', 'duplicate', 'error']);
});
