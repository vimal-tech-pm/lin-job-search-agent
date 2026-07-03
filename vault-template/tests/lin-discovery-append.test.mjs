import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  SCAN_HISTORY_HEADER,
  canonicalizeUrl,
  parsePendingRow,
  parseProcessedRow,
  parseScanHistory,
  parsePipelineRows,
  processCandidates,
} from '../scripts/lin-discovery-append.mjs';

const script = path.resolve('scripts/lin-discovery-append.mjs');

test('legacy scan-history rows default to portal and preserve URL canonicalization', () => {
  const rows = parseScanHistory('date\tcompany\ttitle\turl\n2026-06-01\tAcme\tSenior Product Manager\thttps://boards.greenhouse.io/acme/jobs/123?utm=x\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'portal');
  assert.equal(rows[0].status, 'added');
  assert.equal(rows[0].canonical_url, 'boards.greenhouse.io/acme/jobs/123');
});

test('pending parser handles src metadata and URLs containing ?src=', () => {
  const row = parsePendingRow('- [ ] 2026-06-04 | Acme | Senior PM | https://example.com/job?src=LinkedIn&id=1 | src=linkedin dup_of=#123');
  assert.equal(row.source, 'linkedin');
  assert.equal(row.duplicate_of, '#123');
  assert.equal(row.url, 'https://example.com/job?src=LinkedIn&id=1');
});

test('processed parser extracts first URL despite role fields with embedded pipes', () => {
  const line = '- [x] 2026-06-04 | Acme | Senior PM | Toronto | Remote | https://boards.greenhouse.io/acme/jobs/123 → 4.4/5 PDF:❌ CANADA:y | 234';
  const row = parseProcessedRow(line);
  assert.equal(row.url, 'https://boards.greenhouse.io/acme/jobs/123');
  assert.equal(row.id, '234');
  assert.match(row.role, /Toronto \| Remote/);
});

test('processCandidates flags cross-source duplicate by canonical key but skips exact/same-source duplicates', () => {
  const pipelineRows = parsePipelineRows('- [ ] 2026-06-01 | Acme | Senior Product Manager | https://boards.greenhouse.io/acme/jobs/123\n');
  const filter = { positive: ['product manager'], negative: ['intern'], seniority_boost: [] };
  const out = processCandidates({
    source: 'linkedin',
    today: '2026-06-04',
    cap: 10,
    filter,
    pipelineRows,
    historyRows: [],
    candidates: [
      { company: 'Acme', role: 'Senior Product Manager', url: 'https://www.linkedin.com/jobs/view/999', source_item_id: '999' },
      { company: 'Acme', role: 'Senior Product Manager', url: 'https://www.linkedin.com/jobs/view/999', source_item_id: '999b' },
      { company: 'Beta', role: 'Product Manager Intern', url: 'https://www.linkedin.com/jobs/view/888', source_item_id: '888' },
    ],
  });
  assert.equal(out.stats.skipped_dup_crosssource, 1);
  assert.equal(out.stats.skipped_dup, 1);
  assert.equal(out.stats.skipped_title, 1);
  assert.equal(out.pipelineLines.length, 1);
  assert.match(out.pipelineLines[0], /src=linkedin dup_of=https:\/\/boards\.greenhouse\.io\/acme\/jobs\/123/);
  assert.equal(out.historyLines[0].split('\t').length, 9);
});

test('CLI writes 9-column history header, appends tagged pipeline row, and respects cap', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-disc-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'engines/pathfinder/data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'engines/pathfinder'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'career-profile'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data/pipeline.md'), '# Pipeline\n');
  fs.writeFileSync(path.join(tmp, 'engines/pathfinder/data/scan-history.tsv'), 'date\tcompany\ttitle\turl\n');
  fs.writeFileSync(path.join(tmp, 'engines/pathfinder/portals.yml'), 'title_filter:\n  positive:\n    - Product Manager\n  negative:\n    - Intern\n  seniority_boost:\n    - Senior\n');
  fs.writeFileSync(path.join(tmp, 'career-profile/pipeline-config.json'), JSON.stringify({ daily: { scan_linkedin_cap: 1 } }));
  const cands = path.join(tmp, 'candidates.json');
  fs.writeFileSync(cands, JSON.stringify([
    { company: 'Acme', role: 'Senior Product Manager', url: 'https://www.linkedin.com/jobs/view/111', source_item_id: '111', seen_at: '2026-06-04T12:00:00Z' },
    { company: 'Beta', role: 'Product Manager', url: 'https://www.linkedin.com/jobs/view/222', source_item_id: '222', seen_at: '2026-06-04T12:00:00Z' },
  ]));

  const stdout = execFileSync('node', [script, '--source', 'linkedin', '--file', cands, '--vault', tmp], { encoding: 'utf8' });
  assert.match(stdout, /linkedin: \+1 new/);
  assert.match(stdout, /1 dropped \(cap 1\)/);

  const pipe = fs.readFileSync(path.join(tmp, 'data/pipeline.md'), 'utf8');
  assert.match(pipe, /\| src=linkedin/);
  const hist = fs.readFileSync(path.join(tmp, 'engines/pathfinder/data/scan-history.tsv'), 'utf8').trim().split('\n');
  assert.equal(hist[0], SCAN_HISTORY_HEADER);
  assert.deepEqual(hist[1].split('\t').slice(0, 4), ['2026-06-04', 'Acme', 'Senior Product Manager', 'https://www.linkedin.com/jobs/view/111']);
  assert.equal(hist[1].split('\t').length, 9);
});

