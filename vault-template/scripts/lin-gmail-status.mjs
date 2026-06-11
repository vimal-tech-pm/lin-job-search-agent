#!/usr/bin/env node
/**
 * lin-gmail-status.mjs — Gmail status-check for applied Lin jobs.
 *
 * Reads all job.yml where status=applied and checks Gmail for status-change
 * emails (interview invites, rejections, offers, etc.).
 *
 * Decoupled from lin-gmailscan.mjs (which is discovery-only).
 * Falls back to himalaya if Google Workspace GAPI is not authenticated.
 *
 * Usage:
 *   node scripts/lin-gmail-status.mjs              # auto-apply updates (cron mode)
 *   node scripts/lin-gmail-status.mjs --dry-run    # scan only, print table
 *   node scripts/lin-gmail-status.mjs --since 7    # only check last 7 days
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'yaml';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const VAULT = path.resolve(__dirname, '..');
const PROFILE_ROOT = path.resolve(VAULT, '..');
const COMPANIES = path.join(VAULT, 'companies');
const GWS_SCRIPTS = path.join(PROFILE_ROOT, 'skills', 'productivity', 'google-workspace', 'scripts');
const SETUP = path.join(GWS_SCRIPTS, 'setup.py');
const GAPI = path.join(GWS_SCRIPTS, 'google_api.py');

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const WRITE = !DRY_RUN;
const SINCE_DAYS = (() => {
  const idx = ARGS.indexOf('--since');
  return idx !== -1 ? parseInt(ARGS[idx + 1], 10) || 7 : 7;
})();
const VERBOSE = ARGS.includes('--verbose') || !process.env.HERMES_CRON_RUN;

function pythonBin() {
  for (const bin of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return bin;
  }
  return 'python3';
}
const PYTHON = pythonBin();

function runPython(script, args, opts = {}) {
  return spawnSync(PYTHON, [script, ...args], {
    cwd: VAULT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, ...opts,
  });
}

function parseMaybeJson(stdout) {
  const s = String(stdout || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const i = s.indexOf('[');
  const j = s.lastIndexOf(']');
  if (i !== -1 && j !== -1 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch {} }
  return null;
}

function gapiAuthOk() {
  if (!fs.existsSync(SETUP) || !fs.existsSync(GAPI)) return false;
  const r = runPython(SETUP, ['--check']);
  return r.status === 0 && /AUTHENTICATED/.test(`${r.stdout}\n${r.stderr}`);
}

function himalayaOk() {
  const r = spawnSync('himalaya', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return false;
  return fs.existsSync(path.join(process.env.LIN_REAL_HOME || process.env.HOME, '.config/himalaya/config.toml'));
}

function loadAppliedJobs() {
  const jobs = [];
  if (!fs.existsSync(COMPANIES)) return jobs;
  for (const co of fs.readdirSync(COMPANIES)) {
    const jobsDir = path.join(COMPANIES, co, 'jobs');
    if (!fs.existsSync(jobsDir)) continue;
    for (const slug of fs.readdirSync(jobsDir)) {
      const yml = path.join(jobsDir, slug, 'job.yml');
      if (!fs.existsSync(yml)) continue;
      try {
        const raw = fs.readFileSync(yml, 'utf8');
        const job = yaml.parse(raw);
        if (job?.status !== 'applied') continue;
        jobs.push({
          coSlug: co, jobSlug: slug,
          title: job.title || slug,
          appliedAt: job.applied_at || '',
          sourceUrl: job.source_url || '',
          ymlPath: yml,
        });
      } catch {}
    }
  }
  return jobs;
}

function companyDisplayName(coSlug) {
  const yml = path.join(COMPANIES, coSlug, 'company.yml');
  if (!fs.existsSync(yml)) return coSlug;
  try {
    const parsed = yaml.parse(fs.readFileSync(yml, 'utf8'));
    return parsed?.display_name || coSlug;
  } catch { return coSlug; }
}

function classify(body, subject) {
  const text = `${subject} ${body}`.toLowerCase();
  if (/unfortunately|not moving forward|will not be moving|no longer|regret to inform|not been selected|decided to pursue other|not able to offer|position has been filled|won't be able to move forward/i.test(text)) return 'rejection';
  if (/interview|phone screen|schedule a call|would like to speak|next steps.*call|meet the team|video call|zoom|book a time|availability for a call/i.test(text)) return 'interview';
  if (/pleased to offer|delighted to extend|offer letter|congratulations.*offer|position.*offered/i.test(text)) return 'offer';
  if (/thank you for (applying|your application)|application received|we have received|application.*submitted|on file/i.test(text)) return 'acknowledgement';
  return 'other';
}

function statusIcon(cls) {
  return { rejection: '❌', interview: '🎙️', offer: '🎉', acknowledgement: '📨' }[cls] || '  ';
}

function updateJobStatus(ymlPath, newStatus, detail) {
  const raw = fs.readFileSync(ymlPath, 'utf8');
  const job = yaml.parse(raw);
  const now = new Date().toISOString();
  if (newStatus) {
    job.status = newStatus;
    job.status_detail = detail;
  }
  job.last_email_check = now;
  job.last_email_status = detail || 'silent';
  fs.writeFileSync(ymlPath, yaml.stringify(job), 'utf8');

  const historyPath = path.join(path.dirname(ymlPath), 'status-history.md');
  const ts = now.replace('T', ' ').substring(0, 19);
  const row = newStatus
    ? `${ts}  ${newStatus}        ${detail}\n`
    : `${ts}  email-check   ${detail || 'silent'}\n`;
  try { fs.appendFileSync(historyPath, row, 'utf8'); } catch {}
}
// ── GAPI search ──
function searchViaGapi(companyName) {
  const queries = [
    `"${companyName}" newer_than:${SINCE_DAYS}d`,
    `${companyName} subject:(interview OR offer OR update) newer_than:${SINCE_DAYS}d`,
  ];
  const allMsgs = [];
  const seen = new Set();
  for (const q of queries) {
    if (VERBOSE) console.error(`  gapi: ${q}`);
    const r = runPython(GAPI, ['gmail', 'search', q, '--max', '25']);
    if (r.status !== 0) continue;
    for (const m of (parseMaybeJson(r.stdout) || [])) {
      const mid = m.id || m.message_id;
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      allMsgs.push(m);
    }
  }
  if (allMsgs.length === 0) return [];

  const results = [];
  for (const m of allMsgs.slice(0, 10)) {
    const mid = m.id || m.message_id;
    let body = m.snippet || '';
    if (mid) {
      const got = runPython(GAPI, ['gmail', 'get', String(mid)]);
      if (got.status === 0) body = (parseMaybeJson(got.stdout) || {}).body || m.snippet || '';
    }
    const cls = classify(body, m.subject || '');
    if (cls !== 'other') results.push({ id: mid, from: m.from || '', subject: m.subject || '', date: m.date || '', classification: cls, snippet: (body || '').slice(0, 200).replace(/\s+/g, ' ').trim() });
  }
  return results;
}

// ── Himalaya fallback ──
function searchViaHimalaya(companyName) {
  const results = [];
  const homeEnv = { ...process.env, HOME: process.env.LIN_REAL_HOME || process.env.HOME };
  const seenSubjects = new Set();

  // Try 2 variants: exact, lowercase
  for (const variant of [companyName, companyName.toLowerCase()]) {
    if (results.length >= 5) break;
    try {
      const r = spawnSync('himalaya', [
        'envelope', 'list', '--folder', 'INBOX', '--page-size', '200', '--max-width', '400',
        variant,
      ], { cwd: VAULT, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, env: homeEnv, timeout: 30000 });
      if (r.status !== 0) continue;

      const lines = String(r.stdout).split('\n');
      for (const line of lines) {
        const parts = line.split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length < 4) continue;
        const id = parts[0], subject = parts[2] || '', from = parts[3] || '', date = parts[4] || '';
        if (!(subject + from).toLowerCase().includes(companyName.toLowerCase())) continue;
        if (seenSubjects.has(subject)) continue;
        seenSubjects.add(subject);

        let body = '';
        try {
          const br = spawnSync('himalaya', ['message', 'read', id],
            { cwd: VAULT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, env: homeEnv, timeout: 15000 });
          if (br.status === 0) body = String(br.stdout).slice(0, 2000);
        } catch {}

        const cls = classify(body, subject);
        if (cls !== 'other') results.push({ id, from, subject, date, classification: cls, snippet: (body || subject).slice(0, 200).replace(/\s+/g, ' ').trim() });
      }
    } catch {}
  }
  return results;
}

function searchGmail(companyName) {
  if (gapiAuthOk()) return searchViaGapi(companyName);
  if (himalayaOk()) return searchViaHimalaya(companyName);
  return [];
}

// ── MAIN ──
function main() {
  if (!gapiAuthOk() && !himalayaOk()) {
    console.log('Gmail not reachable: neither GAPI nor himalaya available. Exit clean.');
    process.exit(0);
  }

  const jobs = loadAppliedJobs();
  console.log(`\nGmail status check — ${jobs.length} applied jobs (last ${SINCE_DAYS}d)\n`);

  if (jobs.length === 0) { console.log('No applied jobs.'); return; }

  const findings = [];
  let updated = 0;

  for (const job of jobs) {
    const name = companyDisplayName(job.coSlug);
    if (VERBOSE) console.error(`[${job.coSlug}] "${name}" ...`);
    const matches = searchGmail(name);
    if (matches.length === 0) {
      findings.push({ job, match: null, classification: 'no_email' });
      continue;
    }
    for (const m of matches) findings.push({ job, match: m, classification: m.classification });

    if (WRITE) {
      const actionable = matches.find(m => ['rejection', 'interview', 'offer'].includes(m.classification));
      if (actionable) {
        const newStatus = actionable.classification === 'rejection' ? 'closed' : actionable.classification === 'interview' ? 'interviewing' : 'offer';
        updateJobStatus(job.ymlPath, newStatus, `${actionable.classification}: ${actionable.subject} (${actionable.date})`);
        updated++;
      } else {
        // Record check even when silent
        const ack = matches.find(m => m.classification === 'acknowledgement');
        const status = ack ? `acknowledged: ${ack.subject.slice(0, 80)}` : 'silent';
        updateJobStatus(job.ymlPath, null, status);
      }
    }
  }

  // Table
  console.log('| Company | Role | Status | Detail |');
  console.log('|---------|------|--------|--------|');
  for (const f of findings) {
    const name = companyDisplayName(f.job.coSlug).slice(0, 20);
    const role = f.job.title.slice(0, 40);
    const icon = statusIcon(f.classification);
    if (f.classification === 'no_email') {
      console.log(`| ${name} | ${role} | ${icon} no update | applied ${f.job.appliedAt.slice(0, 10)} |`);
    } else {
      console.log(`| ${name} | ${role} | ${icon} ${f.match.classification} | ${(f.match.subject || '').slice(0, 35)} |`);
    }
  }

  // Summary
  const counts = {};
  for (const f of findings) counts[f.classification] = (counts[f.classification] || 0) + 1;
  console.log(`\nSummary: rejection=${counts.rejection || 0} interview=${counts.interview || 0} offer=${counts.offer || 0} ack=${counts.acknowledgement || 0} silent=${counts.no_email || 0}`);

  if (DRY_RUN) {
    console.log('Dry run — no changes written.');
  } else {
    console.log(`Auto-applied ${updated} status update(s).`);
    const ts = path.join(VAULT, 'scripts', 'lin-tracker.mjs');
    if (fs.existsSync(ts)) try { spawnSync('node', [ts], { cwd: VAULT, stdio: 'inherit', encoding: 'utf8' }); } catch {}
  }
}

main();
