# Hermes Cron/Scheduler Internals — Verified Platform Behaviors

Verified 2026-06-10 against hermes-agent source. Forensic follow-up on
2026-06-10 for the 429 failure root cause. Root-config inheritance fix
implemented and verified 2026-06-10. Refactored to shared helper
2026-06-10 per Claude code-review feedback (bugs: missing _expand_env_vars,
divergent error handling, no explicit [] opt-out, _cfg_path unbound,
gateway path unfixed, tests reading real root config).

---

## 1. Headless One-Shot with Skill + Model

**Command:**
```
hermes -p lin chat -q "/skillname args" -s skillname -m model --provider provider
```

**Verified:**
- Both `/skillname` and `skillname` (no slash) invocation forms work.
- `-m model` and `--provider provider` flags override defaults; the skill receives
  the correct model name.
- Exit 0 on success; clean exit.
- No gateway conflict — one-shot `-q` mode is fully isolated from the running
  gateway process.
- **bin/lin-run recipe:** `hermes -p lin chat -q "skillname args" -s skillname -m model`

## 2. Fallback Providers Under per-Job Pins

### Two-layer fallback

- **Scheduler level** (`scheduler.py:~1746`): fallback only fires on
  `AuthError` (bad API key). HTTP 429 does NOT trigger scheduler-level fallback.
- **Agent level** (`chat_completion_helpers.py:1033+`, `conversation_loop.py`):
  `_try_activate_fallback()` fires on `RateLimitError`/429 during the LLM call
  loop. It walks the `_fallback_chain` list built from profile
  `fallback_providers` in config.yaml.

### No per-job fallback config

Cron jobs can pin `model` + `provider` but cannot override the fallback chain.
The chain always comes from profile config.

### CRITICAL: Profile config is NOT merged with root config (scheduler-level gap, now patched)

The scheduler reads `_get_hermes_home() / config.yaml` only
(scheduler.py:1671-1674). It does NOT merge root config with profile config.
If `fallback_providers:` is commented out in the profile's config.yaml (even
with a comment like `# fallback_providers inherited from root config`), the
scheduler sees `None` and passes `fallback_model=None` to `AIAgent()`.
This produces `agent._fallback_chain = []` (agent_init.py:936).

### Root-config inheritance — REFACTORED to shared helper 2026-06-10

**Original two-site patch (2026-06-10)** had bugs identified by Claude review:
1. Inherited root config skipped `_expand_env_vars` — literal `${VAR}` credentials
2. Duplicated logic at two sites with divergent error handling (one `pass`, one `logger.debug`)
3. Profiles could not explicitly opt out with empty list `[]` (truthiness check vs key-presence)
4. `_cfg_path` could be unbound if the try block raised before assignment
5. Tests could silently read the developer's real root config (no hermeticity)
6. `gateway/run.py` `_try_resolve_fallback_provider` had the same profile-shadows-root bug

**Refactored solution:**

`hermes_cli/fallback_config.py` now contains `inherit_root_fallback(cfg, cfg_path, expand_env_vars_fn)`:
- Key-presence check (`"fallback_providers" in cfg`) — explicit `[]` opts out
- `os.path.realpath()` comparison (handles symlinks) instead of string equality
- Applies `_expand_env_vars` to root config so `${VAR}` references resolve
- Single consistent error policy: non-fatal, logged at debug
- Returns inherited key name for accurate logging

**Scheduler (`cron/scheduler.py`):**
- `_cfg_path = ""` initialized before the try block (fixes unbound variable)
- Single call to `inherit_root_fallback(_cfg, _cfg_path, _expand_env_vars)` after `_expand_env_vars`
- Both old duplicated blocks (AuthError path ~L1749 and agent fallback_model ~L1788) deleted
- Import added: `from hermes_cli.fallback_config import inherit_root_fallback`

**Gateway (`gateway/run.py`):**
- `_try_resolve_fallback_provider` now calls `_expand_env_vars` on config (matching startup bridge at ~L955)
- Calls `inherit_root_fallback(cfg, str(cfg_path), _expand_env_vars)` before `get_fallback_chain(cfg)`
- Import updated to include `inherit_root_fallback`

**Tests:**
- `tests/hermes_cli/test_inherit_root_fallback.py` — 12 unit tests for the helper
- `tests/cron/test_scheduler_root_fallback.py` — 5 integration tests with autouse hermeticity fixture
  that pins `get_default_hermes_root` to a tmp dir so no cron test reads the real `~/.hermes`

**Verification (2026-06-10):** All 17 new tests pass (447 total across cron + fallback suites).
Live verification: `lin03prepare` 429 now degrades to `deepseek-v4-pro (opencode-go)` with log lines:
```
Job 'lin03prepare': fallback_providers inherited from root config ~/.hermes/config.yaml
Fallback activated: gpt-5.5 → deepseek-v4-pro (opencode-go)
```

