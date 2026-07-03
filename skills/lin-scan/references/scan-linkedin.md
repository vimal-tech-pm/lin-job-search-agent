# scanLinkedIn — LinkedIn job-search browser scan

Reference for Lin's `scanLinkedIn` verb (alias `scan linkedin`). Implements the
shared **§channel-scan** contract for the `linkedin` channel.

> **Architecture rule (do not break):** the browser only *extracts candidate
> JSON*. ALL filtering, dedup, pipeline append, scan-history, and cap
> enforcement are delegated to `scripts/lin-discovery-append.mjs`. Never write to
> `data/pipeline.md` or `engines/pathfinder/data/scan-history.tsv` directly from
> this flow.

## Config

- **Enablement + search URLs:** `career-profile/scan-channels.json` → `linkedin.enabled` and `linkedin.searches[]` (`{name, url}`).
- **Cap:** `career-profile/pipeline-config.json` → `daily.scan_linkedin_cap` (default 50). Caps live ONLY here, never in `scan-channels.json`.

## Steps

1. **Cap precheck.** Read `daily.scan_linkedin_cap`. If `≤ 0`, log `linkedin: scan skipped (cap 0)` and stop.
2. **CDP precheck.** A logged-in LinkedIn session is required. Check `http://localhost:9222/json/version` (or navigate a simple page). If unreachable → print `scan skipped — browser login required`, **exit 0** (do not crash), append zero rows.
3. **Scan each enabled search** in `linkedin.searches[]`, **sequentially in a single browser session** (no Playwright, no parallel tabs):
   - `browser_navigate(search.url)` → `browser_snapshot`.
   - Extract one candidate per job card: **title**, **company**, **job URL** (`https://www.linkedin.com/jobs/view/<id>`), and the numeric **job id**.
   - Paginate (scroll / next page) until you reach the cap or run out of results. Stop at `daily.scan_linkedin_cap` candidates across all searches.
   - **Best-effort per search URL:** a navigation/extraction error on one search logs a warning and continues to the next; it is non-fatal.
4. **Emit candidate JSON only** — an array of:
   ```json
   [{ "company":"Acme","role":"Senior Product Manager",
      "url":"https://www.linkedin.com/jobs/view/3xxxxxxxxx",
      "source":"linkedin","source_query":"Senior PM — Remote Canada",
      "source_item_id":"3xxxxxxxxx","seen_at":"2026-06-04T…Z",
      "posted_date":"2026-06-02",
      "confidence":"high","notes":"" }]
   ```
   Write it to a temp file, e.g. `/tmp/lin-linkedin-candidates.json`. (LinkedIn shows "Posted N days/weeks ago" near the title — convert to an ISO `posted_date`; omit when absent.)
5. **Funnel through the deterministic helper:**
   ```
   node scripts/lin-discovery-append.mjs --source linkedin --file /tmp/lin-linkedin-candidates.json
   ```
   It applies `title_filter` (from `portals.yml`), canonicalizes the URL
   (`/jobs/view/<id>`), dedups by canonical-URL and canonical-key (cross-source
   duplicates are kept + cross-linked with `dup_of=`), appends to
   `data/pipeline.md` as `- [ ] DATE | Company | Role | URL | src=linkedin`,
   writes the 9-column `scan-history.tsv`, enforces the cap, and prints a digest
   like `linkedin: +5 new, 2 dupes (1 cross-source), 3 filtered`.
6. **Refresh the dashboard:** `node scripts/lin-tracker.mjs`.

## Authentication / cookie refresh

LinkedIn scans reuse Lin's persistent Chrome/CDP profile:

```text
~/.hermes/profiles/lin/chrome-cdp
```

That profile is kept authenticated by a separate no-agent cron job:

| Field | Value |
|---|---|
| Job ID | `lin-linkedin-cookie-refresh` |
| Schedule | `0 7,19 * * *` — **daily** 7 AM + 7 PM ET (was weekly `0 19 * * 0`) |
| Mode | `no_agent: true` |
| Script | `~/.hermes/profiles/lin/scripts/linkedin_cookie_refresh.sh` |
| Python implementation | `~/.hermes/profiles/lin/scripts/linkedin_cookie_refresh.py` |
| Credential file | `~/.hermes/credentials/linkedin.asc` |
| Health file | `~/.hermes/profiles/lin/lin/data/linkedin-session-health.json` |

Design:

1. Start visible Chrome with CDP on `127.0.0.1:9222` using the shared Lin profile.
2. Navigate to `https://www.linkedin.com/feed/` and check whether the session is already authenticated.
3. Only if not authenticated, decrypt `~/.hermes/credentials/linkedin.asc` locally via GPG.
4. Fill the LinkedIn login form via CDP.
5. Validate real authenticated state before success: `/feed/` or `/jobs/` plus LinkedIn session cookies (`li_at`, `JSESSIONID`).
6. Write only non-secret health metadata. Do not print the email/password and do not write raw cookies to reports.

### Critical pitfalls (discovered 2026-06-19)

**1. Weekly schedule is too infrequent.** LinkedIn sessions expire in 24–48 hours. A weekly refresh (`0 19 * * 0`) leaves the session dead for 5–6 days per week. The fix is daily (`0 7,19 * * *`).

