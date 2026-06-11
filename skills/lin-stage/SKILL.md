---
name: lin-stage
description: Lin stage 3a — promotion. Selects build candidates (hybrid top-N + requested), verifies posting liveness (web_extract first, browser fallback), and stages job folders. Part of the Lin pipeline scan → score → stage → build → finalize → apply.
user_invocable: true
args: verb
argument-hint: "[auto | --id NNN | --top N | --threshold X | describe]"
---

# lin-stage — promotion & liveness

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§1 lifecycle, §4 hybrid trigger, §6 lockfile, §8 digest). Staging only — no resume content, no packaging.

## Verbs

- `auto` (the cron verb) — hybrid selection: top `auto_build_top_n` eligible rows ≥ `auto_build_floor` ∪ all `build_requested` rows ≥ `promote_threshold` (the script computes it; never re-derive).
- `--id NNN` — stage one queue row (used by `/lin prepare` express lane and manual promotion).
- `--top N` — stage the N best eligible rows ≥ `promote_threshold`, ignoring floor/requested (the old top-prepare behavior; pairs with `bin/lin-run build && finalize`).
- `--threshold X` — one-off threshold override (rare; greenfield-style drains).
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Workflow (`auto`; other verbs swap the flags in steps 2/5)

1. **Lockfile** per conventions §6 (`.lin-stage.lock`; stale >2h → delete and proceed; fresh → exit silently).
2. **List candidates** (no side effects):
   ```bash
   node scripts/lin-promote-evaluations.mjs --list-candidates --json --auto
   ```
   Candidates carry `selected_by: auto-top-n | build_requested`, `job_folder`, `needs_promotion`, `folder_state`.
3. **Liveness ladder** for each candidate with `needs_promotion: true` (skip already-staged):
   - **(a) web_extract the URL.** Classify:
     - explicit closed / no-longer-accepting / filled / 404 / 410 → `expired`.
     - `active, apply_path_found: true` ONLY when ALL hold: no closed signal; extracted title+company match the queue row (normalized); concrete form/submit evidence (Greenhouse/Lever/Ashby application-form fields, or an apply URL returning 200 with name/email/resume fields).
     - JD text alone, a redirect to a careers index, or a different job id/title → `uncertain` (fall to b).
   - **(b) browser fallback** for uncertain/failed extraction (Workday, LinkedIn, SPAs): sequential `browser_navigate(candidate.source_url)` — never parallel. `active` requires role/company visible AND a visible/clickable Apply / Easy Apply / application path. JD text alone is NOT active.
   - **(c) browser unavailable too** → `uncertain`, hold. **Never stage on JD text alone.**
   - Record per candidate: `{id, checked_url, status, apply_path_found, checked_at, evidence}` — evidence names the board type, matched title, and form signal.
4. Write `/tmp/lin-liveness-stage.json` as `{"checked_by":"hermes","results":[…]}`.
5. **Promote** (the script stages only `active` + verified apply path):
   ```bash
   node scripts/lin-promote-evaluations.mjs --auto --liveness-file=/tmp/lin-liveness-stage.json
   ```
   Staged folders get `status: staged`, `ats_winner: null`, `job.yml`/`job.md`/`status-history.md`/`pathfinder-eval.md` per conventions §2.
6. `node scripts/lin-tracker.mjs`, remove the lockfile.

## Digest (Telegram)

```
🎯 Lin stage — {YYYY-MM-DD}
Auto-selected: {n} (top-{auto_build_top_n} ≥ {auto_build_floor}) · Click-requested: {m} · Below floor: {k}
Staged: • {Company} — {role} ({score}) — {selected_by}            ← per staged role
Held/expired: • {Company} — {liveness.status}: {evidence}         ← per held role
staged awaiting build: {N} · built awaiting finalize: {M}         ← from scripts/lin-worklist.mjs
```
- Nothing eligible and nothing held: silent (no message).
- Failure variant: `⚠️ stage failed: {one-line cause}; queue untouched beyond rows already staged.`

## Gotchas

- **Dead canonical URL, live LinkedIn mirror** — don't close the row immediately; verify the LinkedIn page (browser), update the row's `source_url`/`jd_snapshot`, supply an external active liveness entry, promote by `--id`. See `references/dead-primary-live-linkedin-promotion.md`.
- **Blocked rows need dual-field repair** — unblocking requires `canada_eligible: "yes"` (+quoted reason) AND `geo_gate: {reason: null, blocks_stage: false}`. One without the other keeps the row visually blocked.
- **Big drains need the geo sanity audit** — after staging many roles, sample fetched titles/locations vs queue rows; redirects and boilerplate lie. Correct queue + report, re-validate.
- **Run-status questions** — when the user asks "did stage run / how many were staged?", verify via the latest cron output + new `job.yml` files per `references/prepare-cron-status-checks.md`; never infer from caps or queue size.