**Why Option 1 (copy real keys) was rejected:** it defeats the
single-source-of-truth design documented in `readme_LLM.md`. Changing
`fallback_providers` in root config (e.g. switch model, add a second fallback)
would require manually replicating to every profile config. API key changes
are safe (resolved at runtime from symlinked `.env`/`auth.json`), but model
name and provider changes are NOT. The inheritance patch preserves the design.

### Design intent vs code reality: root config "inheritance"

`~/.hermes/user_docs/readme_LLM.md` documents a single-source-of-truth design:
`~/.hermes/config.yaml` is the one file for LLM model/provider/fallback config,
and all profiles inherit. This works for `.env` (symlinked) and `auth.json`
(symlinked) but **NOT for config.yaml keys** like `fallback_providers` — until
the `inherit_root_fallback` helper. The scheduler and `load_config()` both read
only the profile's own config.yaml — there is no code-level merging or
inheritance from root config for arbitrary keys. The helper adds inheritance
specifically for `fallback_providers` / `fallback_model`.

### Forensic: 6/9-6/10 lin03prepare 429 failures

**What happened:**
- All 4 runs of `lin03prepare` (6/9 AM, 6/9 PM) and `lin03prepare-top10`
  (6/9 PM, 6/10 AM) failed with `HTTP 429: The usage limit has been reached`.
- Zero fallback activation log lines. The agent retried 3 times with
  exponential backoff, then the job failed.