test('source-specific canonical URLs normalize LinkedIn and Indeed ids', () => {
  assert.equal(canonicalizeUrl('https://www.linkedin.com/jobs/view/123456/?trk=foo'), 'linkedin.com/jobs/view/123456');
  assert.equal(canonicalizeUrl('https://ca.indeed.com/viewjob?jk=abc123&from=serp'), 'indeed.com/viewjob?jk=abc123');
});

test('append sanitizes pipeline fields and skipped-title history does not block later valid rows', () => {
  const filter = { positive: ['product manager'], negative: ['intern'], seniority_boost: [] };
  const out = processCandidates({
    source: 'linkedin',
    today: '2026-06-04',
    cap: 10,
    filter,
    pipelineRows: [],
    historyRows: [],
    candidates: [
      { company: 'Acme | Bad\nCo', role: 'Product Manager Intern', url: 'https://example.com/jobs/1', source_item_id: 'bad' },
      { company: 'Acme | Good\nCo', role: 'Senior Product Manager | Toronto\nRemote', url: 'https://example.com/jobs/1', source_item_id: 'good' },
    ],
  });
  assert.equal(out.stats.skipped_title, 1);
  assert.equal(out.stats.added, 1);
  assert.equal(out.pipelineLines.length, 1);
  assert.match(out.pipelineLines[0], /Acme \/ Good Co \| Senior Product Manager \/ Toronto Remote/);
  assert.doesNotMatch(out.pipelineLines[0], /\n/);
  assert.doesNotMatch(out.pipelineLines[0], /Acme \| Good/);
});

test('a posted_date on a candidate round-trips as posted= metadata and parses back', () => {
  const out = processCandidates({
    source: 'linkedin',
    today: '2026-06-14',
    cap: 10,
    filter: { positive: ['product manager'], negative: [], seniority_boost: [] },
    pipelineRows: [],
    historyRows: [],
    candidates: [{ company: 'Acme', role: 'Senior Product Manager', url: 'https://www.linkedin.com/jobs/view/771', posted_date: '2026-06-12T00:00:00Z' }],
  });
  assert.match(out.pipelineLines[0], /posted=2026-06-12/);
  const parsed = parsePendingRow(out.pipelineLines[0]);
  assert.equal(parsed.posted_date, '2026-06-12');
  assert.equal(parsed.source, 'linkedin'); // existing metadata still parses
});

test('a candidate without a posted_date emits no posted= token', () => {
  const out = processCandidates({
    source: 'linkedin', today: '2026-06-14', cap: 10,
    filter: { positive: ['product manager'], negative: [], seniority_boost: [] },
    pipelineRows: [], historyRows: [],
    candidates: [{ company: 'Acme', role: 'Senior Product Manager', url: 'https://www.linkedin.com/jobs/view/772' }],
  });
  assert.doesNotMatch(out.pipelineLines[0], /posted=/);
  assert.equal(parsePendingRow(out.pipelineLines[0]).posted_date, null);
});

// ---------- re-architecture (2026-06): manual source ----------

test('manual is a valid discovery source and flows through processCandidates', async () => {
  const m = await import('../scripts/lin-discovery-append.mjs');
  assert.ok(m.SOURCES.has('manual'));
  const out = processCandidates({
    source: 'manual',
    today: '2026-06-10',
    cap: 10,
    filter: { positive: [], negative: [], seniority_boost: [] },
    pipelineRows: [],
    historyRows: [],
    candidates: [{ company: 'Hand Added Co', role: 'Senior Product Manager', url: 'https://example.com/jobs/manual-1' }],
  });
  assert.equal(out.stats.added, 1);
  assert.match(out.pipelineLines[0], /src=manual/);
});

// ---------- URL-only manual adds (dashboard "Add by URL" button) ----------

// The dashboard Add box sends a bare URL — no company/role. A restrictive
// title_filter must NOT cull it: a manual add is an explicit user decision,
// and the scorer re-derives the real company/role from the JD later.
test('URL-only manual add bypasses the title filter and creates a pending row', () => {
  const filter = { positive: ['product manager'], negative: ['intern'], seniority_boost: [] };
  const out = processCandidates({
    source: 'manual',
    today: '2026-06-14',
    cap: 10,
    filter,
    pipelineRows: [],
    historyRows: [],
    candidates: [{ url: 'https://job-boards.greenhouse.io/novoed/jobs/7714203' }],
  });
  assert.equal(out.stats.skipped_title, 0, 'must not be filtered');
  assert.equal(out.stats.added, 1);
  assert.match(out.pipelineLines[0], /src=manual/);
  assert.match(out.pipelineLines[0], /novoed\/jobs\/7714203/);
});

