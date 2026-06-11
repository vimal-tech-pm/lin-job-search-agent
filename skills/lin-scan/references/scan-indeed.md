# scanIndeed — Indeed job-search browser scan

Reference for Lin's `scanIndeed` verb (alias `scan indeed`). Implements the
shared **§channel-scan** contract for the `indeed` channel.

> **Architecture rule (do not break):** the browser only extracts candidate
> JSON. ALL filtering, dedup, pipeline append, scan-history, and cap enforcement
> are delegated to `scripts/lin-discovery-append.mjs`. Never write to
> `data/pipeline.md` or `engines/pathfinder/data/scan-history.tsv` directly from
> this flow.

## Config

- **Enablement + search URLs:** `career-profile/scan-channels.json` → `indeed.enabled` and `indeed.searches[]` (`{name, url}`).
- **Cap:** `career-profile/pipeline-config.json` → `daily.scan_indeed_cap` (default 50). Caps live ONLY here, never in `scan-channels.json`.

## Steps

1. **Cap precheck.** Read `daily.scan_indeed_cap`. If `≤ 0`, log `indeed: scan skipped (cap 0)` and stop.
2. **CDP precheck.** A browser session is required for rendered Indeed results. Check `http://localhost:9222/json/version` (or navigate a simple page). If unreachable → print `scan skipped — browser login required`, **exit 0** (do not crash), append zero rows.
3. **Scan each enabled search** in `indeed.searches[]`, **sequentially in a single browser session** (no Playwright, no parallel tabs):
   - `browser_navigate(search.url)` → `browser_snapshot`.
   - Extract one candidate per job card: **title**, **company**, **job URL**, and the Indeed **jk** key (`jk=...`) when present.
   - Normalize URLs to `https://ca.indeed.com/viewjob?jk=<jk>` when the key is visible; this gives the deterministic append helper a stable canonical URL.
   - Paginate (scroll / next page) until reaching `daily.scan_indeed_cap` candidates across all searches or results are exhausted.
   - **Best-effort per search URL:** navigation/extraction errors log a warning and continue to the next search; non-fatal.
4. **Emit candidate JSON only** — an array of:
   ```json
   [{ "company":"Acme","role":"Senior Product Manager",
      "url":"https://ca.indeed.com/viewjob?jk=abc123",
      "source":"indeed","source_query":"PM — Remote CA",
      "source_item_id":"abc123","seen_at":"2026-06-04T…Z",
      "confidence":"high","notes":"" }]
   ```
   Write it to a temp file, e.g. `/tmp/lin-indeed-candidates.json`.
5. **Funnel through the deterministic helper:**
   ```bash
   node scripts/lin-discovery-append.mjs --source indeed --file /tmp/lin-indeed-candidates.json
   ```
   The helper applies the `title_filter` from `portals.yml`, canonicalizes
   `jk=`, dedups by canonical-URL and canonical-key, keeps cross-source
   duplicates with `dup_of=`, appends `src=indeed` pending rows, writes the
   9-column `scan-history.tsv`, enforces the cap, and prints a digest.
6. **Refresh the dashboard:** `node scripts/lin-tracker.mjs`.

## Notes

- Source vocabulary in data is lowercase: write `src=indeed`. `scanIndeed` is a verb alias only — never written into data.
- Discovery only — never score/prepare/apply here. Later stages handle pending `- [ ]` rows.
