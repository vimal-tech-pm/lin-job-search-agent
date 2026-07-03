# Lin — Hermes Platform Operations (footguns & protocols)

> Platform-level rules for operating Lin's cron jobs and manual runs. Probe-verified 2026-06-10 against Hermes v0.16.0. Stage workflows live in the `lin-*` skills; this file is only about the platform.

## The cron table (post LLM-inbox re-architecture, 2026-06-24)

`lin-scan` 6:30/20:30 (agent, opencode-go) → `lin-status` 6:50/20:50 (agent, opencode-go, **LLM-driven** via `81ca02ebe5b3` — replaces old no_agent script) → `lin-score` 7:15/21:15 (agent, opencode-go) → `lin-stage` 8:00/22:00 (agent, opencode-go) → `lin-build` 8:30/22:30 (agent, neuralwatt/glm-5.2) → `lin-finalize` 9:15/23:15 (agent, opencode-go) → `lin-deep-prep` 9:45/23:45 (agent, opencode-go/mimo-v2.5) → `lin-track` 10:10/0:10 (no_agent) · `lin-linkedin-cookie-refresh` 12:00 (no_agent) · `lin-followups` paused (15:00 weekdays, opencode-go/deepseek-v4-pro).

**Paused jobs:** `lin-status` (old no_agent, replaced by `81ca02ebe5b3`) · `f050366cceb4` (Job Follow-Up Digest, merged into `81ca02ebe5b3`).

## Manual runs — the three ways

1. **Chat:** `/lin <verb>` (router) or `/lin-<stage> <verb>` directly. Runs on the chat session's model.
2. **Pinned-model one-shot:** `~/.hermes/profiles/lin/bin/lin-run <stage> [args] [-m MODEL]` → wraps `hermes -p lin chat -q "<skill> <args>" -s <skill> -m <model>`; default model resolved from the stage's cron job in `cron/jobs.json`. This replaces the old greenfield/paused-cron dance entirely. Works while the gateway runs; no session/lock conflicts (probe-confirmed).
3. **Fire today's scheduled job early:** `hermes -p lin cron run lin-<stage>` — executes within the ≤60s gateway tick with the job's pinned model.

## Footguns (all probe-confirmed)

