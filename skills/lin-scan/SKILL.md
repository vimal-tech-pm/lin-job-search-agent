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
2. Channels emit **candidate JSON only**: `[{company, role, url, source_item_id?, source_query?, seen_at?, confidence?, notes?}]` to a temp file. All filtering, dedup, scan-history writes, cross-source duplicate linking, and cap enforcement go through the deterministic helper — never write `data/pipeline.md` or `scan-history.tsv` directly:
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

No cheap-fetch alternative (login wall / anti-bot — audit-verified). CDP precheck first; if unreachable print exactly `scan skipped — browser login required` and exit 0 for that channel. Sequential `browser_navigate`/`browser_snapshot` over the channel's `searches[]` from `scan-channels.json`. Extraction details: `references/scan-linkedin.md` (canonical `/jobs/view/<id>` URLs) and `references/scan-indeed.md` (`viewjob?jk=` URLs). Both channels ship `enabled: false` by default.

## Gmail channel (API, no browser)

Run `node scripts/lin-gmailscan.mjs` (reads configured Gmail queries, extracts job URLs + light metadata, appends via the helper, refreshes tracker). Auth check first: if Google Workspace auth is missing, report that OAuth setup is required — do not fabricate results. Privacy: never store full email bodies; URL/company/role/sender-domain/date only. Details: `references/gmail-scan-integration.md`.

## `add <url> [url…]` — manual add-to-pipeline

For each URL: try `web_extract` to get company + role title (fall back to `company: "?"`, `role: "?"` — score will fix them). Build candidate JSON, write `/tmp/lin-candidates-manual.json`, then:
```bash
node scripts/lin-discovery-append.mjs --source manual --file /tmp/lin-candidates-manual.json
node scripts/lin-tracker.mjs
```
Report per URL: appended (with pipeline row) or duplicate-of (with the sibling). The next `lin-score` run evaluates them; if the user wants it scored NOW, suggest `/lin-score all` or the express lane `/lin prepare <url>`.

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

- **Search vocabulary lives in scan config, not caps config** — portal terms in `engines/pathfinder/portals.yml` (`title_filter.positive`, `search_queries`); LinkedIn/Indeed search URLs in `career-profile/scan-channels.json`. `pipeline-config.json` is caps/thresholds only.
- **Wellfound** pages are client-side rendered — web_extract returns empty; browser tier required. Canonical URL `https://wellfound.com/jobs/<id>-<slug>` (strip query params).
- **Truncated JDs** — web_extract often cuts long Greenhouse/Lever pages; fall back to `curl -sL <url> > /tmp/jd.html` + Python/regex. Avoid inline `curl | python3 -c` when URLs contain `&`. See `references/job-board-quirks.md`.
- **Greenhouse dead URLs** — a `boards.greenhouse.io/<co>/jobs/<id>` landing on the generic careers page may be a repost under a new id at `job-boards.greenhouse.io/<co>/jobs/` — search the role title there before discarding.
- **Source persistence end-to-end** — every candidate carries its lowercase `source`; the helper owns writing it into pipeline rows (`src=`). Never let a channel write rows that default back to `portal`.
