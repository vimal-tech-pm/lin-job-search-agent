# Dead primary URL, live LinkedIn mirror promotion

Use this when a recommended evaluation-queue row has a dead canonical careers URL (for example Ashby returns `Job not found`) but a LinkedIn mirror for the same role is still live and readable.

## Pattern

1. Verify the canonical URL with browser liveness. If it clearly says `Job not found`, do not mark the role closed yet.
2. Check any LinkedIn/source mirror already present in logs, reports, or scan history. Load it in the Hermes browser and dismiss sign-in prompts if needed.
3. If the LinkedIn page shows the same company/title and the JD body is readable, treat it as active liveness for promotion.
4. Extract the visible JD text from browser/CDP, not `web_extract` alone. `web_extract` may summarize LinkedIn metadata and miss the full JD even when the browser sees it.
5. Update the queue row before promotion:
   - `source_url` and `url` -> the live LinkedIn URL
   - `jd_snapshot` -> extracted readable JD text
   - `needs_jd_refetch: false`
   - `canada_eligible` and `canada_eligible_reason` from the visible location signal
   - `liveness.result: active`, with evidence like `LinkedIn page live; JD visible in browser`
6. Write a small external liveness JSON and promote with:
   `node scripts/lin-promote-evaluations.mjs --id=<NNN> --liveness-file=<file>`
7. Run `node scripts/lin-evaluation-queue.mjs validate`, then continue `lin prepare <co>/<job>`.

## Why

`lin-promote-evaluations.mjs` fetches the row URL to create `job.md` when `jd_snapshot` is missing. If the row still points at the dead canonical URL, promotion can stage an empty/dead JD or hold the row even though a live mirror exists. Updating the queue row and supplying external liveness preserves the active role and makes prepare use the readable source.

## Verification

After prepare, verify:
- `job.yml.source_url` points to the live URL.
- `job.yml.status: materials_ready`.
- `job.yml.ats_winner` is set.
- `resumes/pathfinder.pdf`, `resumes/forge.pdf`, `resumes/ats-compare.md`, and `resumes/application-answers.md` exist.
- The recruiter-named root resume exists and points to the winning resume.
- `node scripts/lin-tracker.mjs` shows the row under materials-ready.

## Pitfalls

- Do not rely on `web_extract` for LinkedIn JD bodies; use browser/CDP visible text when available.
- Do not classify the dead canonical URL as `closed` if a live LinkedIn mirror shows the same role.
- If a deterministic/package helper produces malformed markdown after a manual patch, fix and re-read `PACKAGE.md` before reporting done.
