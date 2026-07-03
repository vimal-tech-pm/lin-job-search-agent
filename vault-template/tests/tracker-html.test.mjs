import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-html-'));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.mkdirSync(path.join(v, 'companies'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile', 'pipeline-config.json'), JSON.stringify({ promote_threshold: 3.95 }));
  fs.writeFileSync(path.join(v, 'career-profile', 'profile.yml'), 'candidate:\n  full_name: Jane Doe\n');
  return v;
}

function baseRow(overrides = {}) {
  return {
    kind: 'queue',
    key: '#401',
    id: '401',
    coSlug: 'nesto',
    jobSlug: 'senior-technical-product-manager',
    company: 'nesto',
    role: 'Senior Technical Product Manager',
    stage: 'review-hi',
    score: 4.1,
    verdict: 'Investable',
    canada: 'yes',
    canadaReason: 'Canada eligible',
    source: 'portal',
    updated: '2026-06-12',
    links: {},
    history: [],
    liveness: null,
    buildRequestedAt: null,
    emailStatus: null,
    atsWinner: null,
    pay: { tier: 'mid', label: '120–160', num: 140000 },
    recency: { bucket: 'd7', label: 'posted 3d', source: 'posted', days: 3 },
    actions: ['prepare', 'wont'],
    statusDetail: '',
    ...overrides,
  };
}

test('renderHtml: liveness-stuck build request shows Retry Prepare and no run-now', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({
      buildRequestedAt: '2026-06-12T14:00:00Z',
      liveness: 'LinkedIn JD visible but no Apply/Easy Apply button; BuiltIn says removed May 22',
    })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /Retry Prepare/);
  assert.match(row, /stuck: no apply path/i);
  assert.doesNotMatch(row, /requested ✓/);
  assert.doesNotMatch(row, /⚡ now/);
  assert.match(row, /LinkedIn JD visible but no Apply\/Easy Apply button/);
});

test('renderHtml: normal build request still shows requested and run-now', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({ buildRequestedAt: '2026-06-12T14:00:00Z' })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  assert.match(html, /requested ✓/);
  assert.match(html, /⚡ now/);
  assert.doesNotMatch(html, /Retry Prepare/);
  assert.doesNotMatch(html, /stuck: no apply path/i);
});

test('renderHtml: geo-blocked row renders a caution Prepare with override metadata', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({ canada: 'no', geoBlocked: true, geoReason: 'remote-only' })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /data-geo-blocked="1"/);        // row + button carry the flag for the JS confirm
  assert.match(row, /data-geo-reason="remote-only"/);
  assert.match(row, /⚠ Prepare/);                   // visually distinct from the plain blue Prepare
  assert.match(row, /class="btn geo"/);             // caution styling, not pri/warn
  assert.doesNotMatch(row, /class="btn pri" data-act="prepare"/);
});

test('renderHtml: non-blocked row has a plain Prepare and no geo metadata', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow()],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /class="btn pri" data-act="prepare">Prepare</);
  assert.doesNotMatch(row, /data-geo-blocked/);
  assert.doesNotMatch(row, /⚠ Prepare/);
});

test('renderHtml: an already-requested geo-blocked row stops nagging (requested + run-now, no caution button)', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({ canada: 'no', geoBlocked: true, geoReason: 'remote-only', buildRequestedAt: '2026-06-12T14:00:00Z' })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /requested ✓/);
  assert.match(row, /⚡ now/);
  assert.doesNotMatch(row, /⚠ Prepare/);
});

test('renderHtml: a generated cover shows ✓ Cover generated (not the Generate button)', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({ kind: 'job', stage: 'ready', coSlug: 'acme', jobSlug: 'pm', actions: ['apply', 'wont'], coverWinner: 'forge', links: { cover: '../companies/acme/jobs/pm/covers/forge.pdf' } })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  assert.match(html, /✓ Cover generated \(forge\)/);
  assert.match(html, /covers\/forge\.pdf/);            // link to the PDF
  assert.doesNotMatch(html, /✍ Generate cover/);       // the action collapses once generated
});

test('renderHtml: a cover-required ready row nudges with a "cover requested" hint', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({ kind: 'job', stage: 'ready', coSlug: 'acme', jobSlug: 'pm', actions: ['apply', 'wont'], coverRequired: true, coverWinner: null })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  assert.match(html, /✍ Generate cover/);
  assert.match(html, /cover requested/);
});

