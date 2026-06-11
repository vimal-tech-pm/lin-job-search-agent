# Lin — Hermes Platform Operations (footguns & protocols)

> Platform-level rules for operating Lin's cron jobs and manual runs. Probe-verified 2026-06-10 against Hermes v0.16.0. Stage workflows live in the `lin-*` skills; this file is only about the platform.

## The 10-job table (post re-architecture)

`lin-scan` 8:30/20:30 → `lin-status` 8:50/20:50 → `lin-score` 9:15/21:15 → `lin-stage` 10:00/22:00 → `lin-build` 10:30/22:30 (gpt-5.5, the only frontier job) → `lin-finalize` 11:15/23:15 → `lin-deep-prep` 11:45/23:45 → `lin-track` 12:10/00:10 (no_agent) · `lin-serve-watchdog` 9:00 (no_agent) · `lin-followups` paused (15:00 weekdays).

## Manual runs — the three ways

1. **Chat:** `/lin <verb>` (router) or `/lin-<stage> <verb>` directly. Runs on the chat session's model.
2. **Pinned-model one-shot:** `~/.hermes/profiles/lin/bin/lin-run <stage> [args] [-m MODEL]` → wraps `hermes -p lin chat -q "<skill> <args>" -s <skill> -m <model>`; default model resolved from the stage's cron job in `cron/jobs.json`. This replaces the old greenfield/paused-cron dance entirely. Works while the gateway runs; no session/lock conflicts (probe-confirmed).
3. **Fire today's scheduled job early:** `hermes -p lin cron run lin-<stage>` — executes within the ≤60s gateway tick with the job's pinned model.

## Footguns (all probe-confirmed)

- **`cron run` RE-ENABLES paused jobs** (`trigger_job()` sets `enabled: true`). Never use it on a paused job; that is exactly what `bin/lin-run` is for.
- **Mid-run triggers are dropped, not queued.** If a job is running, `cron run` / `/run-stage` is silently skipped (`_submit_with_guard`). Double-clicks are safe; "nothing happened" usually means it was already running.
- **`cron run` only marks the job due** — execution needs the gateway ticker. `state=scheduled` + `next_run_at≈now` means *queued*, not *started*. Verify starts via `last_run_at`/`last_status` (`hermes -p lin cron list`), not from the trigger output.
- **Hand-editing `cron/jobs.json` while the gateway runs risks last-write-wins** — the scheduler loads from disk each tick but saves its own copy on run bookkeeping. Bulk edits: stop the gateway first, edit, restart. Single jobs: use `hermes cron` CLI / the cronjob tool (atomic load→mutate→save).
- **Cron sessions need `approvals.cron_mode: approve`** in `~/.hermes/profiles/lin/config.yaml` — nobody is present to answer approval prompts; `deny`/`manual` silently blocks gated commands.
- **Skill text is fully injected per run.** Whatever skills a job attaches are loaded whole into the prompt (no lazy loading; cumulative `MAX_TOTAL_SIZE_KB` guard). Keep `lin-*` skills ≤9KB each.
- **429s and fallbacks:** a rate-limited pinned model falls back through the profile-level `fallback_providers` chain (agent layer; no per-job override). A known Hermes bug (2026-06) sometimes prevented this — if a build run dies with `HTTP 429`, the staged leftovers are picked up by the next run by design. The build digest names the model that actually built each role.
- **Model pins are per-job;** the lin profile's own `model:` in `config.yaml` governs interactive chat, and `/model` is session-only unless `--global`. When diagnosing "wrong model", check the job pin, then the profile config, then the session.
- **no_agent jobs:** stdout is the Telegram message (auto-split >4096 chars); empty stdout = silent; non-zero exit = delivered error alert. They never touch the inference layer.

## Status checks for "did it run?"

```bash
hermes -p lin cron list                 # last_run_at / last_status / next_run_at
ls ~/.hermes/profiles/lin/cron/output/<job_id>/   # per-run output files
```
If `next_run_at` is past and `last_run_at` is stale, the run is queued/overdue — check the gateway is up (`hermes status`) before assuming failure. Stale `.lin-<stage>.lock` files in the vault root (>2h) mean a run died mid-flight; the next run self-recovers per the lockfile protocol in `conventions.md` §6.
