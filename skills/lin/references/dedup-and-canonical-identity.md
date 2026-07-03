# Lin — Canonical identity & de-duplication

The single definition of "the same job" lives in `scripts/lib/canonical.mjs`. Every
layer (discovery, promotion, dashboard render, dedup backfill) imports from it so a
job can't be "the same" to the scanner but "different" to the dashboard. Load this
reference when reviewing or changing anything that groups, collapses, or marks
duplicate jobs.

## The helpers

- `slugify(s)` — lowercase, `&`→`and`, non-alphanumeric→`-`, trimmed.
- `normalizeTitle(title)` — strips ALL parentheticals, collapses whitespace, lowercase.
  Used by `canonicalKey` (the LOOSE key — render-time only).
- `canonicalKey(company, role)` → `"co::role"` — the loose identity. Parentheticals
  are stripped, so `"PM (Growth)"` and `"PM (Payments)"` at the same company produce
  the SAME key. Safe for render collapse (reversible, siblings visible); NOT safe for
  destructive mutation.
- `hasCanonicalIdentity(key)` — true only when both sides are non-empty. Degenerate
  keys (`"::"`, `"acme::"`, `"::pm"`) must never merge — callers fall back to
  per-row uniqueness. Also catches `(manual add)` / `(unscored)` placeholders because
  `slugify(normalizeTitle("(unscored — added by URL)"))` → `""`.
- `strictTitleKey(title)` — the STRICT identity for destructive paths. Drops only
  LOCATION parentheticals (via `isLocationOnly`); keeps meaningful qualifiers like
  `(Growth)`, `(Payments)`, `(AI Builder)`, `(Practice Nexus)`, `(Marketplace)`.
- `canonicalizeUrl(rawUrl)` — board-normalized URL: Indeed `jk=`, LinkedIn
  `/jobs/view/<id>`, Greenhouse `job-boards`→`boards`, everything else host+path
  with query/hash dropped.

## Render-vs-destructive principle (the core design rule)

**Render-time collapse can be loose; persisted mutation must be strict.**

- `collapseDuplicates()` in `tracker-data.mjs` groups by the LOOSE `canonicalKey` and
  picks a primary. Siblings stay visible in the expander. Fully reversible — no data
  file is touched. This is correct.
- `lin-dedup-backfill.mjs` persists `queue_state: duplicate` / flips `[ ]`→`[x]`.
  This is destructive (reversible only via backup). It MUST require `strongMatch()`
  evidence: same `canonicalizeUrl`, explicit `dup_of`, or `strictTitleKey` equality.
  Weak-evidence same-key pairs go to `data/duplicate-uncertain-review.md` unmutated.

If you ever add a new destructive dedup path, use `strictTitleKey` + `strongMatch`,
never the loose `canonicalKey` alone.

## `LOCATION_WORDS` audit (known false positives/negatives)

`isLocationOnly(inner)` returns true when every token in the parenthetical is in
`LOCATION_WORDS`. The list is in `canonical.mjs:46-58`. Known gaps (verified
2026-06-24, no impact on current data):

**False positives** (treated as location → would merge distinct roles):
- `"global"` — `PM (Global)` merges with `PM`. "Global" can be a team name.
- `"first"` — from "Remote First"; `PM (First)` would merge.
- `"office"` — `PM (Office)` could be an office-team qualifier.
- `"time"` — from time-zone vocab; `PM (Time)` would merge.

**False negatives** (treated as meaningful → kept distinct, safe direction):
- Missing: `jersey`, `delhi`, `tokyo`, `australia`, `tel`, `aviv`, `sydney`.
- `(Remote - Sydney)` would NOT be treated as location-only → sent to uncertain
  review instead of auto-merged. This is the safe over-strict direction.

When adding locations to `LOCATION_WORDS`, add cities/regions but avoid common
English words that could appear in team/product names (`global`, `first`, `office`,
`time` are already problematic).

## `job_slug` placeholder collision (root cause of ScaleAI-type false dups)

Multiple distinct roles at the same company can share a placeholder `job_slug`
(e.g. all ScaleAI queue rows had `job_slug: scaleai`), producing the same
`canonical_key: scaleai::scaleai`. This makes genuinely different roles look like
duplicates.

**Detection:** check `data/evaluation-queue.json` for rows where `co_slug` and
`job_slug` are identical across different `role` strings with different `url`s. The
fix is to give each row a real `job_slug` derived from its role title (via `slugify`),
not to tighten the dedup. The dedup correctly sends these to uncertain review — the
data is the problem, not the tooling.

## Primacy ordering (render vs backfill must agree)

Render (`tracker-data.mjs`): `KIND_RANK = { job: 2, queue: 1, pending: 0 }` →
`STAGE_PRIMACY` (offer=100 … skip=10) → score → updated date. Closed folders are NOT
demoted — a fresh pending repost of a closed role can be collapsed under the old
closed job row and disappear from Pending.

Backfill (`lin-dedup-backfill.mjs`): `typeRank = { active-folder: 3, queue: 2,
pending: 1, archived-folder: 0 }` → `FOLDER_STAGE` → score. Archived folders ARE
demoted.

**Known gap:** render does not demote closed folders; backfill does. A closed-folder
repost admitted by discovery can be hidden by render collapse. If reported, the fix
is to add archive/live awareness to `collapseDuplicates` (skip collapse between
archived records and fresh live records, or demote archived folders below live
queue/pending).

## Duplicate folder pair resolution (manual review pattern)

When two job folders share a canonical key (`data/duplicate-folders-review.md`),
decide by reading BOTH `job.yml` files:

1. **Same source URL** (after `canonicalizeUrl`) → same posting. Keep the
   furthest-stage / earliest-applied one; close the other (`status: closed`,
   `outcome: duplicate`, `source_duplicate_of: <kept slug>`).
2. **Different URL, same title** → likely same role from different boards
   (LinkedIn vs Greenhouse/Ashby). Check `applied_at` on both — if both applied,
   flag as a possible double-application for the user to verify.
3. **Different URL, different title** (only parenthetical/location differs) →
   usually same role; keep the applied one.
4. **Different greenhouse job IDs** but same title → usually same role reposted
   under a new ID; keep the applied one.

**Keep heuristic:** prefer `status: applied` > `materials_ready` > `built`; within
the same status, prefer higher `pathfinder_score`; within same score, prefer the one
with `source_canonical_key` set (newer, better provenance).

## Backfill safety contract

`lin-dedup-backfill.mjs`:
- Default is dry-run (`--apply` to commit). Always dry-run first.
- `--apply` writes a timestamped backup to `backups/dedup-backfill-<ts>/` before
  touching `evaluation-queue.json` or `pipeline.md`.
- NEVER deletes records — only sets `queue_state: duplicate` / flips `[ ]`→`[x]`.
- NEVER touches job folders — duplicate folders are reported to
  `data/duplicate-folders-review.md` for manual review.
- Idempotent: re-run dry-run after `--apply`; expect 0 marks.
- Restore: `cp backups/dedup-backfill-<ts>/evaluation-queue.json data/` and
  `cp backups/dedup-backfill-<ts>/pipeline.md data/`.