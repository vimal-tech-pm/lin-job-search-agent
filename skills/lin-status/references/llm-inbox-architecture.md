# LLM-Driven Inbox Scanner Architecture (DEPLOYED)

**Status as of 2026-06-24:** Deployed into the active `lin-status` cron. The duplicate standalone cron `81ca02ebe5b3` and old Daily Follow-Up Digest `f050366cceb4` are paused. The active cron is `lin-status`, scheduled `0 8,12,16,20 * * *`, and it runs the Python plumbing script plus LLM classification.

## Design principle: split plumbing from intelligence

The old system was a monolithic Node.js script that did everything: GAPI calls, regex classification, job.yml updates, digest formatting. Regex classification is brittle — it misses soft rejections, unexpected phrasings, and can't understand context.

The new system splits the work:

1. **Python script** (`scripts/llm-inbox-scan.py`) — deterministic plumbing: GAPI calls, company list extraction, email body fetching, company matching, calendar events. Outputs JSON. No classification logic.
2. **LLM agent** (the cron prompt) — intelligence: reads full email bodies, classifies with context, extracts action items, updates job.yml, formats digest. No GAPI calls directly.

This means the LLM never wastes tokens on GAPI plumbing — it gets pre-fetched JSON and can focus entirely on understanding and classification.

## Python script: `scripts/llm-inbox-scan.py`

### Path
`~/.hermes/profiles/lin/lin/scripts/llm-inbox-scan.py`

### Dependencies (all via `uv run --with`)
- `google-api-python-client`, `google-auth-oauthlib`, `google-auth-httplib2` — GAPI
- `pyyaml` — reading job.yml
- `pytz` — timezone for calendar events

### What it does
1. Checks GAPI auth via `setup.py --check` (with `HOME=~` override)
2. Loads all `status: applied` companies from `companies/*/jobs/*/job.yml`
3. Runs Gmail searches:
   - Broad catch-all: `newer_than:{since}d` (default 7)
   - Targeted: interview/schedule keywords, rejection keywords, assessment keywords, offer keywords
4. Deduplicates by message ID, excludes SENT/DRAFT emails
5. Matches emails to companies by substring on display name + slug
6. Fetches full email bodies via `gmail get MESSAGE_ID` (capped at 1500 chars per email, top 60 matched + 15 unmatched ATS emails)
7. Fetches today+tomorrow Google Calendar events
8. Outputs JSON to stdout

### JSON output schema
```json
{
  "companies": [{"slug", "name", "role", "status", "applied_at", "yml_path", "furthest_stage", "outcome", "outcome_source", "status_detail", "last_email_status"}],
  "all_companies": [{"slug", "name", "status"}],
  "emails": [{"id", "from", "subject", "date", "snippet", "labels", "body", "company_match", "company_slug", "candidate_jobs"}],
  "calendar_events": [{"id", "summary", "start", "end", "location"}],
  "stats": {"companies_count", "emails_fetched", "matched_emails", "unmatched_job_emails", "errors"}
}
```

**Context diet (2026-06-27):** `companies[]` only includes companies that matched at least one email (typically 5-15 out of 184+). The full list is in `all_companies[]` as lightweight `{slug, name, status}` references. This reduced JSON output from ~286KB to ~164KB (measured), fixing the `Broken pipe` cron failures. The remaining size is dominated by 64+ email bodies (1500 chars each). If further diet is needed, reduce `--max-emails` or lower the body cap.

### Key constants
- `REAL_HOME = "~"` — overrides profile cron HOME injection for all GAPI subprocess calls
- `GAPI_SCRIPT` — hardcoded absolute path (not `Path.home()`) to avoid profile home resolution issues
- Body cap: 1500 chars per email (was 3000, reduced 2026-06-27 for context diet)
- Fetch cap: 60 matched + 15 unmatched emails with full bodies
- `companies[]` only includes matched companies; `all_companies[]` has lightweight references for all

### Running manually
```bash
cd ~/.hermes/profiles/lin/lin && \
HOME=~ uv run --with google-api-python-client --with google-auth-oauthlib \
  --with google-auth-httplib2 --with pyyaml --with pytz \
  python scripts/llm-inbox-scan.py --since 7 --max-emails 80
```

In cron context, `HOME=` is not needed in the command line because the script sets `REAL_HOME` internally. But it doesn't hurt.

## LLM cron prompt: job `81ca02ebe5b3`

The cron prompt is self-contained — it tells the LLM to:
1. Run the Python script
2. Parse JSON
3. Classify each email (rejection/interview/offer/assessment/acknowledgement/recruiter_outreach/other)
4. Check calendar for today/tomorrow interviews
5. Update job.yml files (rejection→closed, interview→interviewing, offer→offer)
6. Append to status-history.md
7. Refresh the tracker (`node scripts/lin-tracker.mjs`)
8. Format and deliver Telegram digest
9. Save digest to `~/lin/email-digest/{date}.md`

## Cron configuration

