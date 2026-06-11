# Promotion threshold + queue reclassification

Use this when `lin03prepare` sees fewer promotion candidates than expected, or when scored roles at/above `career-profile/pipeline-config.json.promote_threshold` remain in Review instead of Recommended.

## Durable lesson

Do not trust `queue_state` alone. Historically, some rows were scored when the promotion cutoff was hardcoded at `4.2`, while config later set `promote_threshold: 3.95`. Those rows can remain as:

```json
{ "queue_state": "evaluated", "recommendation": "review", "score": 4.0 }
```

even though they should be `recommended / auto_stage` under current config.

## Correct behavior

- `scripts/lin-evaluation-queue.mjs` should read `career-profile/pipeline-config.json` and classify using `promote_threshold`, not a hardcoded `4.2`.
- `scripts/lin-promote-evaluations.mjs` should default `--threshold` and `--limit` from config.
- Candidate selection should include old `evaluated/review` rows if `score >= promote_threshold`, unless the row is terminal, skipped, has a promotion folder, or already has an existing Lin-managed folder under `companies/{co}/jobs/{slug}`.
- `scripts/lin-tracker.mjs` has separate markdown and HTML render paths; update both threshold labels and category logic.

## Repair workflow

From the Lin vault root:

```bash
node scripts/lin-evaluation-queue.mjs reclassify       # dry-run
cp data/evaluation-queue.json data/evaluation-queue.json.bak-$(date +%Y%m%d-%H%M%S)
node scripts/lin-evaluation-queue.mjs reclassify --write
node scripts/lin-evaluation-queue.mjs validate
node scripts/lin-promote-evaluations.mjs --list-candidates --json --limit=25
node scripts/lin-tracker.mjs
```

If `.mjs` hits the Node/shebang issue documented in the main skill, copy to `.js` first.

## Regression tests to keep

- Upsert of a 4.0 score becomes `recommended/auto_stage` when config threshold is `3.95`.
- `reclassify --write` promotes old `evaluated/review` rows at configured threshold.
- Candidate list includes eligible old `evaluated/review` rows.
- Candidate list excludes rows with an existing Lin-managed folder.
- Reclassify syncs queue rows whose folders are already `applied`, `materials_ready`, `closed`, or `won't_apply`.
