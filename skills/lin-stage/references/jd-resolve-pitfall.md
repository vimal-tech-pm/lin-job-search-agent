# JD resolve pitfall — report path vs jds/ path

## Problem

`resolveJdSnapshot()` in `lin-promote-evaluations.mjs` only recognizes paths starting with `jds/` as actual JD snapshot files. If the queue's `jd_snapshot` field points to `reports/{id}-{company}-{date}.md` (a pathfinder evaluation report, not a JD), the function falls into the backward-compatibility branch and returns the literal string as the JD text.

Result: `job.md` shows the report filename (e.g. `reports/630-acquia-2026-06-16.md`) instead of the actual job description. The role was scored correctly (the JD was used during scoring), but the raw JD text was never saved to a `jds/` snapshot file.

## How to detect

Check `materials_ready` folders for short JDs in `job.md`:
```python
# Look for "## Raw JD" section with < 50 meaningful words
# Or content that is just a report path like "reports/630-acquia-2026-06-16.md"
```

## Fix for existing folders

1. Get the real source URL from:
   - `job.yml` → `source_url` (may also be a placeholder `about:link-XXX`)
   - `jd_eval_{id}.json` → `job_url` (most reliable for placeholder URLs)
   - Queue's `liveness.checked_url` field
2. Navigate to the URL via CDP browser (LinkedIn JDs are visible without login)
3. Extract `document.body.innerText` via `Runtime.evaluate` CDP call
4. Rewrite the `## Raw JD` section in `job.md` with the fetched text

## Prevention (implemented 2026-06-18)

- `resolveUrl()` in `lin-promote-evaluations.mjs` resolves placeholder URLs before writing job.yml/job.md
- `fetchJd()` skips unresolvable placeholders instead of trying to fetch them
- Root cause remains: scanner writes `reports/` path as `jd_snapshot` instead of creating a `jds/` file

## LinkedIn JD extraction via CDP

LinkedIn job pages show full JD text without login (the sign-in dialog can be dismissed). To extract:

1. `browser_navigate` to the LinkedIn job URL
2. Dismiss the sign-in dialog if it appears (click "Dismiss" button)
3. Use `Target.getTargets` to find the LinkedIn page's `targetId`
4. Call `Runtime.evaluate` with `document.body.innerText` on that target
5. The JD text is in the response — trim LinkedIn chrome (search bar, similar jobs, footer) from the start/end

Some LinkedIn URLs are fake — constructed from queue IDs (e.g. `senior-product-manager-centah--596`). These return 404. The real URL must be found in `jd_eval_{id}.json` or by searching LinkedIn for the company + role title.

## Indeed JD extraction

Indeed URLs are blocked by a JavaScript security check when fetched via curl. The `jds/` snapshot file may contain only a fetch error (`FETCH_ERROR: HTTPError: HTTP Error 403: Forbidden`). No workaround without a logged-in Indeed session — these JDs remain missing.