# Lin prepare cron status checks

Use this when the user asks whether the prepare cron ran, what the last run status was, or how many jobs/resumes were prepared.

## Do not infer from caps or queue state

A prepare cap (`daily.prepare_cap` / `greenfield.prepare_cap`) is only the maximum. The actual result must come from the last cron execution output and/or filesystem artifacts.

## Status verification workflow

1. Inspect the cron job entry for the relevant prepare job:
   - daily prepare: `lin03prepare`
   - greenfield prepare: `lin07prepareGreenfield`
2. Use `last_run_at`, `last_status`, and `enabled` only as scheduler metadata. If a job shows `state=scheduled` or `next_run_at≈now`, report it as queued/due, not completed.
3. Read the newest saved output under the profile cron output directory for that job when available. Prefer the delivered final response / saved output over guessing.
4. If output is missing or ambiguous, corroborate from Lin artifacts:
   - `companies/*/jobs/*/job.yml` with recent `status: materials_ready`
   - recent `ats_winner` changes
   - `status-history.md` rows from the cron time window
   - resume files under `companies/*/jobs/*/resumes/` (`forge.pdf`, `forge.docx`, `pathfinder.pdf`, `ats-compare.md`)
5. Count **jobs prepared** as distinct job folders moved/prepared in that run.
6. Count **resumes prepared** as generated resume artifacts, usually by engine outputs per job:
   - FORGE: `resumes/forge.pdf` and often `resumes/forge.docx`
   - PATHFINDER: `resumes/pathfinder.pdf`
   - ATS winner package symlink at the job root is packaging, not a separate tailored resume engine.
7. If the run failed, report the failure stage and partial counts separately. Do not call a queued run “successful.”

## Response shape

Keep the answer short:

- Last run: timestamp + status
- Jobs prepared: N
- Resume artifacts prepared: N, with a quick breakdown if useful
- Any failure/blocker: one line

If verification is incomplete, say exactly what was missing (for example, “cron metadata updated but no saved output file yet”).