- On 6/8, the same 429 WAS handled by fallback (log shows "Fallback activated:
  gpt-5.5 → deepseek-v4-pro (opencode-go)").

**Root cause:**
- Jun 3 backup of `profiles/lin/config.yaml` still had `fallback_providers:`
  and `fallback_model:` as real keys (lines 271-278).
- Between Jun 3 and Jun 9, these were commented out and replaced with:
  ```yaml
  # fallback_model inherited from root config
  # fallback_providers inherited from root config
  ```
- The scheduler reads ONLY the profile config, not the root. The comments are
  not parsed as YAML keys. `fallback_model = None` → empty fallback chain →
  429s fail the job.

### 429 strategy implication

A cron job pinned to `gpt-5.5/openai-codex` that hits 429 will automatically
try the fallback chain IF `fallback_providers` is defined in either the
profile config OR the root config (inherited via `inherit_root_fallback`). No
per-job override exists. All profiles (lin, finance, ironman) automatically
inherit root's `fallback_providers` when they don't define their own. A profile
can opt out by setting `fallback_providers: []`.

## 3. Skill Loading in Cron Sessions

**Full body injection.** `scheduler.py:1288-1296` reads the entire SKILL.md via
`skill_view()` and injects it into the assembled prompt at job assembly time.
No lazy/on-demand loading.

**Cost:** If a skill is 84KB, every cron run of any job listing that skill carries
~84KB of skill text in the prompt context.

**Size limit:** `skills_guard.py` enforces `MAX_TOTAL_SIZE_KB` — a cumulative cap
across all skills for a single job. Individual skill files have no per-file limit,
but the total must fit under this guard threshold.

**Architectural implication for Lin:** The Lin SKILL.md is ~84KB. Every cron job
that lists `skills: ["lin"]` pays this cost. Consider splitting into a lightweight
router skill + domain-specific sub-skills, or use `enabled_toolsets` instead of
skill injection for jobs that only need tool access, not skill instructions.

## 4. Safe jobs.json Editing

**Read-from-disk every tick.** `get_due_jobs()` calls `load_jobs()` from disk at
every 60-second tick (scheduler.py:1027). The scheduler does NOT hold a
long-lived in-memory copy.

**Atomic writes.** `save_jobs()` uses `atomic_json_write()` (utils.py:85):
temp file + fsync + `os.replace`. No partial writes.

**Last-write-wins risk:** If you hand-edit `jobs.json` and the scheduler saves
(stale) state in the same tick, the scheduler's save overwrites your edit because
it loaded the old version before you wrote, then saves its stale copy.

**Safe bulk migration (~10 add, ~6 delete):**
1. Stop the gateway (`hermes gateway stop` or kill the process).
2. Edit `profiles/lin/cron/jobs.json` directly.
3. Restart the gateway.
OR use `hermes cron create`/`hermes cron remove` CLI commands which go through
`load_jobs → mutate → save_jobs` atomically and are safe while gateway runs.

## 5. no_agent Telegram Delivery

**Works.** The `deliver:` field resolves identically for agent and no_agent jobs.
Setting `deliver: "telegram"` on a no_agent job sends script stdout to Telegram.

**Delivery path:** `scheduler.py:1418-1501` → `_deliver_result()` at line 724.
Script stdout (trimmed) is treated as the final message, wrapped with a
"Cronjob Response: ..." header (unless `cron.wrap_response: false`).

**Message splitting:** `BasePlatformAdapter.truncate_message()` (base.py:4724)
**splits** long messages into chunks (preserving code block boundaries), not
truncates. Telegram limit is 4096 UTF-16 code units; messages exceeding this are
sent as sequential chunks with `(1/N)` indicators.

**Empty stdout:** Returns `SILENT_MARKER` → delivery skipped entirely (no empty
message sent).

**Non-zero exit:** Script failure is delivered as an error alert to the target
(so a broken watchdog can't fail silently).

## 6. Cron Run Semantics

**`hermes cron run <id>`** (CLI) and `cronjob(action="run")` both call
`trigger_job()` (jobs.py:871-885).

**What trigger_job does:**
- Sets `enabled: True`, `state: "scheduled"`, clears `paused_at`/`paused_reason`
- Sets `next_run_at` to now
- Does NOT change model/provider — the job runs with its pinned model

**Gateway dependency:** Requires a running gateway. The ticker fires every 60
seconds (`_start_cron_ticker`, gateway/run.py:15434, default interval=60).
After `trigger_job` sets `next_run_at` to now, the job executes on the next tick
(within ~60 seconds).

**Concurrent run guard:** `_submit_with_guard()` (scheduler.py:2203-2206) checks
`_running_job_ids`. If a job is already mid-run, the trigger is **skipped**
(not queued, not run concurrently). Log: "Job 'X' already running — skipping."

**Paused job re-enable:** CONFIRMED. `trigger_job()` sets `enabled: True` and
clears all pause metadata. Running a paused job unpauses it. Empirically
verified: `[paused]` → `[active]` after `hermes cron run`.

**Safe one-shot without state change:** There is no built-in way. `hermes cron
run` always re-enables the job. For a state-preserving one-shot, stop the
gateway, manually set `next_run_at` to now in jobs.json, then restart — or
accept the re-enable and re-pause afterward.

## 7. Bulk Cron Provider Migration (2026-06-20)

When a provider hits a weekly usage limit (e.g. OpenCode Go 429), all cron
jobs pinned to that provider fail simultaneously. The fix is to switch them
to a direct API provider (e.g. `deepseek` provider with `deepseek-v4-flash`
model, using `DEEPSEEK_API_KEY` in the profile `.env`).

**Bulk migration via cronjob tool:**

```
for each job with provider=opencode-go, model=deepseek-v4-flash:
  cronjob(action='update', job_id='<id>', model={'model':'deepseek-v4-flash','provider':'deepseek'})
```

The `cronjob(action='update')` call with a `model` dict updates both the
`model` and `provider` fields on the job. This is safe while the gateway
runs (atomic load/mutate/save).

**After migration, trigger failed jobs one-by-one:**

```
cronjob(action='run', job_id='<id>')
```

Each triggered job executes on the next 60-second scheduler tick with the
new provider. Delivery goes to the job's `deliver` target (typically Telegram).

**Verification:** After all updates, run `cronjob(action='list')` and confirm
zero remaining jobs with the old provider/model combination.

**Pitfall:** `lin-status` is a `no_agent` script-only job. Updating its
model/provider fields is cosmetic (the script doesn't call the LLM), but
harmless and keeps the inventory consistent.

**Pitfall:** `no_agent` script jobs have a 120s default timeout
(`_DEFAULT_SCRIPT_TIMEOUT = 120` in scheduler.py, overridable via
`HERMES_CRON_SCRIPT_TIMEOUT` env var or `cron.script_timeout_seconds` config).
If a script hangs past this, the cron job fails with "Script timed out after
120s: <path>". This is NOT an LLM issue — the script itself is stuck. Common
cause: the script spawns a subprocess that blocks on an external dependency
(e.g. `secret-tool` waiting for GNOME Keyring unlock in a headless cron env).
`timeout 8s` wrapping the subprocess sends SIGTERM, but if the subprocess is\nin an uninterruptible DBUS syscall, SIGTERM is not delivered until the syscall\nreturns — which may never happen. **Fix applied 2026-06-20:** removed the\nhimalaya fallback path from `lin-gmail-status.mjs` entirely; GAPI (Google\nWorkspace OAuth) is now the sole Gmail backend. The GAPI token was symlinked\nfrom root to the lin profile (`ln -s ~/.hermes/google_token.json\n~/.hermes/profiles/lin/google_token.json`) so `setup.py --check` finds it.\nAdditionally, `cron.script_timeout_seconds` is now 900 because the status script scales with applied-job count. Calibration: 118 applied jobs → ~251s (300s was sufficient); 158 applied jobs → ~6m48s, so 300s timed out and 900s was verified on 2026-06-24.

**Pitfall:** Jobs with different models (e.g. `lin-build` -> `ollama/glm-5.2`,
`lin-deep-prep` -> `opencode-go/mimo-v2.5`) should NOT be bulk-migrated. Only
migrate jobs that were on the failed provider with the failed model.

**Pitfall: provider stale-stream timeout + fallback both matter for DeepSeek cron jobs (2026-06-24)**
Lin's agent-driven cron jobs can show `RuntimeError: [Errno 32] Broken pipe` when Hermes kills a provider stream after no chunks arrive for the stale threshold. The diagnostic line is usually:

```bash
Stream stale for 180s (threshold 180s) — no chunks received ... Killing connection
```

This affected `provider=deepseek model=deepseek-v4-flash` first; after fallback, it can also affect `provider=opencode-go model=deepseek-v4-flash` unless that provider has the same stale-timeout headroom.

**Production Lin settings verified 2026-06-24:**

```yaml
providers:
  deepseek:
    stale_timeout_seconds: 600
  opencode-go:
    stale_timeout_seconds: 600
fallback_providers:
  - model: deepseek-v4-flash
    provider: opencode-go
```

`fallback_providers: []` disables fallback entirely and should not be used on unattended production cron profiles unless deliberately testing a provider in isolation. But fallback alone is not enough for this failure class: Hermes' eager fallback primarily handles rate-limit/billing failures; ReadError/broken-pipe paths may only move to fallback after exhausting primary retries. The real prevention is increasing provider stale timeouts so long cron prompts are not killed before first token.

**Diagnosis recipe:**
```bash
journalctl --user -u hermes-lin-gateway --since "<date>" | grep -E "Stream stale|Broken pipe|provider="
```
Check both the threshold and the provider/model. If threshold is 180s for a large cron prompt, set provider-level `stale_timeout_seconds` before changing job schedules or models.

## 8. Agent Inactivity Timeout (HERMES_CRON_TIMEOUT)

**Source:** `scheduler.py:1844-1930`.

Cron agent jobs run with an *inactivity*-based timeout (not a wall-clock
timeout). The agent can run for hours if it's actively calling tools and
receiving stream tokens, but if it goes idle (no activity) for the configured
duration, it's killed.

- **Default:** 600s (10 minutes of inactivity)
- **Override:** `HERMES_CRON_TIMEOUT` env var (seconds). `0` = unlimited.
- **NOT configurable via config.yaml** — env var only.
- **Activity tracker:** `_touch_activity()` updates on every tool call, API
  call, and stream delta. The scheduler polls every 5s and checks
  `seconds_since_activity`.

This is separate from `cron.script_timeout_seconds` (which governs `no_agent`
script jobs). Agent jobs use `HERMES_CRON_TIMEOUT`; script jobs use
`script_timeout_seconds`.

## 9. Broken Pipe / Stale Stream Error Flow (agent-driven cron jobs)

When a cron agent job fails with `RuntimeError: [Errno 32] Broken pipe`:

1. Check journalctl for the preceding line. If you see `Stream stale for Ns (threshold Ns) — no chunks received ... Killing connection`, Hermes force-closed the provider stream because the model produced no chunks before the stale threshold.
2. The forced close surfaces as `ReadError` / `[Errno 32] Broken pipe` in `chat_completion_helpers.py`.
3. The agent retries up to `api_max_retries` times (default 3) with exponential backoff. For rate-limit/billing errors, fallback is eager; for `ReadError`/stale-stream paths, fallback may only happen after primary retries are exhausted.
4. If fallback is configured, the agent may switch to the next provider/model; that fallback provider also needs an adequate `stale_timeout_seconds` or it can hit the same false stale kill.
5. If all attempts fail, `run_conversation` returns `{failed: True, error: "[Errno 32] Broken pipe"}` and `scheduler.py` records `RuntimeError: [Errno 32] Broken pipe` with `last_status: error`.

**Fix order:**
1. Set provider-level stale timeouts for both primary and fallback providers, e.g. `providers.deepseek.stale_timeout_seconds: 600` and `providers.opencode-go.stale_timeout_seconds: 600`.
2. Ensure `fallback_providers` is non-empty for unattended production profiles.
3. Re-run the failed cron once and verify the output file + `last_status: ok`.

Do not diagnose this as a Telegram delivery-pipe issue unless there is no `Stream stale` / provider `ReadError` evidence in the gateway journal.