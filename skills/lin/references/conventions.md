# Lin — Shared Conventions (the contract every stage skill obeys)

> Referenced by every `lin-*` skill. Vault root: `~/.hermes/profiles/lin/lin/` — all relative paths below resolve from there. Change this file only with a design review; stage skills depend on it.

## 1. Lifecycle

```
staged → built → materials_ready → applied → interviewing → offer → closed
```

| Status | Meaning / invariant | Set by |
|---|---|---|
| `staged` | Folder + `job.yml` + `job.md` + eval exist. **No resume assumption.** | `scripts/lin-promote-evaluations.mjs` (lin-stage) |
| `built` | Both `resumes/forge.pdf` and `resumes/pathfinder.pdf` exist AND the quality gate passed (see §5). `ats_winner: null`. No package. | lin-build, strictly after render + gate PASS |
| `materials_ready` | `ats_winner` set, `PACKAGE.md` + recruiter-named symlink at folder root. | `scripts/lin-package.mjs` (lin-finalize) |
| `applied` | User submitted on the company site. Has `applied_at`. | `scripts/lin-apply.mjs` / direct-apply only — **never** build/finalize |
| `interviewing` / `offer` / `closed` | Terminal-ish; set by lin-status (email signals), apply flow, or won't-apply. | lin-status / lin-apply |

Legacy statuses (`new`, `interested`, `decoding`) may exist in old data; readers normalize them to `staged`. Never write them.

**Outcome funnel (the real terminal model).** Forward `status` is kept for back-compat, but the dashboard buckets and analytics read two orthogonal fields (see `lib/outcome.mjs`, the single source of truth):
- `furthest_stage` — monotonic high-water mark `none → applied → interviewing → final → offer`.
- `outcome` — terminal disposition `rejected | withdrew | declined | offer | accepted | expired | duplicate | error` (`null` while live).
- `outcome_source` / `furthest_stage_source` ∈ `email | manual`. **`manual` is sticky** — `lin-gmail-status` folds email signals via the lib and never overwrites a manual value. So "rejected after the final round" = `{outcome: rejected, furthest_stage: final}`, set automatically and correctable from the dashboard (`scripts/lin-set-outcome.mjs`, `POST /set-outcome`). The dashboard splits the old Closed bucket into Rejected/Withdrew/Declined/Expired; `outcome-funnel.md` reports per-stage conversion + rejection depth. Backfill: `scripts/lin-migrate-outcomes.mjs` (dry-run → `--write`).

Invariant checker: `node scripts/lin-migrate-status.mjs --check` (no `built` without PDFs+gate; no `materials_ready` without winner+PACKAGE.md; no `applied` without `applied_at`). Run it after anything that mutates statuses in bulk.

## 2. `job.yml` schema

```yaml
job_slug: string                # kebab-case, max 40 chars, unique under its company
company_slug: string            # kebab-case, max 30 chars
title: string
location: string
salary_band: string             # "" if not posted
source_url: string
external_apply_url: string|null # real portal when different from JD page
discovered_via: string          # pathfinder-scan | linkedin-scan | indeed-scan | gmail-scan | intake-manual | referral | intake-file
discovered_at: YYYY-MM-DD        # when Lin SAW it (recency fallback)
posted_date: YYYY-MM-DD | null   # real listing date when a scan captured it (dashboard recency; null when unknown)
status: enum                    # see §1 (forward status; kept in sync for back-compat)
status_detail: string
outcome: enum|null              # rejected|withdrew|declined|offer|accepted|expired|duplicate|error — terminal disposition (§1 outcome funnel)
furthest_stage: enum            # none|applied|interviewing|final|offer — monotonic high-water mark
outcome_source: enum            # email|manual (manual is sticky — the scanner won't overwrite it)
furthest_stage_source: enum     # email|manual
ats_winner: enum                # forge | pathfinder | null
pathfinder_score: float         # 0–5
pathfinder_verdict: string
canada_eligible: enum           # yes | no | unknown
canada_eligible_reason: string  # <120 chars quoting the JD signal
source_channel: enum            # portal | linkedin | indeed | gmail | manual
artifacts: { resume_forge, resume_pathfinder, ats_report, cover_forge, cover_pathfinder, cover_winner, company_research }
applied_at: ISO8601 | null
applied_with: { resume: forge|pathfinder|null, cover: enum|null }
```

`companies/{co}/company.yml`: `co_slug, display_name, careers_url, sector, hq, notes`.
`status-history.md`: append-only, one row per transition: `{ISO8601}  {status}  {note}`.

## 3. Evaluation-queue row contract (`data/evaluation-queue.json`)

Top-level object `{schema_version, generated_at, bootstrap, roles[]}` — never replace with a bare list. Row fields used by stage skills: `id, company, co_slug, role, job_slug, url, score, verdict, queue_state, recommendation, canada_eligible(+_reason), geo_gate{reason∈null|visa|remote-only|onsite-only, detail, blocks_stage}, source, duplicate_of, canonical_key, jd_snapshot, report, promotion{job_folder,…}, build_requested(bool), build_requested_at`.

