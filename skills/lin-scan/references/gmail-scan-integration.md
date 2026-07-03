# Gmail scan integration for Lin

Use this reference when adding or running a Lin email-discovery mode such as `lin gmailscan`.

## Purpose

`gmailscan` should discover job-search signals from Gmail and feed them into Lin's normal pipeline rather than creating a separate workflow.

Target flow:

1. Gmail search finds job-alert, recruiter, application, and interview-related emails.
2. Extract job URLs, company names, role titles, and source email metadata.
3. Add newly discovered job URLs to `data/pipeline.md` in the same format used by `lin scan`.
4. Optionally tag/record application confirmations and interview invites for tracker/follow-up automation.
5. Continue through the normal `score -> prepare -> apply` stages.

## Auth prerequisite

Prefer the existing `google-workspace` skill for Gmail + Calendar access.

For Lin's use case, request only the needed scopes:

```bash
GSETUP="python ${HERMES_HOME:-$HOME/.hermes}/skills/productivity/google-workspace/scripts/setup.py"
$GSETUP --check
$GSETUP --auth-url --services email,calendar --format json
$GSETUP --auth-code "PASTED_REDIRECT_URL_OR_CODE" --format json
$GSETUP --check
```

If `--check` is not authenticated, guide the user through creating a Google Cloud Desktop OAuth client and downloading the client secret JSON. Do not claim Gmail scanning is ready until `AUTHENTICATED` is verified.

## Suggested Gmail queries

Start conservative; relevance beats volume.

```text
newer_than:14d (subject:(job OR career OR application OR interview OR recruiter) OR from:(linkedin.com OR greenhouse.io OR lever.co OR ashbyhq.com OR workday.com OR smartrecruiters.com))
newer_than:30d ("thanks for applying" OR "application received" OR "your application" OR "interview" OR "recruiter")
newer_than:30d ("LinkedIn Job Alert" OR "new jobs" OR "jobs for you")
```

## Output rules

- Deduplicate by canonical URL and by company + title when URL tracking links differ.
- Preserve email source metadata: Gmail message id, date, sender, subject, and snippet.
- Never mark a job as applied only because a job alert exists.
- Application confirmations may update status only when the email clearly says the user's application was received/submitted.
- Calendar/interview signals should be surfaced for review before creating or modifying events.

## Implementation shape

The deterministic helper is now implemented:

```bash
node scripts/lin-gmailscan.mjs
```

Expected behavior:
- Reads Gmail enablement/queries from `career-profile/scan-channels.json`.
- Reads the cap from `career-profile/pipeline-config.json` (`daily.scan_gmail_cap`; default 50).
- Verifies Google Workspace auth with the profile-scoped `google-workspace` setup script.
- If unauthenticated, prints an OAuth setup hint and exits cleanly without fabricating results.
- Runs only the configured Gmail queries, extracts job URLs + light metadata, and writes candidate JSON.
- Calls the shared deterministic append helper:
  ```bash
  node scripts/lin-discovery-append.mjs --source gmail --file /tmp/lin-gmail-candidates.json
  ```
- Refreshes the dashboard with `node scripts/lin-tracker.mjs`.

The helper stores URL/company/role/sender-domain/date/confidence only. It must not store full email bodies, mark jobs applied, or create calendar events.

## Applied-jobs status-scan workflow

When the user asks to check for status updates on applied jobs:

**Backend:** This profile uses **himalaya** (not the Google Workspace API) for Gmail access. The `himalaya` skill is at `email/himalaya/SKILL.md`. The lin profile sandboxes $HOME, so ALL himalaya commands need `HOME=~` prefix.

```bash
HOME=~ himalaya envelope list --folder "INBOX" --page-size 200 --max-width 400
```

**Scan strategy:**
1. First, identify all applied jobs: `grep -l 'status: applied' companies/*/jobs/*/job.yml`
2. Search Gmail for status keywords across the inbox and [Gmail]/All Mail:
   - Interview signals: `interv|schedule|phone screen|next step|pleased to|delighted|congratulations`
   - Rejection signals: `unfortunately|not moving|no longer|will not be|position has been|regret to inform|not selected`
   - Offer signals: `offer letter|pleased to offer|compensation|start date`
3. Search by company domain for direct matches: `@company.com`
4. Read any hit messages fully with `HOME=~ himalaya message read <ID>`

**Status mapping to lin:**
| Email signal | job.yml update |
|---|---|
| Interview invitation / phone screen scheduled | `status: interviewing`, `status_detail: "<type> scheduled <date>"` |
| Rejection / position filled / not selected | `status: closed`, `status_detail: "rejected: <reason snippet>"` |
| Offer letter / verbal offer | `status: offer`, `status_detail: "<company> offer received <date>"` |
| Auto-acknowledgement from Greenhouse/Lever | No update (already tracked as `applied`) |

**After updating:** append to `status-history.md`, run `node scripts/lin-tracker.mjs` to refresh the dashboard.

**Pitfalls:**
- Most application acknowledgements come from Greenhouse/Lever no-reply addresses — these are NOT status changes, just confirmations.
- Status updates often take 1-4 weeks after applying. Silence after 1-6 days is normal.
- Check `[Gmail]/All Mail` in addition to INBOX — updates can land in promotions or other tabs.
- The `Lin` folder exists as a Gmail label but is usually empty — don't rely on it for filtering.
