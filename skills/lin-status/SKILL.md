---
name: lin-status
description: Lin applied-job maintenance — Gmail/Outlook status checks (rejections, interviews, offers) auto-applied to job.yml, and stale-application follow-up drafts. NOT discovery. Part of the Lin pipeline.
user_invocable: true
args: verb
argument-hint: "[check | followups | outlook | describe]"
---

# lin-status — applied-job maintenance

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§8 digest, §10 never-send rule). **Maintenance, not discovery** — never feed results into `data/pipeline.md` or the evaluation queue; writes go to `job.yml` + `status-history.md` only. Discovery is `lin-scan gmail`.

## Verbs

- `check` (the cron verb) — Gmail status scan for applied jobs.
- `followups` — stale-application nudge drafts (its own paused cron).
- `outlook` — manual Outlook inbox check (browser-based).
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## `check` — Gmail status scan

**Cutover completed 2026-06-24:** The cron is now LLM-driven (no_agent=false). The old no_agent script `lin-status-digest.sh` is retired. The `f050366cceb4` Daily Follow-Up Digest is paused — its Gmail+Calendar sweep is now integrated into this cron. The `uv run` fix and GAPI token symlink from the no_agent era are still in place and used by the Python plumbing script.

### Active system: LLM-driven cron

**Cron job ID:** `lin-status` (name: "📬 Lin status")
**Schedule:** `0 8,12,16,20 * * *` (8am, noon, 4pm, 8pm ET)
**Mode:** `no_agent=false` (LLM agent, deepseek-v4-flash via opencode-go)
**Toolsets:** `terminal`, `file`
**Workdir:** `~/.hermes/profiles/lin/lin`

The LLM agent runs the Python plumbing script (`scripts/llm-inbox-scan.py`) which fetches Gmail + Calendar data as JSON. The LLM then classifies emails using full context, updates job.yml files, and delivers a Telegram digest. See `references/llm-inbox-architecture.md` for the full design.

### Running manually

```bash
# Run the plumbing script (outputs JSON)
cd ~/.hermes/profiles/lin/lin && \
  HOME=~ uv run --with google-api-python-client --with google-auth-oauthlib \
  --with google-auth-httplib2 --with pyyaml --with pytz \
  python scripts/llm-inbox-scan.py --since 7 --max-emails 80
```

The LLM cron then classifies the JSON output, updates job.yml, and delivers the digest.

## `followups` — stale-application drafts

Walk `companies/*/jobs/*/job.yml` for `status: applied` with `applied_at` > 7 days and no later status-history row. Oldest first, cap 5 per run. Per flagged entry: write `companies/{co}/jobs/{slug}/follow-up-draft.md` — subject + 4–6 sentence polite check-in referencing the role and application date; address the recruiter by name if known in `companies/{co}/linkedin-contacts.md`, else generic. **Never auto-send; never change job.yml status.** The user reviews and sends manually.

## `outlook` — manual Outlook check (browser)