// Two different URL-only adds share the empty placeholder canonical-key; they
// must NOT false-dedupe against each other (only URL identity should dedupe).
test('two distinct URL-only manual adds both append (no placeholder-key collision)', () => {
  const filter = { positive: ['product manager'], negative: [], seniority_boost: [] };
  const out = processCandidates({
    source: 'manual',
    today: '2026-06-14',
    cap: 10,
    filter,
    pipelineRows: [],
    historyRows: [],
    candidates: [
      { url: 'https://job-boards.greenhouse.io/novoed/jobs/7714203' },
      { url: 'https://boards.greenhouse.io/acme/jobs/55' },
    ],
  });
  assert.equal(out.stats.added, 2);
  assert.equal(out.stats.skipped_dup, 0);
});

// The same URL added twice in one batch is still a genuine duplicate.
test('a repeated URL-only manual add is de-duplicated by URL', () => {
  const out = processCandidates({
    source: 'manual',
    today: '2026-06-14',
    cap: 10,
    filter: { positive: [], negative: [], seniority_boost: [] },
    pipelineRows: [],
    historyRows: [],
    candidates: [
      { url: 'https://job-boards.greenhouse.io/novoed/jobs/7714203' },
      { url: 'https://job-boards.greenhouse.io/novoed/jobs/7714203' },
    ],
  });
  assert.equal(out.stats.added, 1);
  assert.equal(out.stats.skipped_dup, 1);
});

// A URL-only add shows a readable company hint (greenhouse/lever/ashby org
// slug) in Pending instead of a bare "?" until scoring fills in the real name.
test('URL-only manual add derives a company hint from the ATS org slug', () => {
  const out = processCandidates({
    source: 'manual',
    today: '2026-06-14',
    cap: 10,
    filter: { positive: [], negative: [], seniority_boost: [] },
    pipelineRows: [],
    historyRows: [],
    candidates: [{ url: 'https://job-boards.greenhouse.io/novoed/jobs/7714203' }],
  });
  assert.match(out.pipelineLines[0], /\| novoed \|/);
});

// The CLI's --json flag emits machine-readable stats on stdout (consumed by
// lin-serve's hAddJobs) while the human digest goes to stderr, so cron callers
// that scrape the digest from stdout are unaffected.
test('CLI --json emits parseable stats on stdout and the human digest on stderr', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-disc-json-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'engines/pathfinder/data'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data/pipeline.md'), '# Pipeline\n');
  fs.writeFileSync(path.join(tmp, 'career-profile-stub'), '');
  fs.mkdirSync(path.join(tmp, 'career-profile'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'career-profile/pipeline-config.json'), JSON.stringify({ daily: { scan_manual_cap: 25 } }));
  const cands = path.join(tmp, 'candidates.json');
  fs.writeFileSync(cands, JSON.stringify([{ url: 'https://job-boards.greenhouse.io/novoed/jobs/7714203' }]));

  const res = spawnSync('node', [script, '--source', 'manual', '--file', cands, '--vault', tmp, '--json'], { encoding: 'utf8' });
  const lastLine = res.stdout.trim().split('\n').pop();
  const stats = JSON.parse(lastLine);
  assert.equal(stats.added, 1);
  assert.equal(stats.duplicates, 0);
  assert.equal(stats.filtered, 0);
  assert.match(res.stderr, /manual: \+1 new/);
});

test('processCandidates suppresses re-discovery of a role already tracked by an ACTIVE folder', () => {
  const filter = { positive: [], negative: [], seniority_boost: [] };
  const folderRows = [
    { url: 'https://job-boards.greenhouse.io/instacart/jobs/8014060', canonical_url: 'boards.greenhouse.io/instacart/jobs/8014060', canonical_key: 'instacart::senior-product-manager-retailer-platform', source: 'portal', active: true },
  ];
  const out = processCandidates({
    source: 'portal', today: '2026-06-24', cap: 10, filter,
    pipelineRows: [], historyRows: [], folderRows,
    candidates: [
      // same role, DIFFERENT greenhouse id → must be suppressed (already pursued)
      { company: 'instacart', role: 'Senior Product Manager, Retailer Platform', url: 'https://job-boards.greenhouse.io/instacart/jobs/8014062', source_item_id: '8014062' },
    ],
  });
  assert.equal(out.pipelineLines.length, 0, 'no pending row appended for an actively-tracked role');
  assert.equal(out.stats.skipped_dup, 1);
});

test('processCandidates still admits a repost when the matching folder is CLOSED/archived', () => {
  const filter = { positive: [], negative: [], seniority_boost: [] };
  const folderRows = [
    { url: 'https://x/old', canonical_url: 'x/old', canonical_key: 'acme::senior-product-manager', source: 'linkedin', active: false },
  ];
  const out = processCandidates({
    source: 'portal', today: '2026-06-24', cap: 10, filter,
    pipelineRows: [], historyRows: [], folderRows,
    candidates: [
      { company: 'Acme', role: 'Senior Product Manager', url: 'https://acme.com/careers/spm', source_item_id: 'spm' },
    ],
  });
  assert.equal(out.pipelineLines.length, 1, 'a genuine repost of a dead role can still resurface');
});