- **`cron run` RE-ENABLES paused jobs** (`trigger_job()` sets `enabled: true`). Never use it on a paused job; that is exactly what `bin/lin-run` is for.
- **`cron run` on a new/active job sets next_run_at≈now but doesn't execute synchronously** — it marks the job due and the gateway ticker picks it up on the next tick (≤60s). If `state=scheduled` and `last_run_at` is still null after triggering, check again in 60s — the run is queued, not failed. Verify execution via `last_run_at`/`last_status` in `hermes -p lin cron list`, not from the trigger output.
- **Mid-run triggers are dropped, not queued.** If a job is running, `cron run` / `/run-stage` is silently skipped (`_submit_with_guard`). Double-clicks are safe; "nothing happened" usually means it was already running.
- **`cron run` only marks the job due** — execution needs the gateway ticker. `state=scheduled` + `next_run_at≈now` means *queued*, not *started*. Verify starts via `last_run_at`/`last_status` (`hermes -p lin cron list`), not from the trigger output.
- **Hand-editing `cron/jobs.json` while the gateway runs risks last-write-wins** — the scheduler loads from disk each tick but saves its own copy on run bookkeeping. Bulk edits: stop the gateway first, edit, restart. Single jobs: use `hermes cron` CLI / the cronjob tool (atomic load→mutate→save).
- **Cron sessions need `approvals.cron_mode: approve`** in `~/.hermes/profiles/lin/config.yaml` — nobody is present to answer approval prompts; `deny`/`manual` silently blocks gated commands.
- **Skill text is fully injected per run.** Whatever skills a job attaches are loaded whole into the prompt (no lazy loading; cumulative `MAX_TOTAL_SIZE_KB` guard). Keep `lin-*` skills ≤9KB each.
- **429s and fallbacks:** a rate-limited pinned model falls back through the profile-level `fallback_providers` chain (agent layer; no per-job override). A known Hermes bug (2026-06) sometimes prevented this — if a build run dies with `HTTP 429`, the staged leftovers are picked up by the next run by design. The build digest names the model that actually built each role.
- **Model pins are per-job;** the lin profile's own `model:` in `config.yaml` governs interactive chat, and `/model` is session-only unless `--global`. When diagnosing "wrong model", check the job pin, then the profile config, then the session.
- **no_agent jobs:** stdout is the Telegram message (auto-split >4096 chars); empty stdout = silent; non-zero exit = delivered error alert. They never touch the inference layer.
- **LinkedIn cookie refresh CDP timeouts:** if `lin-linkedin-cookie-refresh` fails at `Page.navigate` / websocket timeout before `Decrypted LinkedIn credentials`, treat it as a Chrome/CDP lifecycle or target-selection issue, not a LinkedIn/GPG/password issue. Use `references/linkedin-cookie-refresh-cdp.md` for the forensic ladder and durable patch pattern.
- **Profile cron `~` expands to the profile home sandbox, NOT `~`** — the scheduler injects `HOME=~/.hermes/profiles/lin/home` for profile-scoped cron jobs. Any `~/...` or `$HOME/...` path in a cron agent's terminal/read_file call resolves to a doubled non-existent path like `~/.hermes/profiles/lin/home/.hermes/profiles/lin/lin/...`. The cron job's `workdir` field is correct, but `~`-relative file references outside the cwd break. **Always use absolute paths** (`~/.hermes/profiles/lin/lin/...`) in lin-* cron skills, never `~/`. This is a durable design fact (the profile home sandbox is permanent), confirmed in the 2026-06-24 lin-score failure (`references/cron-workdir-and-context-blowup-2026-06-24.md` under the lin-score skill).

## Status checks for "did it run?"

```bash
hermes -p lin cron list                 # last_run_at / last_status / next_run_at
ls ~/.hermes/profiles/lin/cron/output/<job_id>/   # per-run output files
```
If `next_run_at` is past and `last_run_at` is stale, the run is queued/overdue — check the gateway is up (`hermes status`) before assuming failure. Stale `.lin-<stage>.lock` files in the vault root (>2h) mean a run died mid-flight; the next run self-recovers per the lockfile protocol in `conventions.md` §6.

## Reading cron output files for failure cause

Cron output files live at `cron/output/<job_id>/YYYY-MM-DD_HH-MM-SS.md`. Each is a markdown file with structured sections:

| Signal | What to grep for |
|---|---|
| Agent job failed | `(FAILED)` in the markdown title (line 1) |
| Script (no_agent) failed | `**Status:** script failed` |
| Script timeout | `Script timed out after Ns:` |
| LLM rate limit | `## Error` section containing `RuntimeError: HTTP 429` |
| Model auth error | `## Error` section containing `RuntimeError: HTTP 401` |

**Quick failure scan across all jobs:**

```bash
cd ~/.hermes/profiles/lin/cron/output
for d in */; do
  f=$(ls -t "$d" 2>/dev/null | head -1)
  [ -z "$f" ] && continue
  head -5 "$d/$f" | grep -qE 'FAILED|script failed|Script timed out|## Error' && \
    echo "❌ $d$f" && \
    grep -E '(RuntimeError:|Status:|Script timed out)' "$d/$f" | head -3
done
```

**One-liner for today only:**

```bash
today=$(date +%F)
find ~/.hermes/profiles/lin/cron/output -name "${today}_*.md" \
  -exec grep -lE 'FAILED|script failed|Script timed out' {} \; | while read f; do
    echo "❌ $(basename $(dirname $f)) — $(grep -E '(RuntimeError:|Status:|Script timed out)' $f | head -1)"
done
```
