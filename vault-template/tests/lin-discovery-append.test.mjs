import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
