/**
 * lib/outcome.mjs — single source of truth for the Lin outcome funnel.
 *
 * Two orthogonal facts describe how a pursued application ended:
 *   - `furthest_stage`: a MONOTONIC high-water mark — how far you got.
 *   - `outcome`: the terminal disposition — what ended it.
 * Each carries a `*_source` of `email | manual`; a manual value is sticky and the
 * email scanner must never clobber it. See plans/outcome-funnel/2026-06-14-design.md.
 */

// Stage ladder, low → high. `none` = closed before applying.
export const STAGES = ['none', 'applied', 'interviewing', 'final', 'offer'];

// Closed outcome enum. `duplicate`/`error` are housekeeping, not "real" outcomes.
export const OUTCOMES = ['rejected', 'withdrew', 'declined', 'offer', 'accepted', 'expired', 'duplicate', 'error'];

export function stageRank(stage) {
  const i = STAGES.indexOf(stage);
  return i === -1 ? 0 : i; // unknown floors to `none`
}

export function normalizeStage(stage) {
  return STAGES.includes(stage) ? stage : 'none';
}

export function normalizeOutcome(outcome) {
  const v = String(outcome ?? '').toLowerCase();
  return OUTCOMES.includes(v) ? v : null;
}

// Human depth label for a furthest_stage — used by the dashboard chips and the
// funnel digest (e.g. rejected `after final round`).
export function stageDepthLabel(stage) {
  return {
    none: '',
    applied: 'after applying',
    interviewing: 'after interviews',
    final: 'after final round',
    offer: 'after offer',
  }[normalizeStage(stage)] || '';
}

// Terminal outcomes map to these dashboard rail buckets. Live (no outcome) rows
// fall back to their forward status elsewhere.
export const OUTCOME_BUCKET = {
  rejected: 'rejected',
  withdrew: 'withdrew',
  declined: 'declined',
  expired: 'expired',
  offer: 'offer',
  accepted: 'offer',
  duplicate: 'closed',
  error: 'closed',
};

// Monotonic: returns the higher-ranked of current vs. signal. Never regresses.
export function advanceStage(current, signal) {
  return stageRank(signal) > stageRank(current) ? normalizeStage(signal) : normalizeStage(current);
}

// Final-round / onsite / panel language — beats a generic interview signal.
export function isFinalRound(text) {
  return /final round|final interview|final stage|on-?site|panel interview|last round|last interview/.test(
    String(text ?? '').toLowerCase(),
  );
}

// Map a classified email (the class strings lin-gmail-status already emits) plus
// its text into { stage, outcome } signals. Either may be null.
export function emailSignals(emailClass, text = '') {
  switch (emailClass) {
    case 'acknowledgement': return { stage: 'applied', outcome: null };
    case 'interview':       return { stage: isFinalRound(text) ? 'final' : 'interviewing', outcome: null };
    case 'offer':           return { stage: 'offer', outcome: 'offer' };
    case 'rejection':       return { stage: null, outcome: 'rejected' };
    default:                return { stage: null, outcome: null };
  }
}

// Coerce a raw/partial state object into the canonical four-field shape.
export function normalizeState(state) {
  const s = state || {};
  const outcome = normalizeOutcome(s.outcome);
  const furthest_stage = normalizeStage(s.furthest_stage);
  const src = (v, present) => (v === 'manual' ? 'manual' : v === 'email' ? 'email' : present ? 'email' : null);
  return {
    outcome,
    furthest_stage,
    outcome_source: src(s.outcome_source, !!outcome),
    furthest_stage_source: src(s.furthest_stage_source, furthest_stage !== 'none'),
  };
}

// Fold one email-derived signal into state. Email advances the stage (monotonic)
// and sets the outcome, but NEVER overwrites a field whose source is `manual`.
export function foldEmailSignal(state, signals) {
  const s = normalizeState(state);
  const next = { ...s };
  if (signals?.stage && s.furthest_stage_source !== 'manual') {
    const adv = advanceStage(s.furthest_stage, signals.stage);
    if (adv !== s.furthest_stage) {
      next.furthest_stage = adv;
      next.furthest_stage_source = 'email';
    }
  }
  if (signals?.outcome && s.outcome_source !== 'manual') {
    next.outcome = normalizeOutcome(signals.outcome);
    next.outcome_source = 'email';
  }
  return next;
}

// Map an outcome state back to the legacy forward `status` (kept in sync until the
// tracker fully relies on outcome/furthest_stage). Returns null for ack-only.
export function deriveStatus(state) {
  const s = normalizeState(state);
  if (s.outcome === 'rejected') return 'closed';
  if (s.outcome === 'expired' || s.outcome === 'duplicate' || s.outcome === 'error') return 'closed';
  if (s.outcome === 'offer' || s.outcome === 'accepted' || s.furthest_stage === 'offer') return 'offer';
  if (stageRank(s.furthest_stage) >= stageRank('interviewing')) return 'interviewing';
  return null;
}

// Apply an explicit user action. Marks the touched field `manual` (sticky). Unlike
// email, a manual stage may move DOWN — it is a correction, not an advance.
export function applyManual(state, { outcome, stage } = {}) {
  const next = { ...normalizeState(state) };
  if (outcome !== undefined && outcome !== null) {
    next.outcome = normalizeOutcome(outcome);
    next.outcome_source = 'manual';
  }
  if (stage !== undefined && stage !== null) {
    next.furthest_stage = normalizeStage(stage);
    next.furthest_stage_source = 'manual';
  }
  return next;
}

// Best-effort backfill from a legacy job.yml. Heuristic and deliberately
// CONSERVATIVE — it never fabricates a `withdrew` from a pre-apply "won't apply".
export function parseLegacy({ status, status_detail, last_email_status } = {}) {
  const st = String(status ?? '').toLowerCase();
  const detail = String(status_detail ?? '').toLowerCase();
  const last = String(last_email_status ?? '').toLowerCase();

  // ---- furthest stage (high-water mark) ----
  let stage = 'none';
  if (st === 'applied') stage = advanceStage(stage, 'applied');
  if (st === 'interviewing' || /interview/.test(last)) stage = advanceStage(stage, 'interviewing');
  if (isFinalRound(last)) stage = advanceStage(stage, 'final');
  if (st === 'offer' || /offer/.test(last)) stage = advanceStage(stage, 'offer');
  const wasRejected = /rejected/.test(detail) || /rejection/.test(last);
  if (wasRejected) stage = advanceStage(stage, 'applied'); // a rejection implies you applied

  // ---- outcome ----
  let outcome = null;
  if (wasRejected) outcome = 'rejected';
  else if (st === 'offer') outcome = 'offer';
  else if (st === 'duplicate') outcome = 'duplicate';
  else if (st === 'error') outcome = 'error';
  else if (st === 'closed' && /expired|no longer|filled|removed|position closed/.test(detail)) outcome = 'expired';
  // pre-apply "won't apply" intentionally left as null (stays a `wont` row).

  return {
    outcome,
    furthest_stage: stage,
    outcome_source: outcome ? 'email' : null,
    furthest_stage_source: stage !== 'none' ? 'email' : null,
  };
}
