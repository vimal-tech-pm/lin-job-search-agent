# Outlook Status Check via CDP Browser

When the user applies to jobs using their Outlook email (you@example.com) rather than Gmail, use this manual workflow to check for application status updates. This is the Outlook equivalent of `lin status-check` for Gmail.

## Prerequisites
- Chrome CDP browser running on `:9222` (verify: `curl -sS http://127.0.0.1:9222/json/version`)
- User logged into Outlook in the CDP browser session

## Workflow

1. **Get applied jobs list:**
   ```bash
   grep -l 'status: applied\|status: interviewing\|status: final' companies/*/jobs/*/job.yml
   ```
   Include all active statuses, not just `applied` — interviewing roles can get rejected too.

2. **Navigate to Outlook inbox:**
   ```
   browser_navigate("https://outlook.live.com/mail/0/")
   ```

3. **Discover the correct CDP page target** — CRITICAL: Outlook opens multiple page targets. The browser_navigate/browser_console tools may attach to a target that shows an empty message list (the SPA shell). You MUST find the target that has the actual inbox content:
   ```
   browser_cdp(method='Target.getTargets', params={})
   ```
   Look for the target with type='page' and title containing 'Inbox' (not just 'Outlook'). Use that target_id for all subsequent CDP calls.

4. **Extract email list via CDP Runtime.evaluate** — `browser_console` and `browser_snapshot` often return empty or incomplete text on the Outlook SPA. Use CDP instead:
   ```
   browser_cdp(
     method='Runtime.evaluate',
     target_id='<the-inbox-target-id>',
     params={'expression': 'document.body.innerText.substring(0, 10000)', 'returnByValue': true}
   )
   ```

5. **Search for rejection signals via CDP** — browser_type + browser_press('Enter') does NOT work on the Outlook search box. Use native input value setter + event dispatch:
   ```js
   (function() {
     var input = document.querySelector('input[role="combobox"]');
     var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
     nativeSetter.call(input, 'unfortunately');
     input.dispatchEvent(new Event('input', {bubbles: true}));
     input.dispatchEvent(new Event('change', {bubbles: true}));
     input.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13}));
   })()
   ```
   Wait 5s then read the message list via Runtime.evaluate.
   
   **Effective search terms** (run each, collect results):
   - `unfortunately` — catches most rejection emails
   - `not moving forward` — catches Greenhouse/Ashby-style rejections
   - `interview invitation` — catches new interview requests
   - Also search individual company names (e.g. `Zynga`) for targeted checks

6. **Read individual email bodies** — click the email item via CDP, then wait 4s and read the Reading Pane:
   ```js
   // Click: find the [role="option"] whose innerText matches, click it
   // Then: 
   var rp = document.querySelector('[aria-label="Reading Pane"]');
   rp.innerText.substring(0, 5000);
   ```
   Use `awaitPromise: true` and a setTimeout wrapper in the expression for the wait.

7. **Update statuses** — for each rejection/interview found:
   - Patch job.yml: `status: closed`, `outcome: rejected` (or `status: interviewing`)
   - Do NOT touch `furthest_stage` when closing a rejection — it's a monotonic high-water mark
   - Append a row to `status-history.md`
   - Update `last_email_check` and `last_email_status` in job.yml
   - After all updates: `node scripts/lin-tracker.mjs` to regenerate the tracker

8. **Batch updates with execute_code** — when multiple rejections are found, use execute_code to loop through them with patch() calls rather than individual patch tool calls. Much faster.

## Pitfalls
- **Multiple CDP page targets** — Outlook spawns 2+ page targets. browser_navigate may land on the wrong one (empty message list). ALWAYS use Target.getTargets to find the one titled 'Inbox - <name>', then use that target_id for all Runtime.evaluate calls.
- **browser_type doesn't work for search** — the Outlook search combobox ignores programmatic typing. Must use native input value setter + event dispatch via CDP.
- **Outlook search via URL params doesn't work** — `?q=...` redirects to inbox without executing search.
- **browser_snapshot returns empty or near-empty** on Outlook SPA — use CDP Runtime.evaluate with `document.body.innerText` instead.
- **Message list innerText may show only tab headers** ("Focused\nOther") with no email items — this means you're on the wrong CDP target. Switch to the Inbox-titled target.
- **Most applications sent same-day will only have acknowledgements** — real responses take days.
- **The "Other" tab contains LinkedIn/Indeed alerts**, not application responses.
- **Duplicate search results** — Outlook shows "Top results" and "All results" sections; the same email appears in both. De-duplicate by sender + subject + date.
- **Gusto sends separate rejections per role** — if you applied to 3 Gusto roles, expect 3 separate rejection emails from careers@gusto.com, plus a possible post-interview rejection from a recruiter (e.g. Mallory Montanez) for the role that got to interview stage.
