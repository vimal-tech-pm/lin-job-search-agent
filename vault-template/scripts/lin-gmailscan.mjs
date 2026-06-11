#!/usr/bin/env node
/**
 * lin-gmailscan.mjs — Gmail API discovery companion for Lin.
 *
 * Privacy guardrails:
 * - Only runs configured queries from career-profile/scan-channels.json.
 * - Reads matching messages only to extract job URLs and light metadata.
 * - Stores URL/company/role/sender-domain/date/confidence, never full bodies.
 * - Discovery only: feeds scripts/lin-discovery-append.mjs; never mutates
 *   application status, calendar, or labels.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT = path.resolve(__dirname, '..');
const PROFILE_ROOT = path.resolve(VAULT, '..');
const CHANNELS = path.join(VAULT, 'career-profile', 'scan-channels.json');
const CONFIG = path.join(VAULT, 'career-profile', 'pipeline-config.json');
const APPEND = path.join(VAULT, 'scripts', 'lin-discovery-append.mjs');
const GWS_SCRIPTS = path.join(PROFILE_ROOT, 'skills', 'productivity', 'google-workspace', 'scripts');
const SETUP = path.join(GWS_SCRIPTS, 'setup.py');
const GAPI = path.join(GWS_SCRIPTS, 'google_api.py');

function pythonBin() {
  const candidates = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return bin;
  }
  return 'python3';
}
const PYTHON = pythonBin();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function cap() {
  const cfg = readJson(CONFIG, {});
  const v = cfg?.daily?.scan_gmail_cap;
  return Number.isFinite(v) ? v : 50;
}

function runPython(script, args, opts = {}) {
  return spawnSync(PYTHON, [script, ...args], {
    cwd: VAULT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
}

function authOk() {
  if (!fs.existsSync(SETUP) || !fs.existsSync(GAPI)) return false;
  const r = runPython(SETUP, ['--check']);
  return r.status === 0 && /AUTHENTICATED/.test(`${r.stdout}\n${r.stderr}`);
}

function parseMaybeJson(stdout) {
  const s = String(stdout || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const i = s.indexOf('[');
  const j = s.lastIndexOf(']');
  if (i !== -1 && j !== -1 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); } catch {}
  }
  const oi = s.indexOf('{');
  const oj = s.lastIndexOf('}');
  if (oi !== -1 && oj !== -1 && oj > oi) {
    try { return JSON.parse(s.slice(oi, oj + 1)); } catch {}
  }
  return null;
}

function senderDomain(from) {
  const m = /@([^>\s]+)/.exec(String(from || ''));
  return m ? m[1].toLowerCase().replace(/[>,]+$/g, '') : '';
}

function senderEmail(from) {
  const s = String(from || '').toLowerCase();
  const angle = /<([^>]+@[^>]+)>/.exec(s)?.[1];
  const bare = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(s)?.[0];
  return (angle || bare || '').replace(/[>,]+$/g, '');
}

function senderAllowed(from, allowList) {
  if (!Array.isArray(allowList) || allowList.length === 0) return true;
  const email = senderEmail(from);
  const domain = senderDomain(from);
  if (!email && !domain) return false;
  return allowList.some((item) => {
    const a = String(item || '').trim().toLowerCase();
    if (!a) return false;
    if (a.includes('@')) return email === a;
    return domain === a || domain.endsWith(`.${a}`);
  });
}

function urlCompany(url, fallbackDomain) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('linkedin.')) return 'LinkedIn alert';
    if (host.includes('indeed.')) return 'Indeed alert';
    if (host.includes('greenhouse.')) {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      if (parts[0]) return titleCase(parts[0].replace(/[-_]/g, ' '));
    }
    if (host.includes('lever.co')) {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      if (parts[0]) return titleCase(parts[0].replace(/[-_]/g, ' '));
    }
    if (host.includes('ashbyhq.com')) {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('company');
      if (idx !== -1 && parts[idx + 1]) return titleCase(parts[idx + 1].replace(/[-_]/g, ' '));
    }
  } catch {}
  if (fallbackDomain) return titleCase(fallbackDomain.split('.')[0].replace(/[-_]/g, ' '));
  return 'Unknown company';
}

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function roleFromSubject(subject) {
  let s = String(subject || '')
    .replace(/^(job alert|jobs? alert|new jobs?|recommended jobs?|recruiter message|inmail):?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Keep title useful for title_filter; fall back to a broad PM phrase.
  if (!/product|program|strategy|operations|manager|director|lead/i.test(s)) {
    s = `Product Manager opportunity${s ? ` — ${s}` : ''}`;
  }
  return s.slice(0, 140);
}

function isoDate(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function extractUrls(text) {
  const raw = String(text || '').match(/https?:\/\/[^\s<>"')]+/g) || [];
  const keep = [];
  const seen = new Set();
  for (let u of raw) {
    u = u.replace(/[\]\).,;]+$/g, '');
    const low = u.toLowerCase();
    if (!/(linkedin\.com\/jobs|indeed\.|greenhouse\.io|lever\.co|ashbyhq\.com|workdayjobs\.com|myworkdayjobs\.com)/.test(low)) continue;
    if (!seen.has(u)) { seen.add(u); keep.push(u); }
  }
  return keep;
}

function main() {
  const channels = readJson(CHANNELS, {});
  const gmail = channels.gmail || {};
  if (gmail.enabled === false) {
    console.log('gmail: scan skipped (disabled in scan-channels.json)');
    return;
  }
  const appendLimit = cap();
  if (appendLimit <= 0) {
    console.log(`gmail: scan skipped (cap ${appendLimit})`);
    return;
  }
  // Collect a larger bounded raw pool: append helper does final title filtering,
  // dedup, and scan_gmail_cap enforcement. This prevents early duplicate/weak
  // URLs from consuming the final daily cap.
  const rawLimit = Math.min(Math.max(appendLimit * 5, appendLimit + 25, 50), 500);
  if (!authOk()) {
    console.log('gmail: Google Workspace not authenticated; run google-workspace OAuth setup with --services email,calendar. No results fabricated.');
    return;
  }

  const queries = Array.isArray(gmail.queries) && gmail.queries.length
    ? gmail.queries
    : [`newer_than:${gmail.lookback_days || 14}d (subject:(job OR career OR recruiter) OR from:(linkedin.com OR greenhouse.io OR lever.co OR ashbyhq.com OR workday.com))`];
  const candidates = [];
  const seenUrls = new Set();
  const allowedSenders = Array.isArray(gmail.alert_senders) ? gmail.alert_senders : [];

  for (const query of queries) {
    if (candidates.length >= rawLimit) break;
    const search = runPython(GAPI, ['gmail', 'search', query, '--max', String(Math.max(rawLimit * 2, 10))]);
    if (search.status !== 0) {
      console.error(`gmail: warning: query failed: ${query}`);
      continue;
    }
    const messages = parseMaybeJson(search.stdout) || [];
    for (const msg of messages) {
      if (candidates.length >= rawLimit) break;
      const id = msg.id || msg.message_id;
      const from = msg.from || '';
      if (!senderAllowed(from, allowedSenders)) continue;
      const domain = senderDomain(from);
      const subject = msg.subject || '';
      const date = msg.date || msg.internalDate || new Date().toISOString();
      let haystack = `${subject}\n${msg.snippet || ''}`;
      if (id) {
        const got = runPython(GAPI, ['gmail', 'get', String(id)]);
        if (got.status === 0) {
          const full = parseMaybeJson(got.stdout) || {};
          haystack += `\n${full.body || ''}`;
        }
      }
      for (const url of extractUrls(haystack)) {
        if (candidates.length >= rawLimit) break;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        candidates.push({
          company: urlCompany(url, domain),
          role: roleFromSubject(subject),
          url,
          source: 'gmail',
          source_query: query,
          source_item_id: id || null,
          seen_at: isoDate(date),
          confidence: 'medium',
          notes: domain ? `sender-domain:${domain}` : '',
        });
      }
    }
  }

  const tmp = path.join(os.tmpdir(), `lin-gmail-candidates-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(candidates, null, 2));
  try {
    execFileSync('node', [APPEND, '--source', 'gmail', '--file', tmp], { cwd: VAULT, stdio: 'inherit' });
    execFileSync('node', [path.join(VAULT, 'scripts', 'lin-tracker.mjs')], { cwd: VAULT, stdio: 'inherit' });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

main();
