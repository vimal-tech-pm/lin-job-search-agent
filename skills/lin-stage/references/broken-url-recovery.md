# Broken URL Recovery for Stage Candidates

Some evaluation queue rows carry `source_url: "about:link-NNN"` — fabricated placeholder
URLs that cannot be verified. Before giving up on a candidate, try recovery.

## Recovery steps

1. Search for the eval file: `jd_eval_{ID}.json` in the vault root (`~/.hermes/profiles/lin/lin/`).
2. If found, extract the real URL:
   ```bash
   python3 -c "import json; d=json.load(open('jd_eval_{ID}.json')); print(d.get('source_url','') or d.get('url',''))"
   ```
3. Also search `jds/{ID}-*.md` — the JD snapshot filename sometimes carries the company name.
4. If no jd_eval file AND no jds file exist, the URL is truly unrecoverable — mark as `uncertain`.

## Root cause (diagnosed 2026-06-19)

The placeholder URLs are NOT a scanner bug — they are a **dead LinkedIn session** symptom chain:

1. LinkedIn cookie refresh cron (`lin-linkedin-cookie-refresh`) has `last_run_at: null` — it never fired. Weekly schedule + gateway restart = missed slot.
2. LinkedIn session expires in 24–48h. After 5–6 days with no refresh, `li_at` cookie is stale.
3. Health check (`linkedin_cookie_refresh.py` line 190) reports `authenticated: true` because it checks cookie *presence*, not *validity* — expired `li_at` still exists in the Chrome profile.
4. Scan cron trusts the health file and runs with a dead session.
5. LinkedIn shows the authwall. `browser_snapshot` returns only the 15-element sign-in dialog — job cards are invisible to the accessibility tree.
6. The scan agent sees partial page content (company/role names) but cannot extract `/jobs/view/<id>` URLs, so it writes `about:link-{id}` placeholders.
7. These placeholders permanently block liveness checks — 93 of 103 LinkedIn entries from the June 16 scan were lost this way.

**Scale:** 93 placeholder entries in the queue, all from a single scan day (June 16, 2026). Only 18 have `jd_eval_*.json` files with recoverable URLs. The remaining 75 are permanently stuck.

**Prevention:** See `lin-scan/references/scan-linkedin.md` § "Critical pitfalls" — daily cookie refresh schedule, health check fix, session verification before scanning, and `browser_console` URL extraction.

## Common patterns

- **Dead LinkedIn session** (primary cause) — cookie refresh cron didn't fire → session expired → authwall → scanner can't see URLs → placeholders. Check `linkedin-session-health.json` and verify `/feed/` doesn't redirect to `/uas/login`.
- **LinkedIn scans** rewriting URLs to `about:link-NNN` — the original LinkedIn URL was not preserved during scan intake. The eval file may have it.
- **Duplicate scans** where the same job appears twice with different IDs — one may have the real URL.
- **Expired LinkedIn postings** auto-redirecting — the scan captured the redirect target as a placeholder.

## Prevention

1. **Cookie refresh cron must fire daily**, not weekly. LinkedIn sessions expire in 24–48h. See `lin-scan/references/scan-linkedin.md` § "Critical pitfalls".
2. **Health check must verify `/feed/` doesn't redirect**, not just cookie presence.
3. **Scanner must verify session before scanning** — navigate to `/feed/`, check for redirect.
4. **Use `browser_console` for URL extraction** — DOM has job card hrefs even behind the authwall; `browser_snapshot` does not.
5. **Never write `about:link-XXX` placeholders** — skip candidates without a real URL rather than creating unusable queue entries.