test('renderHtml: a terminal outcome shows its own bucket label + a funnel-depth chip', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const html = htmlMod.renderHtml({
    rows: [baseRow({ kind: 'job', stage: 'rejected', coSlug: 'acme', jobSlug: 'pm', actions: [], furthestStage: 'final', depthLabel: 'after final round', outcome: 'rejected' })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });
  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /stage-rejected/);            // distinct bucket, not lumped into "closed"
  assert.match(row, /chip stage-rejected">rejected</); // human label (lowercase, matching the other chips)
  assert.match(row, /after final round/);         // the depth chip you asked for
});

test('renderHtml: the rail exposes the split outcome buckets', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());
  const html = htmlMod.renderHtml({ rows: [baseRow()], wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] }, generatedAt: 'test' });
  for (const s of ['rejected', 'withdrew', 'declined', 'expired']) {
    assert.match(html, new RegExp(`data-stage="${s}"`), `rail missing ${s} bucket`);
  }
});

test('renderHtml: a post-apply row gets a manual outcome+depth editor in its details', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());
  const html = htmlMod.renderHtml({
    rows: [baseRow({ kind: 'job', stage: 'applied', coSlug: 'acme', jobSlug: 'pm', actions: ['wont-rejected'], furthestStage: 'applied', depthLabel: 'after applying' })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });
  assert.match(html, /data-act="set-outcome"/);   // Save button
  assert.match(html, /data-field="outcome"/);      // outcome selector
  assert.match(html, /data-field="stage"/);        // depth selector
  assert.match(html, /<option value="final"/);     // depth options present
});

test('renderHtml: a pre-apply review row does NOT get the outcome editor', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());
  const html = htmlMod.renderHtml({
    rows: [baseRow({ kind: 'queue', stage: 'review-hi', furthestStage: 'none', depthLabel: '' })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });
  assert.doesNotMatch(html, /data-act="set-outcome"/);
});

test('renderHtml: Pay and Recency render as sortable columns with chips + numeric sort keys', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());
  const html = htmlMod.renderHtml({
    rows: [baseRow({ pay: { tier: 'top', label: '200k+', num: 215000 }, recency: { bucket: 'd1', label: 'posted today', source: 'posted', days: 0 } })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });
  // sortable headers
  assert.match(html, /data-col="pay"/);
  assert.match(html, /data-col="recency"/);
  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /200k\+/);                       // pay chip label
  assert.match(row, /pay-top/);                      // tier class for color
  assert.match(row, /data-pay-num="215000"/);        // numeric sort key
  assert.match(row, /posted today/);                 // recency chip label
  assert.match(row, /rec-d1/);                       // freshness class
  assert.match(row, /data-recency-days="0"/);        // numeric sort key
  // the expand row must span every column
  assert.match(html, /<td colspan="10">/);
});

test('renderHtml: unknown pay/recency degrade to a quiet — (never invents data)', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());
  const html = htmlMod.renderHtml({
    rows: [baseRow({ pay: { tier: 'unknown', label: '—', num: -1 }, recency: { bucket: 'none', label: '—', source: null, days: -1 } })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });
  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(row, /data-pay-num="-1"/);            // unknown sorts last
  assert.match(row, /data-recency-days="-1"/);
});

test('renderHtml: a malicious geoReason is escaped in both the title and the data attribute', async () => {
  const data = await import('../scripts/lib/tracker-data.mjs');
  const htmlMod = await import('../scripts/lib/tracker-html.mjs');
  data.init(makeVault());

  const evil = '"><script>alert(1)</script>';
  const html = htmlMod.renderHtml({
    rows: [baseRow({ canada: 'no', geoBlocked: true, geoReason: evil })],
    wr: { total: 0, tally: { pathfinder: 0, forge: 0 }, recent: [] },
    generatedAt: 'test',
  });

  const row = html.match(/<tr class="r"[^>]*data-id="401"[\s\S]*?<\/tr>/)?.[0] || '';
  assert.doesNotMatch(row, /<script>alert/);           // no raw breakout into markup
  assert.match(row, /&lt;script&gt;/);                 // angle brackets escaped
  assert.match(row, /data-geo-reason="&quot;&gt;&lt;script&gt;/); // quote escaped inside the attr
});
