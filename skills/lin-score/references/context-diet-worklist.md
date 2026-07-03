# Lin score context diet / compact worklist

Use this when `lin-score` cron or manual runs risk loading too much historical state into the model.

## Problem pattern

A previous `lin-score` cron run on `deepseek-v4-flash` failed after loading the full historical `data/pipeline.md` plus large mode/reference files. The model request reached roughly 40K tokens and the stream went stale, ending in `[Errno 32] Broken pipe` after retries.

This was not a Gmail, CDP, or job-data issue. The durable fix is reducing model context while preserving the thin-cron architecture.

## Architecture rule

Keep responsibilities separated:

- Cron job: thin launcher only (`Run the lin-score skill, verb "all", per its SKILL.md...`).
- Skill: owns workflow instructions and pitfalls.
- Deterministic script: owns parsing/capping of large files.
- Agent: sees only compact work items and JD/report content needed for the current role.

Do not paste workflow code or large prompts into `cron/jobs.json`.

## Worklist helper

Run from the Lin vault root:

```bash
node scripts/lin-score-worklist.mjs --json
```

The helper reads internally:

- `career-profile/pipeline-config.json` → `daily.score_cap`
- `data/pipeline.md`

It outputs only pending rows up to the cap, with compact fields:

- `line_number`
- `date`
- `company`
- `role`
- `url`
- `source`
- `duplicate_of`
- `canonical_key`
- `posted_date`

For a human view:

```bash
node scripts/lin-score-worklist.mjs
```

## Required practice

- Never use `read_file` on the full `data/pipeline.md` in `lin-score`.
- Never send processed historical rows to the model.
- Use `line_number` from the helper when marking rows processed.
- If delegating evaluations, build the compact worklist first and pass each subagent one URL/JD context, never the full pipeline.

## Verification commands

```bash
node --check scripts/lin-score-worklist.mjs
node --test tests/lin-score-worklist.test.mjs tests/lin-discovery-append.test.mjs tests/lin-worklist.test.mjs
node scripts/lin-score-worklist.mjs --json
```

Expected current-scale output should be small: kilobytes, not the full ~85KB pipeline history.
