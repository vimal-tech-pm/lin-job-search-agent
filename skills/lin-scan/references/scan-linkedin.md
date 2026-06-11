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
      "confidence":"high","notes":"" }]
   ```
   Write it to a temp file, e.g. `/tmp/lin-linkedin-candidates.json`.
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

## Notes

- Source vocabulary in data is lowercase: write `src=linkedin`. `scanLinkedIn` is a verb alias only — never written into data.
- Discovery only — never score/prepare/apply here. Later stages handle the pending `- [ ]` rows.
