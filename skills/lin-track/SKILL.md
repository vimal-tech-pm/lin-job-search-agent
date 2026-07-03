---
name: lin-track
description: Regenerate and read the Lin dashboard/tracker (applications.md/html, resume-engine-usage, outcome-funnel). Deterministic — the scheduled job is no_agent; this skill is the interactive twin.
user_invocable: true
args: verb
argument-hint: "[run | describe]"
---

# lin-track — tracker & dashboard

Workdir: `~/.hermes/profiles/lin/lin`. **Deterministic — does not need LLM judgment.** The scheduled `lin-track` cron is `no_agent` and runs `scripts/lin-track-digest.sh` (tracker + stale-applied report + leftovers; stdout = the Telegram digest). This skill exists for interactive runs and for humans reading the spec.

## Verbs

- `run` — regenerate everything:
  ```bash
  node scripts/lin-tracker.mjs
  ```
  Walks every `companies/*/jobs/*/job.yml`, merges `engines/pathfinder/data/applications.md` + `data/evaluation-queue.json`, rewrites `data/applications.md` (markdown view), `data/applications.html` (dashboard — open at `http://127.0.0.1:7777/`, not `file://`), `data/resume-engine-usage.md` (28-day PATHFINDER/FORGE A/B usage — NOT an interview rate), and `data/outcome-funnel.md` (the real applied → interview → final → offer funnel + rejection depth). Then print `data/applications.md`'s Funnel + Counts sections (or summarize in chat if asked).
- `describe` — list what the tracker rebuilds and the digest format; do NOT execute anything.

## Notes

- Every mutating pipeline script (package/apply/wont-apply/promote) already refreshes the tracker — manual `run` is for "show me now", not a required step.
- Scripts are `.mjs` only — the same files cron invokes; never create `.js` copies.
- Dashboard behavior lives in `scripts/templates/dashboard.js` and `scripts/templates/dashboard.css`, then gets inlined into `data/applications.html` by `node scripts/lin-tracker.mjs`. For expand/collapse UX, prefer row-level handlers on `tr.r` with an interactive-element guard (`a,button,input,select,textarea,label,[role='button'],[data-act]`) so clicking normal row space toggles details while action buttons/checkboxes/links keep their own behavior. Update the `.xbtn` glyph/title (`▸`/`▾`) and add cursor styling when making rows clickable.
- Lifecycle buckets per `~/.hermes/profiles/lin/skills/lin/references/conventions.md` §1: Staged → Built → Materials ready → Applied → Interviewing → Offer → Closed; legacy `new/decoding` normalize to staged on read.
- The scheduled digest (from `lin-track-digest.sh`): funnel block verbatim + `⏳ stale: {co/slug} — applied {n}d ago` (top 5 >7d) + leftovers lines. Script failure delivers an error alert (no_agent semantics — it cannot fail silently).

## Adding a new job.yml field to the dashboard (3-edit recipe)

The data flow is `job.yml` → `scripts/lib/tracker-data.mjs` (the ONLY disk reader) → `scripts/lib/tracker-html.mjs` (renderer). To surface a new field:
1. **Writer** — whatever produces the field writes it into `job.yml` (e.g. `lin-build` stamps `build_model`/`build_provider`/`built_at` on gate-pass).
2. **tracker-data.mjs** — map it onto the row object in BOTH row constructors: the folder-walk block (`j.build_model || null`) AND the queue-row block (`r.build_model || null`). Miss one and queue-sourced rows silently lose the field.
3. **tracker-html.mjs** — render it in `expandCell`'s `kv` chip array, guarded by `if (r.field)`. Use `class="kv secondary"` for a subtle footer/meta chip (e.g. the `🤖 built by glm-5.1/crof` provenance chip).

Verify end-to-end before trusting it: append the field to one real `job.yml`, run `node scripts/lin-tracker.mjs`, then grep `data/applications.html` for the rendered text. Revert the test stamp and regenerate afterwards so no folder carries fake data.

## Adding a client-side filter to the dashboard (no backend change)

