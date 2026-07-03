import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/lin-score-worklist.mjs');

function mkVault({ cap = 2, pipeline }) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-score-wl-'));
  fs.mkdirSync(path.join(v, 'career-profile'), { recursive: true });
  fs.mkdirSync(path.join(v, 'data'), { recursive: true });
  fs.writeFileSync(path.join(v, 'career-profile/pipeline-config.json'), JSON.stringify({ daily: { score_cap: cap } }));
  fs.writeFileSync(path.join(v, 'data/pipeline.md'), pipeline);
  return v;
}

function runJson(v, extra = []) {
  const res = spawnSync(process.execPath, [SCRIPT, '--vault', v, '--json', ...extra], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  return JSON.parse(res.stdout);
}

test('score worklist emits only pending rows up to daily.score_cap with compact fields', () => {
  const v = mkVault({
    cap: 2,
    pipeline: [
      '# Pipeline',
      '- [x] 2026-06-01 | DoneCo | Old Role | https://example.com/done → 3.0/5 PDF:❌ CANADA:y | 001',
      '- [ ] 2026-06-14 | Acme | Senior Product Manager | Toronto | https://example.com/job?src=foo | src=linkedin dup_of=#123 canonical_key=acme::spm posted=2026-06-12',
      '- [ ] 2026-06-15 | Beta | Staff PM | https://ca.indeed.com/viewjob?jk=abc&from=x | src=manual',
      '- [ ] 2026-06-16 | Gamma | Product Lead | https://www.linkedin.com/jobs/view/777 | src=portal',
    ].join('\n') + '\n',
  });
  const out = runJson(v);
  assert.equal(out.cap, 2);
  assert.equal(out.pending_total, 3);
  assert.equal(out.items.length, 2);
  assert.deepEqual(Object.keys(out.items[0]).sort(), [
    'canonical_key', 'company', 'date', 'duplicate_of', 'line_number', 'posted_date', 'role', 'source', 'url',
  ].sort());
  assert.equal(out.items[0].line_number, 3);
  assert.equal(out.items[0].company, 'Acme');
  assert.equal(out.items[0].role, 'Senior Product Manager | Toronto');
  assert.equal(out.items[0].source, 'linkedin');
  assert.equal(out.items[0].duplicate_of, '#123');
  assert.equal(out.items[0].posted_date, '2026-06-12');
  assert.equal(out.items[1].url, 'https://ca.indeed.com/viewjob?jk=abc&from=x');
});

test('score worklist supports --limit override and human output without dumping processed history', () => {
  const v = mkVault({
    cap: 50,
    pipeline: [
      '# Pipeline',
      '- [x] 2026-06-01 | DoneCo | Old Role | https://example.com/done → 3.0/5 PDF:❌ CANADA:y | 001',
      '- [ ] 2026-06-14 | Acme | Senior Product Manager | https://example.com/a | src=portal',
      '- [ ] 2026-06-15 | Beta | Staff PM | https://example.com/b | src=gmail',
    ].join('\n') + '\n',
  });
  const res = spawnSync(process.execPath, [SCRIPT, '--vault', v, '--limit', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /^Pending score worklist: 1\/2 \(cap 1\)/);
  assert.match(res.stdout, /line 3 \| 2026-06-14 \| Acme \| Senior Product Manager \| https:\/\/example\.com\/a \| src=portal/);
  assert.doesNotMatch(res.stdout, /DoneCo/);
  assert.doesNotMatch(res.stdout, /https:\/\/example\.com\/done/);
});
