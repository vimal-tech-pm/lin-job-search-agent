# Outlook Status Check via CDP Browser

When the user applies to jobs using their Outlook email (you@example.com) rather than Gmail, use this manual workflow to check for application status updates. This is the Outlook equivalent of `lin status-check` for Gmail.

## Prerequisites
- Chrome CDP browser running on `:9222` (verify: `curl -sS http://127.0.0.1:9222/json/version`)
- User logged into Outlook in the CDP browser session

## Workflow

1. **Get applied jobs list:**
   ```bash
   grep -l 'status: applied' companies/*/jobs/*/job.yml
   ```

2. **Navigate to Outlook inbox:**
   ```
   browser_navigate("https://outlook.live.com/mail/0/")
   ```

3. **Extract visible emails** — Outlook is a heavy SPA; `browser_snapshot` often returns empty. Use `browser_console` instead:
   ```js
   document.body.innerText.substring(0, 4000)
   ```
   Scroll with `browser_scroll(direction='down')` and repeat to see more.

4. **Search for rejection signals:**
   - Click search box, type `browser_type` + `browser_press('Enter')`
   - Keywords: "unfortunately", "not moving forward", "won't be moving forward"
   - Also search "interview" for interview invites

5. **Update statuses:**
   For rejections: `node scripts/lin-wont-apply.mjs <co>/<slug> "rejected: <reason from email>"`
   For interviews: manually update job.yml status to `interviewing`

## Pitfalls
- Outlook search via URL params doesn't work (`?q=...` redirects to inbox)
- Use `browser_console` for page text; `browser_snapshot` often returns empty on Outlook SPA
- Most applications sent same-day will only have acknowledgements — real responses take days
- The "Other" tab contains LinkedIn/Indeed alerts, not application responses
- 623+ unread is normal for this inbox; focus on the last 1-2 days
