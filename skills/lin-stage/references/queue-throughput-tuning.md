# Queue Throughput Tuning

When the user says "the top matches queue is backed up, which settings to relax?", use this playbook.

## Pipeline state vocabulary

| Queue state | Meaning | Bottleneck |
|---|---|---|
| `evaluated` | Scored, waiting for stage | **Stage** → promotion/liveness |
| `staged` | Folder created, resume not built | **Build** → resume generation |
| `built` | Resume done, not finalized | **Finalize** → compare/package |
| `materials_ready` | Ready to apply | ✅ No bottleneck |

## Diagnosis

```
# Quick snapshot
HOME=~ node scripts/lin-evaluation-queue.mjs list --json | python3 -c "
import json,sys
q=json.load(sys.stdin)['roles']
from collections import Counter
print('States:', dict(Counter(r.get('queue_state','?') for r in q)))

# High-scored Canada-eligible NOT staged
blocked=[r for r in q if r.get('score',0)>=4 and r.get('canada_eligible')=='yes'
         and r.get('queue_state')=='evaluated'
         and (not r.get('geo_gate') or r['geo_gate'].get('blocks_stage')!=True)]
print(f'≥4.0 + Canada-eligible NOT staged: {len(blocked)}')

# Already built, needing finalize
built=[r for r in q if r.get('queue_state')=='built']
print(f'Built needing finalize: {len(built)}')
for r in built: print(f'  #{r[\"id\"]} {r.get(\"company\",\"?\")} - {r.get(\"title\",\"?\")} ({r.get(\"score\",\"?\")}/5)')

# Staged needing build
staged=[r for r in q if r.get('queue_state')=='staged']
print(f'Staged needing build: {len(staged)}')
"
```

## Three settings that control stage throughput

All in `career-profile/pipeline-config.json`.

### 1. `auto_build_top_n` (default: 10)
How many top-scored eligible roles get auto-selected per `stage auto` run.
- **User wants to drain fast:** bump to 20-30.
- Limit: more = more liveness checks (time). Each needs web_extract, potentially browser.

### 2. `promote_limit` (default: 25)
Caps the candidate list from `--list-candidates` **silently**. If `auto_build_top_n=20` but `promote_limit=15`, stage only sees 15 candidates.
- **ALWAYS keep `promote_limit >= auto_build_top_n`** or stage will silently undershoot.
- For a big drain: set both to the same target (e.g. 30).
- Can restore defaults after the drain.

### 3. `daily.prepare_cap` (default: 20)
If the prepare cron (stage+build+finalize bundled) is being used, this caps the bundle run. Less impactful than (1)+(2) — prepare is a slower combined step.

## Fastest path to more materials_ready roles

Priority order:

1. **Finalize already-built roles** → instant materials_ready (zero new scoring/staging/build needed)
2. **Build staged roles** → then finalize. Fast if there's a deep "staged" backlog.
3. **Stage more high-scorers** → bump `auto_build_top_n` + `promote_limit`, run `stage auto`
4. **Score remaining un-scored pipeline rows** → bring more candidates into the evaluation queue

## Common scenarios

### "Queue full of high-scored (≥4.0) roles sitting in evaluated"
**Cause:** `auto_build_top_n` too low to drain the backlog.
**Fix:** `auto_build_top_n=25`, `promote_limit=30`, run `HOME=~ node scripts/lin-promote-evaluations.mjs --list-candidates --json --auto` to verify the cap isn't silently limiting.

### "Staged pile is growing, never getting built"
**Cause:** Build cron not running or backlogged.
**Fix:** Run build manually: `HOME=~ node scripts/lin-build.mjs` or `bin/lin-run build`.

### "Built pile sitting without finalize"
**Fix:** `bin/lin-run finalize`. Instant materials_ready.

### "Settings don't stick — I saved through the dashboard but it reverted"
**Cause:** `scripts/lib/settings-page.mjs` CONFIG_FIELDS defines per-field min/max bounds. The `/settings-config` endpoint silently rejects out-of-range values (returns `ok: true` with `rejected` array, but UI only shows "saved — backup: ...").
**Fix:** Edit `career-profile/pipeline-config.json` directly (bypasses dashboard validation), or bump the field's max in CONFIG_FIELDS and restart lin-serve: `systemctl --user restart hermes-lin-serve.service`.

### "User asked why only N roles got staged despite higher caps"
**Causes:**
- `promote_limit` silently capped `--list-candidates` — check config, verify `promote_limit >= auto_build_top_n`
- Liveness checks failed — many URLs may be dead or uncertain
- Geo gate blocked auto-selection — row had `geo_gate.blocks_stage: true` (these are excluded before top-N slicing, so they don't consume slots, but if there are few eligible roles total, fewer get promoted)