Need a filter/grouping derived from existing row data (e.g. seniority level, domain, role type) without touching job.yml or tracker-data.mjs? The 4-step recipe:

1. **tracker-html.mjs** — add a helper function that derives the value from the row (e.g. `seniorityLevel(r.role)`). In `rowHtml()`, emit `data-level="..."` on the `<tr class="r">` alongside the existing data- attributes.
2. **tracker-html.mjs** — add a `<select id="f-level">` dropdown in `renderHtml()`'s filter bar, next to the existing source/score/canada filters.
3. **dashboard.js** — add the filter check in `rowVisible()` (same pattern as the source filter: read `#f-level`.value, compare against `tr.dataset.level`). Wire the element ID into the input-listener array.
4. **Regenerate** — `node scripts/lin-tracker.mjs` (the HTML is static — template edits alone won't appear until regenerated).

No changes to `tracker-data.mjs`, `job.yml`, or any backend pipeline. See `references/adding-client-filters.md` for a worked example (seniority level filter implementation).

## Gotchas

- **Regeneration after template edits is required** — `applications.html` is a static file inlined from `dashboard.js`/`dashboard.css`/`tracker-html.mjs`. Editing these source templates alone does NOT update the dashboard. You MUST run `node scripts/lin-tracker.mjs` to write the new HTML. If the user reports "I don't see the change after refresh", this is the almost-certain cause.
- **`collapseDuplicates` groups by the LOOSE `canonicalKey`** (parenthetical-stripped) — see `lin/references/dedup-and-canonical-identity.md`. This is correct for render (reversible, siblings visible in expander). But it means `"PM (Growth)"` and `"PM (Payments)"` at the same company collapse to one row visually. If the user sees a role disappear from a rail, check whether it was collapsed as a dup sibling of another row with the same loose key. The destructive backfill uses `strictTitleKey` (keeps meaningful parentheticals) so it won't false-mark them — but render will still hide one.
- **Primacy ordering does NOT demote closed folders** — `collapseDuplicates` ranks `job > queue > pending` via `KIND_RANK` + `STAGE_PRIMACY`, but a closed folder (status=closed, outcome=rejected/expired) still has `kind: job` and can win primacy over a fresh pending repost of the same role. The backfill demotes archived folders (`typeRank: 0`); render does not. A genuine repost admitted by discovery can be collapsed under the old closed job row and disappear from Pending. If reported, add archive/live awareness to `collapseDuplicates`.
- **The job.yml parser is a hand-rolled minimal YAML reader (`loadJobYml` in tracker-data.mjs), NOT a real YAML lib.** Flat top-level keys (`build_model: glm-5.1`) parse automatically wherever they sit in the file — even appended AFTER a nested block like `artifacts:`, because an unindented `key: value` line resets the block context. But NESTED blocks (`build_meta:\n  model: ...`) are SILENTLY IGNORED unless the block name is whitelisted (the parser hardcodes `artifacts`/`applied_with`/`source`). Lesson: for new fields, prefer flat keys — zero parser changes, work for free. Only nest if you also edit the whitelist.
- SKIP rows (<3.0) render in their own section — they must stay visible, never mixed into Review or hidden.
- A row can stay visually geo-blocked after `canada_eligible` is fixed if `geo_gate.blocks_stage` is still true — dual-field repair (see lin-stage gotchas).
- **`furthest_stage: closed` silently erases the high-water mark** — `furthest_stage` accepts STAGES values only (`none`, `applied`, `interviewing`, `final`, `offer`). The LLM status cron sometimes writes `furthest_stage: closed` (a STATUS, not a STAGE). `normalizeStage('closed')` floors to `none`, so `computeFunnel()` treats the job as never having applied — dropping it from the applied count and the interviewing count. If the funnel numbers don't match the Active/Closed rail counts, grep for `furthest_stage: closed` across `companies/*/jobs/*/job.yml` and fix any hits to the correct stage (`applied` for pre-interview rejections, `interviewing` for post-interview rejections). See `lin-status` gotcha "furthest_stage must be a STAGES value" for the cron-side fix.
