#!/usr/bin/env node
/**
 * lin-fetch-posted.mjs — one-time backfill of job.yml.posted_date by fetching each
 * role's source_url from the board's PUBLIC JSON API (no auth, no scraping, no LLM).
 * Covers the three boards that expose a reliable posting timestamp:
 *   Greenhouse  first_published     Lever  createdAt(epoch)     Ashby  publishedAt
 * Other hosts (LinkedIn/Workday/Wellfound/…) are skipped — no stable public date.
 *
 * Dry-run by default; --write backs up changed job.yml first. Idempotent.
 * Usage: node scripts/lin-fetch-posted.mjs [--write] [--limit N] [--vault <path>]
 */
import fs from 'node:fs';
import path from 'node:path';

// --- pure: map a job URL to the board API target (or null) ---
export function apiTargetFor(sourceUrl) {
  let u;
  try { u = new URL(String(sourceUrl)); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\.|^ca\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('greenhouse.io')) {
    const org = seg[0]; const id = seg[seg.indexOf('jobs') + 1];
    if (org && id) return { board: 'greenhouse', apiUrl: `https://boards-api.greenhouse.io/v1/boards/${org}/jobs/${id}` };
  }
  if (host === 'jobs.lever.co' && seg[0] && seg[1]) {
    return { board: 'lever', apiUrl: `https://api.lever.co/v0/postings/${seg[0]}/${seg[1]}` };
  }
  if (host === 'jobs.ashbyhq.com' && seg[0] && seg[1]) {
    return { board: 'ashby', apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${seg[0]}`, postingId: seg[1] };
  }
  return null;
}

const isoDay = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// --- pure: pull the posting date out of a board's API JSON ---
export function extractDate(board, json, postingId) {
  if (!json) return null;
  if (board === 'greenhouse') return isoDay(json.first_published || json.updated_at);
  if (board === 'lever') return typeof json.createdAt === 'number' ? isoDay(json.createdAt) : null;
  if (board === 'ashby') return isoDay((json.jobs || []).find((j) => j.id === postingId)?.publishedAt);
  return null;
}

// --- runner ---
function jobsMissingDate(vault) {
  const out = [];
  const companies = path.join(vault, 'companies');
  if (!fs.existsSync(companies)) return out;
  for (const co of fs.readdirSync(companies)) {
    const jobsDir = path.join(companies, co, 'jobs');
    if (!fs.existsSync(jobsDir)) continue;
    for (const slug of fs.readdirSync(jobsDir)) {
      const ymlPath = path.join(jobsDir, slug, 'job.yml');
      if (!fs.existsSync(ymlPath)) continue;
      const raw = fs.readFileSync(ymlPath, 'utf8');
      const existing = /^posted_date:\s*(\S+)/m.exec(raw)?.[1];
      if (existing && existing !== 'null') continue;
      const url = /^source_url:\s*(\S+)/m.exec(raw)?.[1];
      if (url) out.push({ co, slug, ymlPath, raw, url });
    }
  }
  return out;
}

function setPostedLine(raw, iso) {
  if (/^posted_date:/m.test(raw)) return raw.replace(/^posted_date:.*$/m, `posted_date: ${iso}`);
  if (/^discovered_at:.*$/m.test(raw)) return raw.replace(/^(discovered_at:.*)$/m, `$1\nposted_date: ${iso}`);
  return (raw.endsWith('\n') ? raw : raw + '\n') + `posted_date: ${iso}\n`;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'lin-tracker/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    return { json: await r.json() };
  } catch (e) { return { err: e.name === 'TimeoutError' ? 'timeout' : (e.message || 'fetch error') }; }
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const limIdx = argv.indexOf('--limit');
  const limit = limIdx !== -1 ? parseInt(argv[limIdx + 1], 10) : Infinity;
  const vIdx = argv.indexOf('--vault');
  const vault = vIdx !== -1 && argv[vIdx + 1] ? path.resolve(argv[vIdx + 1]) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  const targets = jobsMissingDate(vault)
    .map((j) => ({ ...j, t: apiTargetFor(j.url) }))
    .filter((j) => j.t)
    .slice(0, limit);

  const ashbyBoardCache = new Map(); // apiUrl → json (one fetch per org)
  const changes = []; const fails = [];
  const today = new Date();

  for (const j of targets) {
    let json, err;
    if (j.t.board === 'ashby') {
      if (!ashbyBoardCache.has(j.t.apiUrl)) ashbyBoardCache.set(j.t.apiUrl, await fetchJson(j.t.apiUrl));
      ({ json, err } = ashbyBoardCache.get(j.t.apiUrl));
    } else {
      ({ json, err } = await fetchJson(j.t.apiUrl));
    }
    if (err) { fails.push({ ref: `${j.co}/${j.slug}`, board: j.t.board, err }); continue; }
    const iso = extractDate(j.t.board, json, j.t.postingId);
    // plausibility: not in the future, not absurdly old
    const ageDays = iso ? (today - new Date(iso)) / 86400000 : NaN;
    if (!iso || ageDays < -2 || ageDays > 1095) { fails.push({ ref: `${j.co}/${j.slug}`, board: j.t.board, err: iso ? `implausible ${iso}` : 'no date in API' }); continue; }
    changes.push({ ...j, iso });
  }

  console.log(`${write ? 'WRITE' : 'DRY-RUN'} — ${targets.length} fetchable role(s); ${changes.length} dates recovered, ${fails.length} miss\n`);
  console.log('| Job | board | posted_date |');
  console.log('|-----|-------|-------------|');
  for (const c of changes) console.log(`| ${c.co}/${c.slug} | ${c.t.board} | ${c.iso} |`);
  if (fails.length) {
    console.log(`\nMisses (${fails.length}): ` + fails.slice(0, 12).map((f) => `${f.ref}(${f.err})`).join(', ') + (fails.length > 12 ? ' …' : ''));
  }

  if (!write) { console.log('\nNothing written. Re-run with --write to back up + apply.'); return; }
  if (!changes.length) { console.log('\nNothing to write.'); return; }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(vault, 'backups', `posted-fetch-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const c of changes) {
    fs.copyFileSync(c.ymlPath, path.join(backupDir, `${c.co}__${c.slug}.job.yml`));
    fs.writeFileSync(c.ymlPath, setPostedLine(c.raw, c.iso), 'utf8');
  }
  console.log(`\nBacked up ${changes.length} file(s) → ${backupDir}\nApplied. Run: node scripts/lin-tracker.mjs`);
}

if (path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
