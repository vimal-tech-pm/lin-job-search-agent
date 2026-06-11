# Resume Page-Fill Quality Gate

## The problem

The `prepare` and `resume` verbs delegate PDF generation to subagents (FORGE via `build-resume.js`, PATHFINDER via `generate-pdf.mjs`). Subagents self-report "PDF generated: 2 pages" but never measure actual page fill. The result: 3-page FORGE PDFs with a 12%-fill stub page, and 1.5-page PATHFINDER PDFs where page 2 is only 20% full. These ship silently.

## The gate

`scripts/lin-verify-resumes.py <job_folder>` runs three checks:

1. **File existence** — `resumes/forge.pdf` and `resumes/pathfinder.pdf` must both exist
2. **Page count** — PATHFINDER must be exactly 2 pages; FORGE must be 2 pages (or 3 with page 3 ≥55% fill)
3. **Page fill** — every page must be ≥65% filled (bottom-most text element ≥65% of page height)
4. **Text density** — ≥600 words per resume (anti-skeleton check)

Exit codes:
- 0: all pass → continue to ATS compare
- 1: fixable issues (wrong page count, low fill, low word count) → retry with content adjustments
- 2: hard failure (missing files) → stop and report

## How to fix a failing gate

### PATHFINDER too long (3+ pages)
Trim bullets via the recency-tier caps in `engines/pathfinder/modes/pdf.md` Step 8a:
- Current roles (0-2 years): max 6 bullets
- Recent (2-5 years): max 4 bullets
- Prior (5-10 years): max 3 bullets
- Early (10+ years): max 2 bullets

If still overflowing at those caps, apply the trim sequence (Step 8a):
- Early career → 1 bullet each
- Prior → 2 bullets each
- Recent → 3 bullets each

### PATHFINDER too short (<65% fill on page 2)
- Add more content: expand the "Selected Projects" section, add an "Ideogram Fit" / role-fit section
- Loosen caps: add +1 bullet to recent and prior roles
- Font adjustments: bump body font-size from 10.5px to 10.7px, line-height from 1.43 to 1.45
- Always re-run `generate-pdf.mjs` and then the verify script

### FORGE too long (3+ pages)
- Trim the `forge.md` in the job folder: remove Key Achievements section if present, merge adjacent bullets in older roles
- Reduce bullets in early-career roles to 1 each
- Remove the least JD-relevant bullet from each prior role
- Re-run `build-resume.js` and then the verify script

### FORGE too short (<65% fill)
- Add bullets back from the master resume, prioritizing JD-relevant metrics
- Expand the professional summary with JD-keyword injections

## Iteration budget

The skill allows `prepare_retry_budget` retries (default 1, from `career-profile/pipeline-config.json`). After exhausting the budget, report the specific issues (e.g. "PATHFINDER page 2: 47% fill, need 65%") to the user — do not silently ship.

## Why pdftotext -bbox instead of pdfinfo page count alone

`pdfinfo` reports page count but not fill percentage. A 2-page PDF can have page 2 at 12% fill (a stub with just "Education" and "Skills"). `pdftotext -bbox` extracts every text element's bounding box, letting us compute `max(yMax) / page_height` for each page. This catches the stub-page problem that page-count alone misses.

## Example: Ideogram #036 fix session (2026-06-03)

Original output:
- PATHFINDER: 2 pages, p2 fill 20% (74 words on page 2) — FAIL
- FORGE: 3 pages, p3 fill 13% (36 words on page 3) — FAIL

Fix path for PATHFINDER (5 iterations):
1. Added "Selected Product Evidence" section with 4 project descriptions
2. Added "Ideogram Fit" section with 7 tailored bullets
3. Each iteration: edit HTML → `generate-pdf.mjs` → `lin-verify-resumes.py` → inspect fill%

Final: PATHFINDER 2 pages (p1 93%, p2 71%), FORGE 2 pages (p1 91%, p2 77%)