**Note:** The cron config below describes the old standalone `81ca02ebe5b3` job. The **active** cron is `lin-status` (see SKILL.md). This section is kept for historical context only.

- **Job ID:** `81ca02ebe5b3` (PAUSED — replaced by `lin-status`)
- **Name:** `📬 Lin inbox (LLM)`
- **Schedule:** `50 6,20 * * *` (6:50am and 8:50pm ET)
- **Model:** `deepseek-v4-flash` via `opencode-go`
- **Toolsets:** `terminal`, `file` (no browser, no web — just file ops and terminal for GAPI)
- **Deliver:** `telegram` (home channel)
- **Workdir:** `~/.hermes/profiles/lin/lin`

## Paused jobs (replaced by this)

| Job ID | Name | Why paused |
|--------|------|-----------|
| `lin-status` | 📬 Lin status (no_agent) | Regex-based, replaced by LLM classification |
| `f050366cceb4` | Job Follow-Up Digest | Gmail+Calendar sweep integrated into new cron |

## Closed-job inclusion and the PyYAML datetime trap

**Status as of 2026-06-26:** Fixed. The fix and the full failure chain are documented here because this was a subtle two-bug interaction that caused Semperis (and 21 other recently-closed jobs) to become invisible to the LLM classifier.

### The closed-job inclusion logic

`load_tracked_applications()` in `llm-inbox-scan.py` loads:
- All jobs with `status` in `{applied, interviewing, offer}` (always)
- Jobs with `status: closed` ONLY if `applied_at` or `last_email_check` is within `since_days * 4` (default 28 days) of now

This cutoff window prevents stale closed jobs from bloating the JSON payload. But it also means a recently-closed job with a stale or unparseable timestamp gets dropped.

### Bug: PyYAML auto-parses ISO timestamps to datetime objects

`yaml.safe_load()` parses ISO 8601 timestamps like `last_email_check: 2026-06-20T21:09:38.603Z` into `datetime.datetime` objects — NOT strings. The original code did:

```python
ts_str = le.replace("Z", "+00:00")  # le is a datetime, not a string → TypeError
```

`datetime.replace("Z", "+00:00")` raises `TypeError: 'str' object cannot be interpreted as an integer` (it tries to interpret the string args as positional integer indices for `replace(year, month, ...)`). The `except (ValueError, AttributeError)` clause did NOT catch `TypeError`. The outer bare `except:` at line 151 swallowed it, setting `include = False`.

**Fix applied:**
```python
ts = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
# + catch TypeError in the except clause
```

### The Semperis chain

1. **12:08 PM cron** — Semperis rejection email arrives. The 12pm run's JSON still had Semperis in `companies[]` (the `last_email_check` hadn't been written yet, so the old value was a plain string). LLM correctly closed it: `status: closed, outcome: rejected, furthest_stage: interviewing`.
2. The cron agent wrote `last_email_check: 2026-06-20T21:09:38.603Z` to job.yml. From this point, PyYAML would parse it as a `datetime`.
3. **4:00 PM cron** — `llm-inbox-scan.py` tried to load Semperis. `last_email_check` was now a `datetime` → `TypeError` → Semperis dropped from `companies[]`. The Semperis rejection email had `candidate_jobs: null`. LLM reported "untracked" — a false positive that confused the user.

### Bug: furthest_stage: closed corruption

The 4PM cron LLM agent also wrote `furthest_stage: closed` for Hopper and MaintainX. `closed` is a STATUS, not a STAGE. `normalizeStage('closed')` floors to `none`, erasing the high-water mark. The funnel almost lost two applied jobs from the count.

**Root cause:** The cron prompt said "rejection → set status: closed" — the LLM extrapolated that `furthest_stage` should also be `closed`. It doesn't understand that `furthest_stage` is a monotonic high-water mark that a rejection doesn't erase.

**Fix:** The cron prompt's step 5 must explicitly say: "DO NOT touch `furthest_stage` when closing a rejection. It is a monotonic high-water mark — a rejection after interviews keeps `furthest_stage: interviewing`, a rejection after applying keeps `furthest_stage: applied`."

### Verification

After the fix, 22 closed jobs with datetime-valued `last_email_check` are now correctly loaded into `companies[]`. The LLM classifier can see them and will treat repeat rejection emails as "already tracked" instead of "untracked."


The old `lin-status` cron was `no_agent: true` — it ran a shell script with no LLM. This is fine for deterministic tasks but email classification requires understanding context. By making it an agent-driven cron, the LLM can:
- Distinguish "Thank you for your interest" (acknowledgement) from "Thank you for your interest... we've decided not to move forward" (rejection)
- Extract action items like "reply by Friday to schedule interview"
- Recognize false matches (banking alerts from Scotiabank ≠ job application status)
- Generate natural-language follow-up suggestions

The tradeoff: agent cron uses tokens (deepseek-v4-flash is cheap) and takes longer (~2-3 min vs ~30s for the script). Worth it for classification quality.
