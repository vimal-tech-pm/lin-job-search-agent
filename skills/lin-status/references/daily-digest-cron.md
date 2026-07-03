# Daily Job Follow-Up Digest Cron

A recurring cron job that scans **Gmail + Calendar** each morning and produces a scannable digest of interviews, rejections, advances, and action items. Complementary to `lin-status check` (which is per-company maintenance) — this is the broader morning sweep.

## Cron Setup

```yaml
# Created 2026-06-22
schedule: "0 7 * * *"              # Daily at 7am ET
model: deepseek-v4-flash
provider: deepseek                  # Direct DeepSeek API (stable — avoid Crof/GLM for cron)
skills: [google-workspace]
deliver: origin                     # Telegram home channel
```

Job ID: `f050366cceb4` (name: "Job Follow-Up Digest")

## GAPI path — profile-aware alias

This cron runs under the `lin` profile. The google-workspace scripts are at the profile-specific path, NOT the root `$HOME/.hermes/skills/...` path. Use:

```bash
GAPI="python ~/.hermes/profiles/lin/skills/productivity/google-workspace/scripts/google_api.py"
```

**Pitfall:** `${HERMES_HOME:-$HOME/.hermes}/skills/productivity/...` from the google-workspace skill's docs expands to the wrong path under a named profile. The shell double-expands `$HOME` inside `${HERMES_HOME}` leading to `~/.hermes~/.hermes/skills/...`. Always use the explicit absolute path under `$HOME/.hermes/profiles/lin/`.

## Methodology — DO NOT SKIP EITHER

### 1. Gmail — Broad sweep first, then targeted

Run a **catch-all** `newer_than:3d` search first. Do NOT rely only on narrow keyword queries — you'll miss emails with unexpected subject lines. Then run targeted searches for signal keywords.

```
$GAPI gmail search "newer_than:3d" --max 100
$GAPI gmail search "newer_than:3d (interview OR schedule OR recruiter OR 'next round' OR ...)" --max 50
$GAPI gmail search "newer_than:3d (unfortunately OR 'regret to inform' OR ...)" --max 50
$GAPI gmail search "newer_than:3d (assessment OR 'coding challenge' OR take-home OR ...)" --max 50
```

**Pitfall:** My first attempt used only narrow keyword queries and missed Wayfair's acknowledgement, Runway's rejection, RevenueCat's rejection, and Sanofi's update. The broad catch-all caught everything.

**Pitfall: `threadId:` search doesn't work via GAPI.** The Gmail API's `q` parameter does NOT support `threadId:xxx` the way the Gmail web UI does. Using `$GAPI gmail search "threadId:19efca... newer_than:3d"` returns "No messages found." even when the thread exists. Workaround: search by sender domain (`from:` or `from_domain:`) to find all emails in a thread's conversation.

**Pitfall: Gmail returns SENT-labeled emails in search results.** When you search `newer_than:3d`, the API includes emails the USER sent, not just received ones. These show `"labels": ["SENT"]` or `"from": "The user <you@example.com>"`. Exclude these — they are the user's own replies/follow-ups, not new signals. Filter by checking labels array for `"SENT"` or `"DRAFT"`.

### Soft-rejection detection — "thank you" is not always an acknowledgement

Many "thank you for your interest" / "thank you for applying" emails are actually **soft rejections**, not harmless acknowledgements. Always read the full body of these emails to distinguish:

| Snippet clue | Likely classification |
|---|---|
| "we've received your application and will review it" | Acknowledgement (skip) |
| "we've decided to move forward with other candidates" | Rejection |
| "the position has been filled / is now closed" | Rejection |
| "we've had a good look and decided to move ahead with others" | Rejection |
| "after careful consideration" + "other candidates" | Rejection |

Rule: if the body says anything about not moving forward, position closed, or other candidates — classify as ❌ Rejection even if the subject line looks like a generic "thank you."

### 2. Google Calendar — Always check for interviews

Interviews often only exist as calendar events without a matching Gmail thread (or the Gmail is just a confirmation buried in the thread). Check:

```
$GAPI calendar list --start {TODAY}T00:00:00-04:00 --end {TOMORROW}T23:59:59-04:00
```

**Pitfall:** I originally skipped Calendar and missed 2 of 3 interviews today (Skimmer and Zynga). "There are three" was the user's correction.

### 3. Get full email bodies for classification

After the broad catch-all identifies candidate job-application emails, use `$GAPI gmail get MESSAGE_ID` to read the full body of important ones. The snippet alone may not reveal the role, time, or meeting link. This is especially important for interview reminders where the body contains the Teams/Meet link and the format.

### 4. Classify and format

Per the prompt spec, categorize into: Interview Today, Interview Tomorrow, Advanced/Next Round/Offer, Rejection, Assessment/Action Needed, Other Recruiter Outreach. Omit empty sections.

**Past vs upcoming interviews:** The 3-day Gmail window may surface interview invitations and reminders for interviews that have ALREADY HAPPENED within the window. For example, a Teams invitation sent Mon Jun 22 at 12:27 PM for a 12:00-12:30 PM slot — the interview already occurred. Cross-check with Calendar: if Calendar shows no events for today/tomorrow, past interviews are likely. Include completed interviews in a separate "📋 COMPLETED INTERVIEWS" section at the bottom for awareness — they may still produce follow-up signals.

### 5. Save + Deliver

```
Save to: ~/lin/email-digest/{YYYY-MM-DD}.md
Deliver: Telegram home channel
```

## Output Format

```
JOB FOLLOW-UP DIGEST — {Weekday, DD Mon YYYY} (America/Toronto)
Summary: {X} interview(s) today · {Y} tomorrow · {Z} result(s) · {W} action item(s)

📅 INTERVIEWS — TODAY
- {Company} — {Role} | {Time} | {Format} | from {Sender}

❌ REJECTIONS
- {Company} — {Role} | from {Sender}
```

Include link to Gmail thread or Calendar event for each item. Max ~1500 chars.

## Relationship to `lin-status check`

This digest and `lin-status check` serve complementary but **different** purposes:

| Aspect | lin-status check (per-company) | Daily digest (this cron) |
|---|---|---|
| Scope | Reads job.yml applied list, searches per company | Broad sweep (newer_than:3d) + Calendar |
| Writes to job.yml | ✅ Auto-applies closed/interviewing/offer | ❌ **Read-only** — never modifies job.yml |
| Catches unknown companies? | ❌ Only known applicants in job.yml | ✅ Catches rejections from untracked companies |
| Timing | Daily 6am ET | Daily 7am ET |
| Tooling | node script (lin-gmail-status.mjs) | Direct GAPI calls via LLM |

**When this cron finds a rejection from a company not in job.yml:** note it in the digest but do NOT create a job.yml entry. The digest is ephemeral output; job.yml is the source of truth maintained by other pipeline stages. If the rejection is from a known applicant (company exists in job.yml), `lin-status check` will update it on its next run.

## Exclusions

- LinkedIn/Indeed job-alert digests (generic "you might match" emails)
- Newsletters, marketing, promotions
- Generic "your application was received" auto-acknowledgements — UNLESS they contain a scheduling change or status update
