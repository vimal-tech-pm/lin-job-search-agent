# lin-score cron failure — 2026-06-24 21:26 session

**Session:** `cron_lin-score_20260624_212606` · **Failed:** 2026-06-24 22:40:48 · **Error:** `RuntimeError: [Errno 32] Broken pipe` after 3 retries

## Two compounding causes

### 1. Wrong working directory (early-turn waste)

The profile cron scheduler injects `HOME=~/.hermes/profiles/lin/home` (the profile home sandbox). The agent's first terminal calls used `~`-relative paths, which resolved to doubled non-existent paths:

```
cat: career-profile/pipeline-config.json: No such file or directory
Cannot find module '~/.hermes/profiles/lin/home/.hermes/profiles/lin/lin/scripts/lin-score-worklist.mjs'
ls: cannot access '~/.hermes/profiles/lin/home/.hermes/profiles/lin/lin/career-profile/': No such file or directory
```

The cron job's `workdir` field is correct (`~/.hermes/profiles/lin/lin`), but once the agent references files outside the cwd, `~` expands wrong. **Always use absolute paths** in lin-* cron skills, never `~/`.

### 2. Context blowup → stale stream → broken pipe

After recovering from the path errors, the agent loaded too much context (full pipeline + JD fetches + subagent results). Timeline from `logs/errors.log`:

| Time | Event | Context |
|---|---|---|
| 21:26 | Job starts, wrong-path terminal errors | ~13K |
| 21:36 | 1st stale stream (600s) → Broken pipe → retry 1 | ~13K |
| 21:49 | 2nd stale stream → Broken pipe | ~57K |
| 22:00 | Delegated subagent times out at 600s (19 API calls) | — |
| 22:10 | 3rd stale stream → Broken pipe → retry 2 | ~63K |
| 22:20 | 4th stale stream → Broken pipe → retry 3 | ~81K |
| 22:30 | 5th stale stream → Broken pipe (retry 3 exhausted) | ~81K |
| 22:40 | **Final failure** after 3 retries | ~76K |

The subagent timeout at 22:00 was the turning point — instead of aborting and delivering a partial-result digest, the parent retried into an already-bloated 63K+ context, guaranteeing more stale streams.

## Fix recipe

1. **Use absolute paths** — never `~/` or `$HOME/` in lin-* cron skills. The workdir is `~/.hermes/profiles/lin/lin`.
2. **Never read full `data/pipeline.md`** — use `node scripts/lin-score-worklist.mjs --json` for the compact worklist.
3. **Abort on subagent timeout** — if a delegated scoring subagent times out at 600s, do not retry the parent turn into a bloated context. Deliver the failure digest (`⚠️ score failed after {n} roles...`) and let the next scheduled run resume with fresh context.
4. **The morning 07:40 run succeeded** with the same config — the failure was specific to the evening run's context management, not a config or provider issue.

## Verification commands

```bash
# Check the cron job status
python3 -c "import json; j=json.load(open('~/.hermes/profiles/lin/cron/jobs.json')); print(json.dumps([x for x in j['jobs'] if x['id']=='lin-score'][0],indent=2))"

# Read the failed run output
cat ~/.hermes/profiles/lin/cron/output/lin-score/2026-06-24_22-40-51.md

# Check the error log for the session
grep "cron_lin-score_20260624_212606" ~/.hermes/profiles/lin/logs/errors.log | head -20
```