Prereq: CDP browser running with Outlook logged in. List applied jobs (all active statuses: applied, interviewing, final), `browser_navigate("https://outlook.live.com/mail/0/")`, then use CDP `Target.getTargets` to find the page target titled 'Inbox - <name>' (Outlook spawns multiple page targets; browser_navigate may land on the wrong one with an empty message list). Use CDP `Runtime.evaluate` with that target_id for all text extraction and search — browser_console/browser_snapshot return empty or incomplete on the Outlook SPA. Search via native input value setter + event dispatch (browser_type doesn't work). See `references/outlook-cdp-status-check.md` for the full workflow, search terms, and pitfalls.

## Digest (Telegram)

`check` (LLM-driven active cron):
```
📬 Lin status — {YYYY-MM-DD}
🎙️ INTERVIEW: {Company} — {role}            ← first, if any
🎉 OFFER: {Company} — {role}                 ← first, if any
❌ rejected: {Company} ({n} total closed)
checked {N} applied · updated {M} · acknowledgements skipped {K}
```
No applied jobs or zero signals: one line `📬 Lin status — {date}: {N} checked, no changes.` Gmail unreachable: `📬 Gmail not reachable — GAPI token missing/invalid.`

`check` (expanded LLM digest format):
```
📬 Lin inbox — {YYYY-MM-DD}
🗓️ TODAY: {Company} — {Role} | {Time} | {Format} | {Link}
🗓️ TOMORROW: {Company} — {Role} | {Time} | {Format}

🎙️ INTERVIEWS:
• {Company} — {Role} — {Action needed} — {Recruiter name/email if known}

📝 ASSESSMENTS:
• {Company} — {Role} — {Task} — Due {deadline}

🎉 OFFERS:
• {Company} — {Role} — {Details}

❌ REJECTIONS:
• {Company} — {Role}

🔎 RECRUITER OUTREACH:
• {Sender} — {Company} — {Role mentioned}

Summary: {N} companies · {X} emails scanned · {R} rejections · {I} interviews · {A} assessments · {O} offers · {K} acknowledgements skipped
```
Omit empty sections. No actionable signals: `📬 Lin inbox — {date}: {N} companies checked, {X} emails scanned, no actionable signals.`

`followups`: `🔁 Lin follow-up nudge — {N} stale apps` + per entry `• {Company} — {role} (applied {n}d ago) — draft at {path}`. N=0 → silent.

## Related: old duplicate inbox jobs

The old Daily Follow-Up Digest cron (`f050366cceb4`) is **paused**. The standalone planned LLM inbox cron (`81ca02ebe5b3`) is also **paused**. Their Gmail+Calendar sweep is now consolidated into the active `lin-status` cron.

**⚠️ Critical lesson from 2026-06-22:** A daily scan MUST check both Gmail and Calendar. Two of three interviews today existed only in Calendar, not in Gmail search results. The user corrected: "Did you search emails and calendar properly. There are three."

**⚠️ Critical lesson from 2026-06-24:** The scanner must include already-closed email outcomes in its JSON context. Otherwise a later run sees new copies of known rejection emails but not the matching closed job, and the LLM mislabels them as "untracked." `llm-inbox-scan.py` now loads active applications plus closed/rejected email outcomes and emits `candidate_jobs` per email. The cron prompt must treat `status=closed/outcome=rejected` matches as already tracked, not untracked.

**⚠️ Critical lesson from 2026-06-26 (furthest_stage corruption):** The cron prompt's step 5 says "rejection → set status: closed, outcome: rejected." The LLM cron agent extrapolated this to also write `furthest_stage: closed` — but `closed` is a STATUS, not a STAGE. STAGES = `['none', 'applied', 'interviewing', 'final', 'offer']`. `normalizeStage('closed')` floors to `none`, silently erasing the high-water mark in the funnel. The cron prompt MUST explicitly say: "DO NOT touch `furthest_stage` when closing a rejection. It is a monotonic high-water mark — a rejection after interviews keeps `furthest_stage: interviewing`, a rejection after applying keeps `furthest_stage: applied`." See `references/llm-inbox-architecture.md` § "Closed-job inclusion and the PyYAML datetime trap" for the full chain of how this combined with the datetime bug to make Semperis invisible.

**⚠️ Critical lesson from 2026-06-26 (PyYAML datetime trap):** `yaml.safe_load()` auto-parses ISO 8601 timestamps like `last_email_check: 2026-06-20T21:09:38.603Z` into `datetime.datetime` objects, NOT strings. `llm-inbox-scan.py` called `ts_str.replace("Z", "+00:00")` on the datetime → `TypeError` (not caught by `except (ValueError, AttributeError)`) → 22 recently-closed jobs silently dropped from `companies[]` → LLM classifier blind to them → Semperis rejection misclassified as "untracked." Fix: `str(ts_str).replace(...)` + catch `TypeError`. See `references/llm-inbox-architecture.md` § "Closed-job inclusion and the PyYAML datetime trap."

**Scanner matching fixes from 2026-06-24:** Gmail combined OR queries were unreliable for rejection phrases, so `llm-inbox-scan.py` uses a small set of simple high-signal Gmail queries (`other candidates`, `thank you for your interest`, `thanks for your interest`, etc.). It tags signal-query hits, fetches unmatched signal emails, parses RFC2822 dates before sorting, and fetches up to 60 matched + 15 unmatched bodies. This caught Intellistack (`from: Intellistack`, subject did not include company) after the old broad/window logic missed it. Generic terms like `remote` are excluded from automatic company matching to avoid writing Luxury Presence/Jerry/Yelp emails onto Remote.com.

## Gotchas

- **Profile cron HOME override required for GAPI** — the Hermes cron scheduler injects `HOME=$HERMES_HOME/home` (i.e. `~/.hermes/profiles/lin/home`) when a profile home directory exists. But the GAPI OAuth token lives at `~/.hermes/google_token.json` (symlinked to `~/.hermes/profiles/lin/google_token.json`). Any subprocess calling `setup.py --check` or `google_api.py` must explicitly set `HOME=~` in its env. `llm-inbox-scan.py` handles this via the `REAL_HOME` constant and passes it to all subprocess calls. If you write a new script that calls GAPI from a cron context, you MUST do the same or GAPI auth will silently fail and the cron will report `last_status: ok` while checking zero emails. This is the most dangerous failure mode: a green cron status that does no work.
- **GAPI token symlink required** — `setup.py --check` resolves `TOKEN_PATH` via `get_hermes_home()` which returns the lin profile dir, but the OAuth token lives at the root profile dir. Fix: `ln -s ~/.hermes/google_token.json ~/.hermes/profiles/lin/google_token.json`. Without this symlink, GAPI always fails and the status check produces zero results.
- **System python3 has no pip/google packages** — use `uv run --with google-api-python-client --with google-auth-oauthlib --with google-auth-httplib2 python` instead of bare `python3` for all GWS script calls. This applies to both `lin-gmail-status.mjs` (old, archived) and `llm-inbox-scan.py` (new). The `llm-inbox-scan.py` script also needs `--with pyyaml --with pytz`.
- **"Thank you for your interest" is often a rejection** — many companies (especially via Ashby/Greenhouse) send rejection emails with innocuous subject lines like "Thank you for your interest in {Company}". The LLM classifier reads the full body and catches "decided not to move forward" language. The old regex classifier caught the keyword "not moving forward" but missed subtler phrasings like "we're going with another candidate" or "the position has been filled".
- **False company matches on generic names** — substring matching on company display names can produce false positives. Example: "scotiabank" as a company slug matches Scotiabank credit card alerts and banking notifications that have nothing to do with the job application. The LLM classifier should filter these by reading the email body and recognizing it's a banking alert, not an application status update. Very generic slugs like `remote` are even worse.
- **Calendar events can have duplicate entries** — the GAPI `calendar list` command may return the same event twice (seen with Zynga interviews). De-duplicate by event ID before including in the digest.
- **Default 7-day scan window may miss rejections** — `--since 7` is the default, but rejection emails often arrive 10–30 days after application. If the user says "there are rejections in Gmail" but the scan reports 0, widen the window: `--since 30`.
- **`furthest_stage` must be a STAGES value, not a status** — the LLM cron agent sometimes writes `furthest_stage: closed` (a status, not a stage). STAGES = `['none', 'applied', 'interviewing', 'final', 'offer']`. `closed` floors to `none` via `normalizeStage()`, losing the high-water mark. The cron prompt says "rejection → set status: closed, outcome: rejected" — it must NOT also set `furthest_stage: closed`. The rejection implies `applied` at minimum. For a rejection after interviews, `furthest_stage` should stay `interviewing` (the high-water mark is monotonic — a rejection doesn't erase progress).
- **PyYAML auto-parses ISO timestamps to datetime objects** — `last_email_check: 2026-06-20T21:09:38.603Z` in job.yml is loaded by `yaml.safe_load()` as a `datetime.datetime` object, NOT a string. Code that calls `.replace("Z", "+00:00")` on it raises `TypeError` (not `ValueError` or `AttributeError`). The `load_tracked_applications()` function in `llm-inbox-scan.py` must coerce with `str(ts_str)` before string operations, and catch `TypeError` in addition to `ValueError`/`AttributeError`. Without this fix, recently-closed jobs with datetime-valued `last_email_check` are silently dropped from the `companies[]` list, making the LLM classifier blind to them.
- **Broken pipe from oversized JSON output (FIXED 2026-06-27)** — the 8PM `lin-status` cron failed with `RuntimeError: [Errno 32] Broken pipe` because `llm-inbox-scan.py` output 286KB of JSON (184 companies × ~500 bytes + 75 emails × 3000-char bodies + indent=2 whitespace). The cron agent's pipe reader couldn't drain it fast enough. **Fix:** (1) `companies[]` now only includes companies that matched at least one email (typically 5-15, not all 184); all companies are in `all_companies[]` as lightweight `{slug, name, status}` references. (2) Email body cap reduced 3000→1500 chars. (3) `json.dumps()` without `indent=2` (compact). Measured output now ~164KB. Same pattern as lin-score's worklist helper fix.
- **User reports a rejection the cron missed — verify the email actually exists in Gmail first** — when the user says "why is X still interviewing, the rejection is in Gmail," run a direct Gmail search (`google_api.py gmail search "newer_than:30d <company>" --max 20`) before assuming the scanner missed it. The scanner only processes emails its signal queries surface; if the rejection email uses unusual phrasing or comes from an unexpected sender domain, it may not be in the scan window. Also check: (a) did the user apply with a different email (Outlook vs Gmail)? (b) was it a LinkedIn message, not email? (c) was it verbal at end of interview? Only after confirming the email exists and the scanner missed it should you investigate the scanner's query set.
- **Google OAuth token expiry — Testing vs Production mode** — if `setup.py --check` returns `TOKEN_REVOKED: invalid_grant: Token has been expired or revoked`, the refresh token expired. Root cause: the OAuth app is in Google Cloud "Testing" mode — refresh tokens expire after 7 days. **Fix:** (1) re-authenticate via `setup.py --auth-url` → user visits URL → pastes back code → `setup.py --auth-code "CODE"`. (2) For permanent fix: publish the app at https://console.cloud.google.com/auth/audience → "Publish App". No verification needed for personal-use apps. (3) Mobile auth: use `http://localhost` redirect (not `http://localhost:1` which hangs on mobile browsers). See `google-workspace` SKILL.md Notes section for the full mobile auth procedure.
- **Never send email without explicit confirmation** — drafts only, conventions §10 hard rule (the user was burned once; non-negotiable). This applies to the LLM cron too — if a reply is needed, note it as an action item in the digest, never auto-send.

### Historical gotchas (from the old regex-based system — no longer active but documented for context)

- **Old regex classifier (lin-gmail-status.mjs, archived)** — the `classify()` function in `lin-gmail-status.mjs` used keyword patterns to classify emails. It had regression tests in `tests/lin-gmail-status.test.mjs`. Common false positives included: Wellfound "Schedule your first interview" buttons, job-alert text like "Ready to Interview", and conditional boilerplate like "if selected, we'll schedule an interview". The LLM classifier handles all of these naturally by reading full context.
- **Old GNOME Keyring cron lock (resolved 2026-06-20)** — the original himalaya fallback used `secret-tool` which blocked indefinitely on a locked GNOME Keyring in headless cron. Removing himalaya entirely eliminated the issue.
