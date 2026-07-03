import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalKey, canonicalizeUrl, hasCanonicalIdentity, isLocationOnly, strictTitleKey,
} from '../scripts/lib/canonical.mjs';

test('hasCanonicalIdentity requires both company and role', () => {
  assert.equal(hasCanonicalIdentity('instacart::senior-pm'), true);
  assert.equal(hasCanonicalIdentity('::pm'), false);
  assert.equal(hasCanonicalIdentity('acme::'), false);
  assert.equal(hasCanonicalIdentity('::'), false);
  // placeholder manual add → role side empties out under normalizeTitle/slugify
  assert.equal(hasCanonicalIdentity(canonicalKey('(manual add)', '(unscored — added by URL)')), false);
});

test('isLocationOnly: work-arrangement/geo only vs meaningful qualifiers', () => {
  for (const s of ['Remote', 'Remote - Canada', 'San Francisco, CA', 'Toronto', 'Hybrid', '', 'US/Canada'])
    assert.equal(isLocationOnly(s), true, `${s} should be location-only`);
  for (const s of ['AI Builder', 'Practice Nexus', 'Growth', 'Payments', 'Marketplace', 'Duplicate'])
    assert.equal(isLocationOnly(s), false, `${s} should be meaningful`);
  // words that read as location in a phrase but are meaningful qualifiers alone
  // (GLM review round 2) must NOT be treated as location-only on the destructive path
  for (const s of ['Global', 'Office', 'First', 'Time'])
    assert.equal(isLocationOnly(s), false, `${s} alone should be meaningful`);
});

test('strictTitleKey keeps meaningful parentheticals, drops location ones', () => {
  // location-only difference → same key (safe to merge destructively)
  assert.equal(strictTitleKey('Senior PM, Platform (Remote)'), strictTitleKey('Senior PM, Platform'));
  assert.equal(strictTitleKey('Staff PM (AI Builder) (Remote US/Canada)'), strictTitleKey('Staff PM (AI Builder)'));
  // meaningful difference → different key (must NOT merge destructively)
  assert.notEqual(strictTitleKey('Product Manager (Growth)'), strictTitleKey('Product Manager (Payments)'));
  assert.notEqual(strictTitleKey('Senior Technical PM (Practice Nexus)'), strictTitleKey('Senior Technical PM'));
  // sanity: the LOOSE canonicalKey WOULD have merged the meaningful pair (this is the bug we guard)
  assert.equal(canonicalKey('x', 'Product Manager (Growth)'), canonicalKey('x', 'Product Manager (Payments)'));
});

test('canonicalizeUrl still id-stable (unchanged contract)', () => {
  assert.equal(canonicalizeUrl('https://job-boards.greenhouse.io/instacart/jobs/8014060'),
    'boards.greenhouse.io/instacart/jobs/8014060');
  assert.equal(canonicalizeUrl('https://ca.linkedin.com/jobs/view/123/?x=1'), 'linkedin.com/jobs/view/123');
});