**2. Weekly jobs skip slots after gateway restarts.** If the Hermes gateway restarts between the job creation and the next scheduled slot (e.g. job created Saturday, gateway restarts Monday, next Sunday is 6 days away), `next_run_at` jumps forward and `last_run_at` stays `null` indefinitely. Observed: `lin-linkedin-cookie-refresh` created Jun 15 (Saturday), gateway restarted Jun 17 (Monday), first scheduled run Jun 21 — 6 days with a dead session. Daily schedule eliminates this window.

**3. Health check false positives.** `linkedin_cookie_refresh.py` line 190 checks `bool(cookies.get("li_at"))` for authentication, but an expired `li_at` cookie still exists in the Chrome profile — LinkedIn rejects it but the health check reports `authenticated: true`. The health file (`linkedin-session-health.json`) then lies, and the scan cron trusts it and runs with a dead session, producing `about:link-XXX` placeholders.

   **Fix:** The health check must navigate to `/feed/` and verify the URL does NOT redirect to `/uas/login`. Cookie string presence is necessary but not sufficient. The `current_state()` function should check:
   ```python
   # BAD: expired cookie still returns True
   authenticated = bool(cookies.get("li_at")) or "/feed" in url

   # GOOD: verify no redirect to login
   authenticated = "/feed" in url and "/uas/login" not in url
   ```

**4. Scanner must verify session before scanning.** The CDP precheck (step 2 of the scan workflow) only checks if Chrome is reachable on port 9222 — not if the LinkedIn session is alive. A dead session with CDP running produces `about:link-XXX` placeholders silently. Before scanning, navigate to `https://www.linkedin.com/feed/` and check for redirect to `/uas/login`. If redirected, log `linkedin: scan skipped — session expired (run linkedin_cookie_refresh.sh)` and exit 0.

Manual commands:

```bash
# Create/update encrypted credentials locally; avoids shell-history password leaks.
~/.hermes/scripts/setup_gpg_login_credentials.sh linkedin

# Run the weekly refresh manually.
~/.hermes/profiles/lin/scripts/linkedin_cookie_refresh.sh

# Check health without exposing secrets.
cat ~/.hermes/profiles/lin/lin/data/linkedin-session-health.json
```

If LinkedIn shows CAPTCHA/checkpoint/2FA, the script exits nonzero and records `status: challenge`. Complete the challenge in the visible browser, then rerun the script. Do not attempt to bypass LinkedIn verification.

Security boundary: credentials stay out of the LLM in the normal path because the refresh is no-agent and decryption happens inside the script process. This is not a hard sandbox against an LLM tool call running as the same Linux user; keep decryption only in no-agent scripts.

## Critical: URL extraction via browser_console (not browser_snapshot)

LinkedIn job search pages render job cards in the DOM even when the accessibility
tree is blocked by the "Sign in to view more jobs" authwall dialog. `browser_snapshot`
returns only the 15 sign-in dialog elements — job cards are invisible to it. When the
cron agent relies on `browser_snapshot` for extraction, it sees company/role text from
the partial page render but cannot get the `/jobs/view/<id>` links, so it fabricates
`about:link-{queue_id}` placeholders. These placeholders permanently block liveness
checks downstream — 93 entries were lost this way on June 16, 2026.

**Always use `browser_console` for LinkedIn URL extraction**, not `browser_snapshot`:

```javascript
// browser_console expression — extracts job cards from DOM even behind authwall
(function() {
  var cards = document.querySelectorAll('[data-entity-urn], .job-card-container, .jobs-search__results-list li, .occludable-card');
  var results = [];
  cards.forEach(function(card) {
    var urn = card.getAttribute('data-entity-urn') || '';
    var link = card.querySelector('a[href*="/jobs/view/"]');
    var href = link ? link.href : '';
    // Strip query params to get canonical URL
    var cleanUrl = href ? href.split('?')[0] : '';
    var jobId = urn.match(/jobPosting:(\d+)/);
    var title = card.querySelector('.job-card-list__title, [class*="title"]')?.textContent?.trim() || '';
    var company = card.querySelector('.job-card-container__company-name, [class*="company"]')?.textContent?.trim() || '';
    if (cleanUrl && title) {
      results.push({url: cleanUrl, job_id: jobId ? jobId[1] : '', title: title, company: company});
    }
  });
  return JSON.stringify(results);
})()
```

This returns a JSON array of `{url, job_id, title, company}` even when the authwall is
showing. The cron agent should use this expression via `browser_console` (with
`expression` parameter) instead of `browser_snapshot` for LinkedIn scans.

If `browser_console` returns an empty array AND `browser_snapshot` shows only the
sign-in dialog, the session may be fully logged out — skip the search and log a warning.

## Notes

- Source vocabulary in data is lowercase: write `src=linkedin`. `scanLinkedIn` is a verb alias only — never written into data.
- Discovery only — never score/prepare/apply here. Later stages handle the pending `- [ ]` rows.
- **Never write `about:link-XXX` placeholders** — if you cannot extract a real URL from the page, skip the candidate entirely. A candidate without a URL is useless — it will never pass liveness checks and permanently stalls in the queue. Use the `browser_console` extraction above; if it returns empty, the search is skipped (0 new), not filled with placeholders.