- `queue_state` ∈ `evaluated|recommended|staged|built|materials_ready|applied|skipped|closed|duplicate|error`.
- Stage auto-selection treats `geo_gate.blocks_stage`/`canada_eligible=no` as the source-of-truth geo gate before top-N slicing, so blocked rows do not consume auto-build slots. Explicit human requests (`build_requested`/Prepare click or `--id NNN`) bypass that gate and must be visibly reported as a geo override.
- `source` ∈ `portal|linkedin|indeed|gmail|manual` (lowercase only).
- Mutate ONLY via `node scripts/lin-evaluation-queue.mjs upsert --id <NNN> --file <tmp.json>` (or stdin). **Never pass JSON as a CLI arg; omit `id` from the payload.** Flag rows for build via `… request-build --id <NNN> [--clear]`.
- Validate after bulk changes: `node scripts/lin-evaluation-queue.mjs validate`.

## 4. Hybrid build trigger

`career-profile/pipeline-config.json` is the single source for every cap/threshold. Keys: `promote_threshold` (eligibility floor), `auto_build_floor` + `auto_build_top_n` (auto tier), `daily.*` caps, `greenfield.*` caps, `deep_prep_*`, `prepare_retry_budget`. Selection = top `auto_build_top_n` eligible rows ≥ `auto_build_floor` ∪ all `build_requested` rows ≥ `promote_threshold` — implemented by `lin-promote-evaluations.mjs --auto`; skills never re-derive it.

## 5. Gate marker (`resumes/gate-pass.json`)

```json
{ "result": "pass", "verifier": "lin-verify-resumes.py", "verified_at": "ISO", "via": "build|migration" }
```

Written ONLY by lin-build (after `python3 scripts/lin-verify-resumes.py <folder>/` exits 0) or by the migration script. lin-finalize and `scripts/lin-worklist.mjs --status built` require it — the status string alone is never trusted.

## 6. Lockfile protocol (stage/build/finalize)

At start: if `.lin-<stage>.lock` exists in the vault root and is younger than 2 hours → exit cleanly with digest "skipped — <stage> already running". Older than 2h → stale; delete and proceed. Then write `{"pid": <pid>, "started_at": "ISO"}` to the lockfile; remove it at the end (including on clean early exits).

```bash
test -f .lin-build.lock && [ $(( $(date +%s) - $(stat -c %Y .lin-build.lock) )) -lt 7200 ] && exit 0
echo "{\"pid\": $$, \"started_at\": \"$(date -Is)\"}" > .lin-build.lock
# … work …
rm -f .lin-build.lock
```

## 7. Slug rules

`co_slug` = company name → lowercase, alphanumeric + `-`, max 30 chars. `job_slug` = role title → same, max 40 chars; dedupe with `-2`, `-3` if the folder exists. Job folders are ALWAYS `companies/{co}/jobs/{slug}/` — the `jobs/` segment is mandatory.

## 8. Digest ground rules (Telegram)

- Metadata only. Never resume/cover/PDF bodies or file contents.
- Every pipeline-stage digest ends with the leftovers line: `staged awaiting build: N · built awaiting finalize: M` (counts from `node scripts/lin-worklist.mjs --status staged|built`).
- Empty-work runs are silent (no message) unless the skill's Digest section says otherwise.
- Failures are never silent: one ⚠️ line with the stage and a one-line cause.

## 9. Environment

- **`HOME=~`** is REQUIRED for ALL node/python scripts in the vault — not just renderers. The lin profile sandboxes `$HOME` to `~/.hermes/profiles/lin/home`, and Node resolves relative script paths from `$HOME` instead of cwd, so `node scripts/lin-worklist.mjs` and every other script silently fails with `MODULE_NOT_FOUND` (or worse, runs against a different vault) without it. **Always prefix with `HOME=~`** when running any `node scripts/...` or `python3 scripts/...` command. This is the #1 cause of silent worklist failures, staging no-ops, and finalize SILENT runs.
- **Fetch cheap first:** `web_extract`/`curl` is the primary fetch path; the logged-in CDP browser (port 9222, bootstrapped by `ensure_chrome_cdp.py`) is a fallback tier. LinkedIn/Indeed are browser-only.
- Engines are vendored (`engines/forge`, `engines/pathfinder`) and consume `career-profile/` as the only source of truth. Updates are disabled (`*.UPDATE-DISABLED`). Never invent resume content not present in `career-profile/resume.md` / `experience.md`.
- **Context diet for cron scripts (Broken pipe prevention)** — Lin cron agents run on models with limited context windows and pipe-buffer thresholds. A script that outputs >100KB of JSON to stdout will hit `RuntimeError: [Errno 32] Broken pipe` when the agent's pipe reader can't drain it fast enough. This has hit three skills: lin-score (200KB pipeline.md → worklist helper), lin-stage (candidate list), lin-status (286KB inbox JSON → matched-only companies). **Rules for any cron plumbing script:** (1) emit only the rows/items the agent needs to act on, not the full dataset; (2) cap text fields (email bodies, JD text) at 1500 chars; (3) use compact JSON (`json.dumps()` without `indent=2`); (4) if a full dataset scan is needed, write a deterministic helper script that outputs a compact worklist (see `lin-score-worklist.mjs` as the reference pattern). Target: <80KB stdout per cron script.

## 10. Canonical answers rule

`companies/{co}/jobs/{slug}/resumes/application-answers.md` is the single source of truth for ALL application answers, including references. `reference-answers.md` is a convenience mirror — patch `application-answers.md` first, then sync the mirror. Never edit them independently. Never fabricate reference names/emails; mark unknowns `[FILL IN]`. **Never send any email without the user's explicit "yes, send it" — save to drafts/files instead (hard rule).**
