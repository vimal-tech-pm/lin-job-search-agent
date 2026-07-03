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
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'yaml';
import { emailSignals, foldEmailSignal, normalizeState, deriveStatus } from './lib/outcome.mjs';
export { deriveStatus }; // re-exported: part of this module's tested surface

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
const HIMALAYA_ENV = { ...process.env, HOME: '~' };
const HIMALAYA_CONFIG = `${os.homedir()}/.config/himalaya/config.toml`;
let GAPI_OK_CACHE = null;
let HIMALAYA_STATUS_CACHE = null;

const GAPI_DEPS = ['google-api-python-client', 'google-auth-oauthlib', 'google-auth-httplib2'];

function runPython(script, args, opts = {}) {
  // Use uv run to ensure google API deps are available (system python3 has no pip)
  const cmd = 'uv';
  const uvArgs = ['run', ...GAPI_DEPS.flatMap(d => ['--with', d]), 'python', script, ...args];
  return spawnSync(cmd, uvArgs, {
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
  if (GAPI_OK_CACHE !== null) return GAPI_OK_CACHE;
  if (!fs.existsSync(SETUP) || !fs.existsSync(GAPI)) {
    GAPI_OK_CACHE = false;
    return GAPI_OK_CACHE;
  }
  const r = runPython(SETUP, ['--check']);
  GAPI_OK_CACHE = r.status === 0 && /AUTHENTICATED/.test(`${r.stdout}\n${r.stderr}`);
  return GAPI_OK_CACHE;
}

function runHimalaya(args, opts = {}) {
  return spawnSync('himalaya', args, {
    cwd: VAULT,
    encoding: 'utf8',
    maxBuffer: opts.maxBuffer || 5 * 1024 * 1024,
    env: HIMALAYA_ENV,
    timeout: opts.timeout || 30000,
  });
}

function himalayaStatus() {
  if (HIMALAYA_STATUS_CACHE) return HIMALAYA_STATUS_CACHE;
  const version = spawnSync('himalaya', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (version.status !== 0) {
    HIMALAYA_STATUS_CACHE = { ok: false, reason: 'himalaya binary not available' };
    return HIMALAYA_STATUS_CACHE;
  }
  if (!fs.existsSync(HIMALAYA_CONFIG)) {
    HIMALAYA_STATUS_CACHE = { ok: false, reason: `missing config at ${HIMALAYA_CONFIG}` };
    return HIMALAYA_STATUS_CACHE;
  }

  // `himalaya --version` only proves the CLI exists. In cron/headless sessions
  // the configured auth command can block forever waiting for GNOME Keyring to
  // unlock via a GUI prompt. Probe the real IMAP path once, with a hard timeout,
  // before the per-company loop so one locked keyring cannot turn 75 applied jobs
  // into 75 slow timeouts.
  const probe = runHimalaya(['envelope', 'list', '--folder', 'INBOX', '--page-size', '1', '-o', 'json'], { timeout: 12000, maxBuffer: 1024 * 1024 });
  if (probe.status === 0) {
    HIMALAYA_STATUS_CACHE = { ok: true, reason: 'ok' };
    return HIMALAYA_STATUS_CACHE;
  }
  const output = `${probe.stderr || ''}\n${probe.stdout || ''}`.trim().replace(/\s+/g, ' ');
  const timedOut = probe.error?.code === 'ETIMEDOUT' || probe.signal === 'SIGTERM' || probe.status === null;
  HIMALAYA_STATUS_CACHE = {
    ok: false,
    reason: timedOut
      ? 'himalaya credential helper timed out (likely locked GNOME Keyring / secret-tool in headless cron)'
      : `himalaya IMAP probe failed${output ? `: ${output.slice(0, 240)}` : ''}`,
  };
  return HIMALAYA_STATUS_CACHE;
}

function himalayaOk() {
  return himalayaStatus().ok;
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

export function classify(body, subject) {
  const text = `${subject} ${body}`.toLowerCase();
  const subj = String(subject || '').toLowerCase();

  if (/unfortunately|not moving forward|will not be moving|no longer|regret to inform|not been selected|decided to pursue other|not able to offer|position has been filled|won't be able to move forward/i.test(text)) return 'rejection';
  if (/pleased to offer|delighted to extend|offer letter|congratulations.*offer|position.*offered/i.test(text)) return 'offer';

  // Ignore job-alert/digest emails. They often contain words like "Ready to
  // Interview" but are not status updates for an application.
  if (/^new jobs?:/.test(subj) || /ready to interview\s+open to offers\s+closed to offers/i.test(text)) return 'other';

  const ack = /thank you for (applying|your application)|thanks for applying|application received|we(?:'|’)ve received your application|we have received|application.*submitted|your application has been submitted|on file/i.test(text);
  const conditionalInterviewBoilerplate = /if\s+(?:your qualifications align|there(?:'|’)s a match|selected|you(?:'|’)re selected|you are selected|your application is a good fit|you qualify|your profile matches)[\s\S]{0,180}\b(interview|email introduction|next steps?|reach out|be in touch|contact you|schedule)/i.test(text);

  const explicitInterview = /\binterview with\b/i.test(subj)
    || /\blet(?:'|’)s talk\b/i.test(subj)
    || /get to know you call/i.test(text)
    || /we(?:'|’)d like to move to the next step[\s\S]{0,120}\binterview/i.test(text)
    || /we would like to move to the next step[\s\S]{0,120}\binterview/i.test(text)
    || /we(?:'|’)d like to (?:schedule|speak|meet|invite)/i.test(text)
    || /we would like to (?:schedule|speak|meet|invite)/i.test(text)
    || /would like to speak/i.test(text)
    || /we have scheduled your next interview/i.test(text)
    || /sent (?:a )?(?:google meet|calendar|teams) invite/i.test(text)
    || /\b(?:phone|recruiter) screen\b/i.test(text)
    || /next steps?.{0,80}\bcall/i.test(text)
    || /meet the team|video call|\bzoom\b/i.test(text)
    || (/microsoft teams meeting/i.test(text) && /\binterview\b/i.test(text));

  if (explicitInterview && !conditionalInterviewBoilerplate) return 'interview';
  if (ack) return 'acknowledgement';
  return 'other';
}

function statusIcon(cls) {
  return { rejection: '❌', interview: '🎙️', offer: '🎉', acknowledgement: '📨' }[cls] || '  ';
}

export function updateJobStatus(ymlPath, newStatus, detail, state) {
  const raw = fs.readFileSync(ymlPath, 'utf8');
  const job = yaml.parse(raw);
  const now = new Date().toISOString();
  if (newStatus) {
    job.status = newStatus;
    job.status_detail = detail;
  }
  // Persist the outcome funnel fields. `state` already has manual values preserved
  // (foldMatchesIntoJob/the lib guarantee it), so this write can't drop a manual flag.
  if (state) {
    if (state.outcome !== null && state.outcome !== undefined) {
      job.outcome = state.outcome;
      job.outcome_source = state.outcome_source || 'email';
    }
    job.furthest_stage = state.furthest_stage;
    job.furthest_stage_source = state.furthest_stage_source || (state.furthest_stage !== 'none' ? 'email' : null);
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
  const seenSubjects = new Set();

  // Try 2 variants: exact, lowercase
  for (const variant of [companyName, companyName.toLowerCase()]) {
    if (results.length >= 5) break;
    try {
      const r = runHimalaya([
        'envelope', 'list', '--folder', 'INBOX', '--page-size', '200', '-o', 'json',
        variant,
      ], { timeout: 30000 });
      if (r.status !== 0) continue;

      for (const e of parseMaybeJson(r.stdout) || []) {
        const id = String(e.id || '');
        const subject = e.subject || '';
        const from = e.from ? `${e.from.name || ''} <${e.from.addr || ''}>` : '';
        const date = e.date || '';
        if (!id) continue;
        if (!(subject + from).toLowerCase().includes(companyName.toLowerCase())) continue;
        if (seenSubjects.has(subject)) continue;
        seenSubjects.add(subject);

        let body = '';
        try {
          const br = runHimalaya(['message', 'read', id], { maxBuffer: 2 * 1024 * 1024, timeout: 15000 });
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
  return [];
}

// ── MAIN ──
function main() {
  const gapiOk = gapiAuthOk();
  if (!gapiOk) {
    console.log(`Gmail not reachable: GAPI token missing/invalid. Exit clean.`);
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
      // Fold the full set of emails into the job's outcome state (high-water mark +
      // latest terminal outcome), preserving any manual fields, then derive the
      // back-compat forward status from the result.
      const jobYml = yaml.parse(fs.readFileSync(job.ymlPath, 'utf8'));
      const before = jobOutcomeState(jobYml);
      const state = foldMatchesIntoJob(jobYml, matches);
      const actionable = [...matches]
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        .reverse()
        .find(m => ['rejection', 'interview', 'offer'].includes(m.classification));
      if (actionable) {
        updateJobStatus(job.ymlPath, deriveStatus(state), `${actionable.classification}: ${actionable.subject} (${actionable.date})`, state);
        if (JSON.stringify(before) !== JSON.stringify(state)) updated++;
      } else {
        const ack = matches.find(m => m.classification === 'acknowledgement');
        const detail = ack ? `acknowledged: ${ack.subject.slice(0, 80)}` : 'silent';
        updateJobStatus(job.ymlPath, null, detail, state);
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

// ── pure helpers (exported for tests) ──

// Read a job's persisted outcome fields into the canonical four-field state.
export function jobOutcomeState(job) {
  return normalizeState({
    outcome: job?.outcome,
    furthest_stage: job?.furthest_stage,
    outcome_source: job?.outcome_source,
    furthest_stage_source: job?.furthest_stage_source,
  });
}

// Fold every classified email (oldest→newest) into the job's outcome state so the
// high-water mark builds up and the latest terminal email wins the outcome. Manual
// fields are never clobbered (the lib enforces that).
export function foldMatchesIntoJob(job, matches) {
  const ordered = [...(matches || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  let state = jobOutcomeState(job);
  for (const m of ordered) {
    state = foldEmailSignal(state, emailSignals(m.classification, `${m.subject || ''} ${m.snippet || ''}`));
  }
  return state;
}

if (path.resolve(process.argv[1] || '') === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
