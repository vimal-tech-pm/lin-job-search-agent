---
name: lin-scan
description: Lin stage 1 — discovery. Scans every enabled channel (portal/LinkedIn/Indeed/Gmail) for new job postings and appends them to the pipeline; also adds hand-pasted URLs. Part of the Lin pipeline scan → score → stage → build → finalize → apply.
user_invocable: true
args: verb
argument-hint: "[all | portal | linkedin | indeed | gmail | add <url> [url…] | describe]"
---

# lin-scan — discovery

Workdir: `~/.hermes/profiles/lin/lin` (the vault). Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (read §3 source vocab, §8 digest rules, §9 environment). **Discovery only:** never score, prepare, apply, or edit application statuses.

## Verbs

- `all` (the cron verb) — run every channel whose `enabled: true` in `career-profile/scan-channels.json`, in order: portal, linkedin, indeed, gmail.
- `portal` / `linkedin` / `indeed` / `gmail` — run one channel regardless of cron schedule (still respects the channel's `enabled` flag unless the user explicitly asks to force it).
- `add <url> [url…]` — manual add-to-pipeline (below).
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Shared channel contract

1. Caps come from `career-profile/pipeline-config.json` → `daily.scan_cap` / `scan_linkedin_cap` / `scan_indeed_cap` / `scan_gmail_cap` / `scan_manual_cap`. Cap ≤ 0 → print `{channel}: scan skipped (cap 0)` and continue to the next channel.
2. Channels emit **candidate JSON only**: `[{company, role, url, source_item_id?, source_query?, seen_at?, posted_date?, confidence?, notes?}]` to a temp file. Capture `posted_date` (ISO `YYYY-MM-DD`) from the listing's "posted X ago"/date when shown — it powers the dashboard's posted-recency column; omit when not visible (don't guess). All filtering, dedup, scan-history writes, cross-source duplicate linking, and cap enforcement go through the deterministic helper — never write `data/pipeline.md` or `scan-history.tsv` directly:
   ```bash
   node scripts/lin-discovery-append.mjs --source <portal|linkedin|indeed|gmail|manual> --file /tmp/lin-candidates-<channel>.json
   ```
3. After the last channel: `node scripts/lin-tracker.mjs` to refresh the dashboard.
4. Per-search navigation/extraction failures are warnings — log one line, continue. A whole-channel failure must not block later channels.

## Portal channel (fetch cheap first)

Targets come from `engines/pathfinder/portals.yml` (tracked_companies + search_queries; vocabulary edits go THERE, not into pipeline-config — see `references/scan-search-config.md`).

1. **Tier 1 — web_extract/API:** for each tracked company's `careers_url`, fetch with `web_extract` (or the company's `api:` endpoint via curl). Extract role titles + URLs. This handles ~70–80% of pages.
2. **Tier 2 — browser fallback:** only when Tier 1 returns empty/error (client-side SPAs like Wellfound): CDP precheck `http://127.0.0.1:9222/json/version`; if unreachable, log `portal: browser fallback unavailable — skipped <company>` and move on (exit 0 — never crash). If reachable, sequential `browser_navigate` + `browser_snapshot`, one page at a time.
3. **Tier 3 — web_search** for `search_queries` (broad discovery). All tiers are additive; the append helper dedups.

## LinkedIn / Indeed channels (browser-only)

No cheap-fetch alternative (login wall / anti-bot — audit-verified). CDP precheck first; if unreachable print exactly `scan skipped — browser login required` and exit 0 for that channel. Sequential `browser_navigate` over the channel's `searches[]` from `scan-channels.json`. **For LinkedIn, use `browser_console` with a DOM extraction expression (NOT `browser_snapshot`) to extract job card URLs** — `browser_snapshot` only returns the authwall dialog behind LinkedIn's "Sign in to view more jobs" overlay, while the DOM has the job cards with full URLs. See `references/scan-linkedin.md` § "Critical: URL extraction via browser_console" for the exact JS expression. Extraction details: `references/scan-linkedin.md` (canonical `/jobs/view/<id>` URLs) and `references/scan-indeed.md` (`viewjob?jk=` URLs). Both channels ship `enabled: false` by default.

## Gmail channel (API, no browser)

Run `node scripts/lin-gmailscan.mjs` (reads configured Gmail queries, extracts job URLs + light metadata, appends via the helper, refreshes tracker). Auth check first: if Google Workspace auth is missing, report that OAuth setup is required — do not fabricate results. Privacy: never store full email bodies; URL/company/role/sender-domain/date only. Details: `references/gmail-scan-integration.md`.

## `add <url> [url…]` — manual add-to-pipeline

For each URL: try `web_extract` to get company + role title. If you can't, **send the URL alone** — `manual` adds may be URL-only (omit company/role rather than inventing them). The helper writes a readable placeholder (ATS org slug when the URL exposes one, e.g. `novoed`; else `(manual add)`) and `lin-score` overwrites both from the JD. Build candidate JSON, write `/tmp/lin-candidates-manual.json`, then:
```bash
node scripts/lin-discovery-append.mjs --source manual --file /tmp/lin-candidates-manual.json
node scripts/lin-tracker.mjs
```
`manual` is an explicit user decision, so it **bypasses the `title_filter`** (never culled) and dedupes URL-only adds by URL identity alone. The dashboard "Add by URL" box posts to `/add-jobs`, which runs exactly this with `--json` for structured stats. Report per URL: appended (with pipeline row) or duplicate-of (with the sibling). The next `lin-score` run evaluates them; if the user wants it scored NOW, suggest `/lin-score all` or the express lane `/lin prepare <url>`.

## Digest (Telegram)

```
🔍 Lin scan — {YYYY-MM-DD}
{channel}: {new} new, {dup} dup{, skipped: {reason}}     ← one line per enabled channel
Top finds: • {Company} — {role}                          ← up to 5, omit if none
Pending in pipeline.md: {N} (next score run picks them up)
```
- All channels empty (0 new): single line `🔍 Lin scan — {date}: no new roles.`
- Failure variant: `⚠️ scan failed at {channel}: {one-line cause}; other channels unaffected.`

## Gotchas

- **Re-scan duplicate roles** — lin-scan re-scans job boards on each cron tick and does NOT check if a role was already applied to. The scan dedup (`lin-discovery-append.mjs`) only checks `data/pipeline.md` + `data/scan-history.tsv`, not `engines/pathfinder/data/applications.md` (the tracker). **Fixed 2026-06-18:** `lin-promote-evaluations.mjs` now checks the tracker before staging — if the same `company::role` canonical key is in `applications.md` with status matching `applied|closed|expired|wont|skip|reject`, the role is excluded from promotion. This prevents re-staging already-applied OR closed/expired roles at the staging chokepoint. Different roles at the same company are still eligible (correctly). Key implementation detail: the queue's title field is `role.role` (not `role.job_title` which is often null), so `isAlreadyApplied` falls back to `role.role`. If the user reports roles reappearing in the ready queue, check whether they are the SAME role (should be blocked — bug if it leaked) or a DIFFERENT role at the same company (legitimately new).
- **Cross-source duplicate roles (Promotion-time dedup)** — same role scanned from LinkedIn and Ashby/Greenhouse creates two queue entries with different URLs but the same canonical key. The scan dedup (`lin-discovery-append.mjs`) fires within a single run but not across different scan dates. **Fixed 2026-06-18:** Before creating a new job folder, `lin-promote-evaluations.mjs` checks all existing folders for the same company. If any non-closed folder has a matching `source_canonical_key`, the new entry is skipped as a cross-source duplicate and the queue row is set to `closed`.
- **Placeholder URLs (`about:link-XXX`) — ROOT CAUSE FOUND 2026-06-19** — **the underlying cause is a dead LinkedIn session**, not a scanner bug. The cookie refresh cron (`lin-linkedin-cookie-refresh`) had `last_run_at: null` — it never fired because the weekly schedule (`0 19 * * 0`) missed its slot after a gateway restart. With the session dead, LinkedIn shows the authwall, `browser_snapshot` returns only the 15-element sign-in dialog (not job cards), and the scanner writes `about:link-{queue_id}` placeholders. The DOM has the job cards with full `/jobs/view/<id>` URLs, but the accessibility tree doesn't expose them behind the "Sign in to view more jobs" dialog. **Three-layer fix:** (1) cookie refresh cron must run **daily** not weekly — LinkedIn sessions expire in 24–48h; (2) health check must verify `/feed/` doesn't redirect to `/uas/login` (not just cookie presence — expired `li_at` still exists but LinkedIn rejects it); (3) use `browser_console` with a DOM extraction expression for URL extraction — see `references/scan-linkedin.md` § "Critical pitfalls" and § "Critical: URL extraction via browser_console". **Never write `about:link-XXX` placeholders** — if `browser_console` returns empty, skip the search (0 new) rather than fabricating URLs. 93 entries were lost this way on June 16, 2026; 75 had no recoverable URL. Downstream mitigation: `lin-promote-evaluations.mjs` resolves placeholders via (1) `role.liveness.checked_url`, (2) `jd_eval_{id}.json` → `job_url`, (3) report file URL scrape — but only 18/93 had jd_eval files to recover from. See also `lin-stage/references/broken-url-recovery.md` § "Root cause".
- **Missing JD snapshots (LinkedIn/Indeed scanner bug)** — both the LinkedIn and Indeed scanners sometimes set `jd_snapshot` to `reports/{id}-{company}-{date}.md` (the PATHFINDER evaluation report path) instead of a proper `jds/` snapshot file. When `lin-promote-evaluations.mjs` promotes the role, `resolveJdSnapshot()` treats the report path as literal JD text, writing the filename into `job.md` as if it were the actual JD. This leaves `job.md` with zero usable JD content — the real JD was consumed during scoring but never saved to disk. The report files are just one-line score summaries (12-66 words). **No fix yet** — needs scanner to capture `jds/` snapshots before creating queue entries, or resolveJdSnapshot to error on `reports/` paths. Workaround: fetch JD from source URL during /lin-prepare or hand-edit job.md after promotion.
- **Archive dedup check** — `archive-deepseek/companies/` may contain folders for roles that were built, packaged, then archived before a pipeline reset. The scan dedup does not check the archive, so archived roles get re-scanned as new. When user reports `materials_ready` roles that feel like duplicates, check `archive-deepseek/companies/{slug}/jobs/` for folders with matching `source_url` or company+title. If the archive version had the same `source_url`, close the new one as duplicate. Example (2026-06-18): appnovation and insight-global had matching source URLs in archive -> closed as duplicates. Manual check only — no automated archive dedup exists.
- **Title filter is GLOBAL across ALL channels** — the `title_filter` block in `engines/pathfinder/portals.yml` is applied by the discovery helper (`lin-discovery-append.mjs`) to every candidate from portal, LinkedIn, Indeed, and Gmail — not just portal. At least 1 positive must match AND 0 negatives must match (case-insensitive substring). Only `manual` adds bypass the title_filter. To exclude levels/roles (e.g. Staff, Principal, Director), add them to `title_filter.negative`. LinkedIn/Indeed search URLs in `scan-channels.json` control what's fetched but the title_filter is the universal gate on what's kept.
- **Search vocabulary lives in scan config, not caps config** — portal terms in `engines/pathfinder/portals.yml` (`title_filter.positive`, `search_queries`); LinkedIn/Indeed search URLs in `career-profile/scan-channels.json`. `pipeline-config.json` is caps/thresholds only.
- **Wellfound** pages are client-side rendered — web_extract returns empty; browser tier required. Canonical URL `https://wellfound.com/jobs/<id>-<slug>` (strip query params).
- **Truncated JDs** — web_extract often cuts long Greenhouse/Lever pages; fall back to `curl -sL <url> > /tmp/jd.html` + Python/regex. Avoid inline `curl | python3 -c` when URLs contain `&`. See `references/job-board-quirks.md`.
- **Greenhouse dead URLs** — a `boards.greenhouse.io/<co>/jobs/<id>` landing on the generic careers page may be a repost under a new id at `job-boards.greenhouse.io/<co>/jobs/` — search the role title there before discarding.
- **Source persistence end-to-end** — every candidate carries its lowercase `source`; the helper owns writing it into pipeline rows (`src=`). Never let a channel write rows that default back to `portal`.
