# Evaluation queue bridge — verified state (2026-06-01)

## What this is

The evaluation queue bridge connects LIN01's evaluation output to the dashboard/promotion pipeline via `data/evaluation-queue.json`. Before this bridge, evaluated roles went to `reports/*.md` + `pipeline.md` — invisible to the tracker and promotion scripts. Now they flow:

```
LIN01 eval → jds/{id}-{co}-{date}.md (future) + reports/*.md
          → upsert data/evaluation-queue.json
promote   → liveness check → companies/{co}/jobs/{slug}/
tracker   → read queue → funnel digest + dashboard tabs
```

## Files created (Phase 0)

### `scripts/lin-evaluation-queue.mjs`

Pure Node. Three commands:
- **`migrate`** — parses `- [x] #NNN | URL | Company | Role | X.X/5 | PDF ✅/❌` from `data/pipeline.md`, matches #NNN to `reports/NNN-*.md`, extracts score/verdict/keywords/geo signals from the report, writes `data/evaluation-queue.json`.
- **`validate`** — checks unique ids, scores 0–5, enum states, report file existence, geo_gate reason enum.
- **`upsert --id NNN`** — reads entry JSON from stdin (preferred) or `--file <path>`. Merges by id, never clobbers liveness/promotion.

Regex uses `u` flag for multibyte emoji safety. Upsert accepts JSON via pipe or file, never `--json` CLI arg.

### `data/evaluation-queue.json`

Schema (V3.1):

```json
{
  "schema_version": 1,
  "generated_at": "ISO8601",
  "bootstrap": { "completed_at": "ISO8601|null", "last_mode": "manual|daily|bootstrap", "notes": "..." },
  "roles": [
    {
      "id": "NNN",
      "company": "CompanyName", "co_slug": "company-name",
      "role": "Role Title", "job_slug": "role-title",
      "url": "https://...",
      "discovered_at": "YYYY-MM-DD", "evaluated_at": "YYYY-MM-DD",
      "score": 4.6, "verdict": "Strong apply",
      "recommendation": "auto_stage|review|skip|manual_override",
      "queue_state": "evaluated|recommended|staged|materials_ready|applied|skipped|closed|duplicate|error",
      "report": "reports/NNN-company-YYYY-MM-DD.md",
      "pdf": "output/NNN-company-YYYY-MM-DD.pdf",
      "jd_snapshot": null, "needs_jd_refetch": true,
      "keywords": ["...", "..."],
      "location": "Not specified",
      "remote_signal": "Remote/Canada signal found|null",
      "geo_gate": { "reason": null|"visa"|"remote-only"|"onsite-only", "blocks_stage": false|true },
      "liveness": { "checked_at": "ISO8601|null", "result": "active|expired|uncertain|error|null", "reason": "..." },
      "promotion": { "promoted_at": "ISO8601|null", "job_folder": "companies/x/jobs/y", "error": null|"..." },
      "notes": []
    }
  ]
}
```

Queue states flow: `evaluated` → `recommended` → `staged` → `materials_ready` → `applied` (plus terminal states `skipped`, `closed`, `duplicate`, `error`).

## Files extended (Phase 1)

### `scripts/lin-tracker.mjs`

Modified to:
- `readEvaluationQueue()` — reads `data/evaluation-queue.json`, filters out roles already represented in `companies/*/jobs/*/job.yml` (dedup by URL and co_slug+job_slug).
- `readPipelinePending()` — counts `- [ ]` rows in `data/pipeline.md` for the "pending" count.
- Funnel digest output (stdout): pending, recommended, review, staged, materials-ready, applied.
- HTML dashboard adds "Evaluation queue" tab with Recommended and Review sections.
- Kanban tab renamed from "Applications" to "Pipeline".
- Win-rate and PATHFINDER backlog sections preserved.

## Files created (Phase 2)

### `scripts/lin-promote-evaluations.mjs`

Promotes recommended queue entries to staged job folders. Pure Node.

Entry point: `node scripts/lin-promote-evaluations.mjs [--dry-run] [--threshold=4.2] [--id=NNN] [--limit=N]`

Pipeline per role:
1. Geo gate check — if `blocks_stage=true`, demote to `evaluated`/`review`, no folder.
2. Liveness check — runs `engines/pathfinder/check-liveness.mjs` on the URL.
   - active → create `companies/{co_slug}/jobs/{job_slug}/` with job.yml, job.md, status-history.md, copy report → pathfinder-eval.md. Set queue_state → `staged`.
   - expired → set queue_state → `closed`, record reason.
   - uncertain/error → stay `recommended`, record error in promotion object.
3. JD fetch fallback — if `jd_snapshot` is null, fetches via `fetch()` (HTTP), tries JSON-LD first, falls back to body-strip.
4. Dry-run guard — every mutation behind `if (!isDryRun)`.

Known quirk: `--dry-run` still fetches the JD (live HTTP) even though nothing is persisted. Won't cause damage, adds ~2-5s latency per role.

## Verification results

```bash
cd ~/.hermes/profiles/lin/lin
node scripts/lin-evaluation-queue.mjs validate
# → validate: ok — 10 role(s)

node scripts/lin-tracker.mjs
# → Lin funnel digest:
#     pending:         50
#     recommended:     1
#     review:          8
#     staged:          1
#     materials-ready: 1
#     applied:         2

node scripts/lin-promote-evaluations.mjs --dry-run
# → liveness check + fetch for recommended roles, no mutations

# Actual promotion (RunPod #021, score 4.6):
# → liveness=active, folder created at companies/runpod/jobs/senior-product-manager/
```

| Component | Status |
|---|---|
| `lin-evaluation-queue.mjs migrate` | ✅ 10 roles migrated |
| `lin-evaluation-queue.mjs validate` | ✅ 0 errors |
| `lin-tracker.mjs` reads queue | ✅ Funnel correct |
| `lin-promote-evaluations.mjs --dry-run` | ✅ Reports correctly (minor: fetches JD) |
| RunPod promoted to `staged` | ✅ Folder created, status_history logged |
| jds/ directory created | ❌ Not yet (gated on cron editing) |
| LIN01 cron upserts into queue | ❌ Not yet (gated on cron editing) |
