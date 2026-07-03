#!/usr/bin/env node
/**
 * lin-backfill-posted.mjs — one-time, OFFLINE, deterministic backfill of
 * job.yml.posted_date from the JD snapshots Lin already saved (`jds/*.md`).
 *
 * No LLM: posting dates appear in a small, regular set of forms. The extractor is
 * CONSERVATIVE — it skips ambiguous pages (multiple conflicting "N days ago") and
 * the Indeed filter-chrome ("Date posted Past month") rather than write a wrong
 * date, because a wrong recency is worse than a missing one. Relative phrases are
 * anchored to when the snapshot was captured (≈ discovered_at).
 *
 * Dry-run by default; --write backs up changed job.yml to backups/ first.
 * Usage: node scripts/lin-backfill-posted.mjs [--write] [--vault <path>]
 */
import fs from 'node:fs';
import path from 'node:path';

// Pure: pull a posting date (ISO) out of snapshot text, anchored to capturedISO.
// Returns null when nothing trustworthy is found.
export function extractPostedDate(text, capturedISO) {
  const cap = new Date(`${capturedISO}T00:00:00Z`);
  if (Number.isNaN(cap.getTime())) return null;
  const t = String(text || '');

  const plausible = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const ageDays = (cap.getTime() - d.getTime()) / 86400000;
    return ageDays < -2 || ageDays > 730 ? null : iso; // not future(>2d), not >2y old
  };

  // 1) explicit "Date Posted: YYYY-MM-DD"
  let m = /(?:date\s+posted|posted(?:\s+date)?)\s*:?\s*\*{0,2}\s*(\d{4}-\d{2}-\d{2})/i.exec(t);
  if (m) return plausible(m[1]);

  // 2) "Posted on Month D, Year"
  m = /posted\s+on\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/i.exec(t);
  if (m) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return plausible(d.toISOString().slice(0, 10));
  }

  // 3) relative phrases — gather distinct results; >1 distinct = ambiguous → skip
  const rel = new Set();
  // Only "posted"-adjacent today/just — a bare "today" is almost always JD copy
  // ("apply today", "The Today Show"), never the posting date.
  if (/\b(?:just posted|posted just now|posted\s+today|today'?s?\s+posting)\b/i.test(t)) rel.add(capturedISO);
  for (const mm of t.matchAll(/(?:~\s*)?(\d{1,3})\s+(day|week|month)s?\s+ago/gi)) {
    const n = parseInt(mm[1], 10);
    const unit = mm[2].toLowerCase();
    const unitDays = unit === 'day' ? 1 : unit === 'week' ? 7 : 30;
    rel.add(new Date(cap.getTime() - n * unitDays * 86400000).toISOString().slice(0, 10));
  }
  return rel.size === 1 ? plausible([...rel][0]) : null;
}

// ---------- runner ----------

function readJobsNeedingBackfill(vault) {
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
      if (existing && existing !== 'null') continue; // already has a real date → idempotent skip
      const discovered = /^discovered_at:\s*(\S+)/m.exec(raw)?.[1] || null;
      out.push({ co, slug, ymlPath, raw, discovered });
    }
  }
  return out;
}

// Map co/slug → { jd_snapshot, discovered_at } from the queue.
function queueIndex(vault) {
  const p = path.join(vault, 'data', 'evaluation-queue.json');
  const idx = new Map();
  try {
    const q = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const r of q.roles || []) {
      if (r.co_slug && r.job_slug) idx.set(`${r.co_slug}/${r.job_slug}`, { jd_snapshot: r.jd_snapshot, discovered_at: r.discovered_at });
      const fold = (r.promotion?.job_folder || '').replace(/^companies\//, '').replace(/\/$/, '');
      if (fold) idx.set(fold, { jd_snapshot: r.jd_snapshot, discovered_at: r.discovered_at });
    }
  } catch {}
  return idx;
}

// Anchor date for relative phrases: discovered_at, else the date in the snapshot filename.
function anchorFor(job, q) {
  const fromYml = job.discovered;
  const fromQueue = q?.discovered_at;
  const fromName = /(\d{4}-\d{2}-\d{2})/.exec(q?.jd_snapshot || '')?.[1];
  return (fromYml || fromQueue || fromName || '').slice(0, 10) || null;
}

function setPostedLine(raw, iso) {
  if (/^posted_date:/m.test(raw)) return raw.replace(/^posted_date:.*$/m, `posted_date: ${iso}`);
  return (raw.endsWith('\n') ? raw : raw + '\n') + `posted_date: ${iso}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const vIdx = argv.indexOf('--vault');
  const vault = vIdx !== -1 && argv[vIdx + 1] ? path.resolve(argv[vIdx + 1]) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  const qidx = queueIndex(vault);
  const jobs = readJobsNeedingBackfill(vault);
  const changes = [];
  let scanned = 0, noSnapshot = 0;

  for (const job of jobs) {
    const q = qidx.get(`${job.co}/${job.slug}`);
    const snapRel = q?.jd_snapshot;
    if (!snapRel) { noSnapshot++; continue; }
    const snapPath = path.join(vault, snapRel);
    if (!fs.existsSync(snapPath)) { noSnapshot++; continue; }
    const anchor = anchorFor(job, q);
    if (!anchor) continue;
    scanned++;
    let posted;
    try { posted = extractPostedDate(fs.readFileSync(snapPath, 'utf8'), anchor); } catch { posted = null; }
    if (posted) changes.push({ ...job, posted, anchor });
  }

  console.log(`${write ? 'WRITE' : 'DRY-RUN'} — scanned ${scanned} snapshots (${noSnapshot} had none); ${changes.length} posting date(s) recovered\n`);
  console.log('| Job | posted_date | anchor (seen) |');
  console.log('|-----|-------------|---------------|');
  for (const c of changes) console.log(`| ${c.co}/${c.slug} | ${c.posted} | ${c.anchor} |`);

  if (!write) { console.log('\nNothing written. Re-run with --write to back up + apply.'); return; }
  if (changes.length === 0) { console.log('\nNothing to write.'); return; }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(vault, 'backups', `posted-backfill-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const c of changes) {
    fs.copyFileSync(c.ymlPath, path.join(backupDir, `${c.co}__${c.slug}.job.yml`));
    fs.writeFileSync(c.ymlPath, setPostedLine(c.raw, c.posted), 'utf8');
  }
  console.log(`\nBacked up ${changes.length} file(s) → ${backupDir}`);
  console.log('Applied. Run: node scripts/lin-tracker.mjs');
}

if (path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
