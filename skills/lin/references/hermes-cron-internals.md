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
Job 'lin03prepare': fallback_providers inherited from root config $LIN_REAL_HOME/.hermes/config.yaml
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