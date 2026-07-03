# Pin the worklist command in the cron prompt

## Problem

The lin-score cron `prompt` field in `cron/jobs.json` is intentionally thin:

```
Run the lin-score skill, verb "all", per its SKILL.md. Obey caps in career-profile/pipeline-config.json. Deliver the digest defined there.
```

The skill tells the agent to build the compact worklist first via `node scripts/lin-score-worklist.mjs --json`. But the agent's first terminal call often uses a `~`-relative or bare `scripts/...` path, which under the profile cron scheduler resolves to the wrong directory (`~/.hermes/profiles/lin/home/.hermes/...` — a doubled non-existent path). The agent wastes early turns on `Cannot find module` errors and may never recover, falling back to `read_file` on the full 200KB `data/pipeline.md`, which blows up context and triggers stale-stream `Broken pipe` failures.

The 2026-06-24 evening run failed exactly this way: worklist helper never ran → context grew to ~81K tokens → 4 consecutive 600s stale-stream kills → job failed after 3 retries.

## Fix: bake the absolute-path command into the cron prompt

Update the `prompt` field for `lin-score` in `~/.hermes/profiles/lin/cron/jobs.json`:

```json
"prompt": "Run the lin-score skill, verb \"all\", per its SKILL.md. Obey caps in career-profile/pipeline-config.json. Deliver the digest defined there.\n\nCRITICAL — build the compact worklist FIRST, before any evaluation:\n  cd ~/.hermes/profiles/lin/lin && node scripts/lin-score-worklist.mjs --json\nNever read_file on data/pipeline.md (it is 200KB+ and will blow up context).\nIf the worklist returns 0 items, respond [SILENT]."
```

The key elements:
- **Absolute `cd` path** — `~/.hermes/profiles/lin/lin`, not `~` or relative
- **The worklist command on the first line** — agent runs it before reading anything else
- **Explicit `read_file` prohibition** — prevents the 200KB pipeline context blowup
- **`[SILENT]` on 0 items** — prevents empty-digest delivery

## How to apply

```bash
# Read current prompt
python3 -c "
import json
j=json.load(open('~/.hermes/profiles/lin/cron/jobs.json'))
s=[x for x in j['jobs'] if x['id']=='lin-score'][0]
print(s['prompt'])
"

# Update via the cronjob tool or direct JSON edit
# (cronjob action=update with the new prompt, or edit jobs.json directly)
```

## Why this works

- The cron `workdir` field is already correct (`~/.hermes/profiles/lin/lin`), so terminal commands run from the right directory. The problem is only when the agent references files with `~` or `$HOME` — those expand to the profile home sandbox, not the vault.
- Pinning the absolute `cd` + command in the prompt means the agent doesn't need to discover the path — it just runs the command as written.
- The worklist helper outputs ~17KB (42 items) vs the full 200KB pipeline — a 12× context reduction.

## Generalizes to all lin-* cron jobs

Any lin-* cron job that depends on a deterministic helper script should pin the absolute path in its prompt. The `~` expansion bug affects all profile cron jobs, not just lin-score. For example:
- `lin-stage` → `node scripts/lin-worklist.mjs --status staged --json`
- `lin-build-forge` → `node scripts/lin-worklist.mjs --status staged --json`
- `lin-deep-prep` → whatever helper it uses

Pattern: `cd ~/.hermes/profiles/lin/lin && node scripts/<helper>.mjs <args>` as the first command in the prompt.

## Verification after applying

```bash
# Confirm the prompt was updated
python3 -c "
import json
j=json.load(open('~/.hermes/profiles/lin/cron/jobs.json'))
s=[x for x in j['jobs'] if x['id']=='lin-score'][0]
print(s['prompt'])
"

# Wait for the next scheduled run (07:15 or 21:15) and check:
# 1. No "Cannot find module" errors in the first 30s of the run
# 2. The worklist helper ran (grep agent.log for "lin-score-worklist" within the first few tool calls)
# 3. Context stays under ~20K tokens until JD extraction begins
```