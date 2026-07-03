import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPostedDate } from '../scripts/lin-backfill-posted.mjs';

const CAP = '2026-06-03'; // when the snapshot was captured (≈ discovered_at), anchors relative phrases

test('clean absolute "Date Posted: <ISO>" is taken verbatim', () => {
  assert.equal(extractPostedDate('**Date Posted:** 2026-04-22\nblah', CAP), '2026-04-22');
});

test('absolute "Posted on Month D, Year" parses to ISO', () => {
  assert.equal(extractPostedDate('Posted on Jan 9, 2026 by the team', CAP), '2026-01-09');
});

test('relative "~N days ago" anchors to the capture date', () => {
  assert.equal(extractPostedDate('| **Posted** | ~16 days ago (mid-May)', '2026-06-02'), '2026-05-17');
  assert.equal(extractPostedDate('2 weeks ago', '2026-06-06'), '2026-05-23');
  assert.equal(extractPostedDate('just posted today', '2026-06-10'), '2026-06-10');
});

test('Indeed filter chrome "Date posted Past month Past week" is NOT a date', () => {
  assert.equal(extractPostedDate('Join now Date posted Past month Past week Past 24 hours', CAP), null);
});

test('a page with conflicting relative phrases is skipped (never guess)', () => {
  assert.equal(extractPostedDate('Acme 5 days ago\nBeta 1 day ago', CAP), null);
});

test('a single relative phrase repeated is fine (not a conflict)', () => {
  assert.equal(extractPostedDate('5 days ago ... posted 5 days ago', CAP), '2026-05-29');
});

test('implausible dates (future, or >2y old) are rejected', () => {
  assert.equal(extractPostedDate('Date Posted: 2030-01-01', CAP), null); // future
  assert.equal(extractPostedDate('Date Posted: 2019-01-01', CAP), null); // ancient
});

test('bare "today" in JD marketing copy is NOT a posting date (regression)', () => {
  assert.equal(extractPostedDate('Apply today! Today, our platform serves millions.', CAP), null);
  assert.equal(extractPostedDate('customers use our API today, and tomorrow', CAP), null);
  assert.equal(extractPostedDate('featured on The Today Show', CAP), null);
});

test('"posted today" / "just posted" still count (anchored to capture)', () => {
  assert.equal(extractPostedDate('Posted today by HR', '2026-06-10'), '2026-06-10');
  assert.equal(extractPostedDate('just posted', '2026-06-10'), '2026-06-10');
});

test('no recognizable phrase → null (most snapshots)', () => {
  assert.equal(extractPostedDate('We are hiring a Senior PM to own the roadmap.', CAP), null);
});
