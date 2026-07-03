import test from 'node:test';
import assert from 'node:assert/strict';
import { apiTargetFor, extractDate } from '../scripts/lin-fetch-posted.mjs';

test('apiTargetFor maps Greenhouse job URLs to the board API', () => {
  const t = apiTargetFor('https://job-boards.greenhouse.io/7shifts/jobs/5994563004');
  assert.equal(t.board, 'greenhouse');
  assert.equal(t.apiUrl, 'https://boards-api.greenhouse.io/v1/boards/7shifts/jobs/5994563004');
  // legacy boards.greenhouse.io host collapses the same way
  assert.equal(apiTargetFor('https://boards.greenhouse.io/acme/jobs/42').apiUrl, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/42');
});

test('apiTargetFor maps Lever URLs to the postings API', () => {
  const t = apiTargetFor('https://jobs.lever.co/BestEgg/b35192ff-641c-424a-8e60-754692b070ef');
  assert.equal(t.board, 'lever');
  assert.equal(t.apiUrl, 'https://api.lever.co/v0/postings/BestEgg/b35192ff-641c-424a-8e60-754692b070ef');
});

test('apiTargetFor maps Ashby URLs to the org board API + keeps the posting id', () => {
  const t = apiTargetFor('https://jobs.ashbyhq.com/bankjoy/fc66f059-3968-4861-b11d-a5e771c8c7da');
  assert.equal(t.board, 'ashby');
  assert.equal(t.apiUrl, 'https://api.ashbyhq.com/posting-api/job-board/bankjoy');
  assert.equal(t.postingId, 'fc66f059-3968-4861-b11d-a5e771c8c7da');
});

test('apiTargetFor returns null for boards we do not fetch (LinkedIn/Workday/etc.)', () => {
  assert.equal(apiTargetFor('https://ca.linkedin.com/jobs/view/12345'), null);
  assert.equal(apiTargetFor('https://autodesk.wd1.myworkdayjobs.com/Ext/job/x'), null);
  assert.equal(apiTargetFor('not a url'), null);
});

test('extractDate reads the right field per board', () => {
  assert.equal(extractDate('greenhouse', { first_published: '2026-05-12T13:01:25-04:00', updated_at: '2026-06-02T16:30:29-04:00' }), '2026-05-12');
  assert.equal(extractDate('greenhouse', { updated_at: '2026-06-02T16:30:29-04:00' }), '2026-06-02'); // fallback when no first_published
  assert.equal(extractDate('lever', { createdAt: 1769029479882 }), '2026-01-21');
  const board = { jobs: [{ id: 'aaa', publishedAt: '2026-04-10T00:00:00Z' }, { id: 'bbb', publishedAt: '2026-05-01T00:00:00Z' }] };
  assert.equal(extractDate('ashby', board, 'bbb'), '2026-05-01');
  assert.equal(extractDate('ashby', board, 'zzz'), null); // id not on the board
});

test('extractDate rejects junk / missing fields', () => {
  assert.equal(extractDate('greenhouse', {}), null);
  assert.equal(extractDate('lever', { createdAt: 'nope' }), null);
  assert.equal(extractDate('ashby', { jobs: [] }, 'x'), null);
});
