---
name: lin-build
description: Lin stage 3b — resume content generation (the only frontier-model stage). Builds FORGE + PATHFINDER tailored resumes for staged folders, renders PDFs, enforces the quality gate, sets status built. Part of the Lin pipeline scan → score → stage → build → finalize → apply.
user_invocable: true
args: verb
argument-hint: "[batch | <co-slug/job-slug> | --generic <role-title> | describe]"
---

# lin-build — resume content (frontier)

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§1 lifecycle, §5 gate marker, §6 lockfile, §9 environment). **Build only**: no liveness checks, no ATS compare, no answers, no packaging — that is lin-stage / lin-finalize. Source of truth for ALL content: `career-profile/resume.md` + `career-profile/experience.md`. **Never invent metrics or experience.**

## Verbs

- `batch` (the cron verb) — build every folder in the staged worklist.
- `<co-slug/job-slug>` — rebuild one role from scratch (works regardless of current winner; re-render is always from the masters).
- `--generic <role-title>` — master-resume workflow (no employer): synthetic JD under `company_slug: generic`, output copies to `~/resumes/`. Full recipe: `references/core-resume-workflow.md`.
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Workflow (`batch`)

1. **Lockfile** per conventions §6 (`.lin-build.lock`).
2. **Worklist** (deterministic; never glob ad hoc):
   ```bash
   node scripts/lin-worklist.mjs --status staged --json
   ```
3. **Per folder** (process in worklist order; on any hard provider failure — 429/quota — STOP CLEANLY: report what was built, leave the rest `staged` for the next run):
   1. **FORGE:** invoke `engines/forge/references/commands/resume.md` as sub-prompt in JD-targeted mode — inputs `career-profile/resume.md` (master), `career-profile/experience.md` (evidence), the folder's `job.md`. Start from the master, never a prior tailored variant; preserve every metric exactly; output buildable markdown per `engines/forge/resume-factory/references/md-format-spec.md` → `resumes/forge.md`. Render:
      ```bash
      HOME=~ node engines/forge/resume-factory/scripts/build-resume.js \
        companies/{co}/jobs/{slug}/resumes/forge.md executive-clean \
        companies/{co}/jobs/{slug}/resumes/forge --pdf
      ```
   2. **PATHFINDER:** invoke `engines/pathfinder/modes/pdf.md` as sub-prompt with `job.md` → tailored HTML at `/tmp/cv-lin-{slug}.html`. Render:
      ```bash
      HOME=~ node engines/pathfinder/generate-pdf.mjs \
        /tmp/cv-lin-{slug}.html companies/{co}/jobs/{slug}/resumes/pathfinder.pdf --format=letter
      ```
   3. **Quality gate:** `python3 scripts/lin-verify-resumes.py companies/{co}/jobs/{slug}/`
      - exit 0 → **write `resumes/gate-pass.json`** per conventions §5, set `job.yml` `status: built`, append status-history row, **and stamp build provenance into `job.yml`** (flat keys, so the tracker parser reads them): `build_model: {model id}`, `build_provider: {provider id}`, `built_at: {ISO timestamp}`. Use the model/provider this run is actually executing on (per-role if a fallback fired). These surface as a subtle "🤖 built by" meta chip on the dashboard card.
      - exit 1 (fixable: page fill/count/density) → retry up to `prepare_retry_budget` from pipeline-config: PATHFINDER issues → regenerate HTML with tighter recency-tier bullet caps (e.g. 3/2/2/1), font ±0.2px, line-height ±0.03; FORGE issues → trim `forge.md` bullets from older roles. Still failing → leave `staged`, NO gate marker, record for the digest. **Never ship a bad PDF silently.**
      - exit 2 (hard: missing files) → leave `staged`, report.
4. Remove the lockfile. (No tracker refresh needed — finalize and the track job handle display.)

**Exception — user asks about pipeline state mid-cycle:** Between build (~22:30) and finalize (~23:15), the dashboard (`applications.md`/`.html`) is stale — it still shows roles as `staged` when they're actually `built`. If the user asks "what's in the pipeline" or "why aren't my jobs built" during this window, ALWAYS run `node scripts/lin-tracker.mjs` manually before answering. Do not trust the existing dashboard data. After refresh, the funnel line will show `Built / awaiting finalize: N` instead of `Staged / awaiting build: N`.

**Exception — user asks about specific "N staged" that never materialised:** When the user says "there are N staged jobs, why weren't they built?" and current staged=0, the N is almost always the sum of two evening cycles' stage output (e.g. 9 from last night + 5 from tonight = 14). The earlier batch built and finalized already; the later batch staged and built the same night but the user saw stale dashboard data showing them as staged instead of built. **Diagnosis checklist:**
  1. Run `node scripts/lin-tracker.mjs` to refresh the dashboard immediately.
  2. Check `lin-stage` cron output for the most recent evening run (in `~/.hermes/profiles/lin/cron/output/lin-stage/`) — look for broken-pipe/RuntimeError indicating stage silently failed.
  3. Check `lin-build` cron output for the matching run — verify how many were actually built.
  4. Run `grep -r "status:" companies/*/jobs/*/job.yml | sort` to count current state by status.
  Report: `{N} = {last-night-staged} (already built+finalized) + {tonight-staged} (just built, awaiting finalize) — 0 actually left in staging.`

## Bulk re-prepare recipe (manual, occasional)

When the user wants pathfinder-only winners rebuilt so FORGE gets a fresh shot: find `materials_ready` + `ats_winner: pathfinder` folders, confirm the list with the user, then per folder run the single-role verb (waves of ≤7 parallel subagents). Afterwards report which flipped. The folders re-enter at `built` (compare re-picks the winner in finalize).

## Parallel batch builds for large staged sets (>10 roles)

When the staged worklist has 10+ roles, a single subagent will hit the 50-iteration tool-call limit before completing all builds — the agent dies mid-run leaving a stale lockfile and orphaned `built` folders with no gate-pass markers. Split into parallel subagents:

- **Sweet spot:** 5 roles per subagent — but ONLY with fast models (glm-5.1/opencode-go, deepseek). With slower models (glm-5.2 via CrofAI), even 5 roles can timeout at 600s because FORGE generation + render + PATHFINDER generation + render + gate is ~120s per role × 5 = 600s with no margin.
- **At 12-13 roles per subagent:** some will time out (especially if PATHFINDER needs retries for page fill).
- **At 20+ roles per subagent:** guaranteed timeout — don't do it.
- **4 parallel batches of 5** = 20 roles in one wave. Repeat waves for larger sets.
- **FORGE/PATHFINDER split-wave technique (for slower models):** When 5-role subagents timeout with a slow model, split the work: wave 1 builds FORGE only (all 5), wave 2 generates PATHFINDER only for folders that got FORGE. This halves the per-subagent work and fits within 600s. The gate check can be run manually between waves for any folder that has both PDFs.

1. **Skip the global lockfile** — parallel manual runs don't need it. The lockfile is for cron mutual exclusion.
2. **Split the worklist deterministically** — run `node scripts/lin-worklist.mjs --status staged --json`, partition into groups of 5.
3. **Each subagent builds its own list** — FORGE + PATHFINDER + render + gate for every assigned folder. No cross-talk.
4. **After all subagents finish**, finalize the full built worklist.

Never split a folder's FORGE and PATHFINDER across different subagents — both renders must land in the same `resumes/` directory before the gate runs.

## Archiving previous builds for A/B model comparison

When rebuilding roles with a different model, archive the existing `materials_ready` folders
first so they don't get mixed in:

```bash
mkdir -p archive-{model-name}
# Move all materials_ready folders out of companies/
python3 -c "
import os, shutil
for root, dirs, files in os.walk('companies'):
    if 'job.yml' in files and root.count(os.sep) == 3:
        with open(os.path.join(root, 'job.yml')) as f:
            if 'status: materials_ready' in f.read():
                dest = os.path.join('archive-{model-name}', root)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.move(root, dest)
"
```

The archived folders are preserved for reference; the queue state stays `materials_ready`
so the tracker still shows them. If you want them re-staged for fresh builds, reset their
queue state and they'll re-enter the pipeline on the next stage run.

## Subagent model routing (manual runs only)

`delegate_task` subagents inherit the parent session's model — there is no per-subagent model
override. When the user explicitly wants a different model for builds (e.g., glm-5.1 instead of
deepseek-v4-pro):

- **Use a one-shot cron job** with the pinned model: `cronjob(action='create', model={'model':'glm-5.1','provider':'crof'}, schedule='1m', repeat=1, skills=['lin-build'], ...)`. Cron jobs run with their configured model regardless of the session model.
- **Alternatively**, accept the session model for manual runs — the resume content quality differences between frontier models on the same FORGE/PATHFINDER prompts are marginal. The engine prompts are the quality control, not the model running them.
- **The lin-build cron** (job_id: lin-build) currently pins glm-5.2/neuralwatt. Manual runs that want the same model should either wait for the next cron tick or use the cron-job pattern above.

## Digest (Telegram)

```
🛠️ Lin build — {YYYY-MM-DD} — model: {model actually used; per-role if a fallback fired}
Built: • {Company} — {role} — FORGE {p}p · PATHFINDER {p}p — gate PASS      ← per role
Gate failed after retries: • {Company} — {specific issues}                  ← per failed role
staged awaiting build: {N}                                                  ← leftovers, from lin-worklist
```
- Empty worklist: silent (no message).
- Quota variant: `⚠️ provider limit after {n} roles; {m} staged remain — next run resumes automatically.`

## Model selection / A/B testing

lin-build is the **only frontier-model stage** in the pipeline. When evaluating cheaper replacements:
- Use `provider_models_cache.json` (`~/.hermes/provider_models_cache.json`) as the authoritative model list — not `config.yaml` providers block or `pricing.json` model seeds, which lag behind what the provider actually exposes.
- The non-interactive harness command is: `hermes --profile lin chat -m MODEL --provider PROVIDER -t file,web,terminal -s lin-build -q "PROMPT"`
- Freeze inputs (job.md + job.yml reset to `status: staged`, resumes/ wiped) before each arm so all models see byte-identical inputs.
- Ground-truth gate result comes from `resumes/gate-pass.json` existence + `job.yml status: built` — not model self-report alone.
- Token counts from model self-report are proxies; actual billing uses subscription flat rates today but design for PAYG.
- See `references/ab-test-methodology.md` for the full test strategy and scoring rubric.

## Model selection
The recommended model for this skill is **glm-5.1 / opencode-go** — matched gpt-5.5 on
avg iterations (1.2), gate-pass rate (4/4), and fabrication risk (LOW) at 85% lower PAYG
cost. See `references/ab-test-model-selection.md` for full A/B results and decision rubric.
Always frame model cost on PAYG token rates, not flat subscription pricing.

## Gotchas

- **`renderJobYml` null title (FIXED 2026-06-18)** — `renderJobYml()` in `lin-promote-evaluations.mjs` uses `role.role` for the job title. But some queue entries have `role: null` while the actual title is in `role.title`. This results in `job.yml` containing `title: null`. Fix: `renderJobYml` should fall back to `role.title || role.job_title || "Not specified"` when `role.role` is null/empty. Affects jobber/staff-product-manager-invoicing. Manual fix: edit job.yml directly with the correct title from the queue entry.
- **Archive folder dedup** — `archive-deepseek/companies/` may contain folders for roles that were built, packaged, then archived before a pipeline reset. These are NOT checked by scan or stage dedup, so archived roles get re-scanned, re-staged, re-built, and re-finalized — showing up in the ready queue again. When the user reports `materials_ready` roles that feel like duplicates, check `archive-deepseek/companies/{slug}/jobs/` for folders with matching `source_url` or company+title. If the archive version has the same `source_url`, close the new one as `status: closed` with `status_detail: "closed: Duplicate of archived same role"`. Manual check only — no automated archive dedup exists.
- **FORGE phone number format — ATS parsing failure (FIXED 2026-06-18)** — the master resume used `+1 555 000 0000` (with + sign, spaces, and country code). ATS parsers commonly fail on this format: the `+` sign gets stripped or misinterpreted, spaces split the number into fragments, and the country code prefix confuses US/Canada-focused parsers. The user reported that ONLY the phone number failed to parse on job sites — all other fields (email, linkedin, location, name, bullets, metrics) parsed fine. This means the CID font encoding was NOT the primary issue. **Fix applied:** changed phone to `555-000-0000` (dashes, no country code) in `career-profile/resume.md`, `career-profile/profile.yml`, 168 active `companies/*/resumes/forge.md` files, and all Python/shell scripts with hardcoded phone. The country code is redundant for Canadian/US job applications.
- **FORGE page 2 top margin missing (double-margin stacking bug) (FIXED 2026-06-18)** — the FORGE PDF pipeline had two margin layers that stacked on page 1 but not on page 2. Layer 1: Playwright `page.pdf()` margins in `render-pdf-playwright.mjs` (was top/bottom: 0.40in, sides: 0.50in) — applied to every page uniformly. Layer 2: CSS `.page` div padding in `templates/executive-clean.html` — applied once at the top of the div (page 1) and once at the bottom (last page), but NOT at page breaks. Result: page 1 got 0.80in top margin, page 2 got only 0.40in. **Fix (3 edits):** (1) removed `@page { margin: 0 }` from `executive-clean.html` (was blocking Playwright margins), (2) set `.page { padding: 0 }` (removed double-stacked CSS padding), (3) bumped Playwright margins from 0.40in to 0.50in top/bottom. **CRITICAL PITFALL:** `git checkout` / `git stash` / `git stash pop` on these files REVERTS the fix — this already happened once when cleaning up experiment artifacts. Always verify after any git operation: `grep -n "0.50in" engines/forge/resume-factory/scripts/render-pdf-playwright.mjs` and `grep -n "padding: 0" engines/forge/resume-factory/templates/executive-clean.html`. Verify page 2 margin visually: `pdftoppm -png -r 150 <pdf> /tmp/page && python3 -c "from PIL import Image; img=Image.open('/tmp/page-2.png'); ..."` — both pages should have ~0.55in top margin.
- **FORGE PDF ATS font investigation — CID subsetting** — Playwright/Chromium subsets all fonts as CIDFontType2 + Identity-H. Carlito (Calibri-compatible) is an obscure font name that may worsen ATS recognition. The proven fix is to switch `executive-clean.html` from Carlito `@font-face` blocks to system `Liberation Sans` (Arial-compatible, pre-installed at `/usr/share/fonts/truetype/liberation/`). However, the user confirmed only the phone number was failing to parse — all other text parsed fine with Carlito. So the Liberation Sans switch is beneficial but NOT urgent. Full investigation, failed approaches (Ghostscript, hidden text layers, data URIs), and verification steps in `references/ats-cid-font-parsing.md`.
- **FORGE page limits** — 2 pages (or 3 with page 3 ≥55% fill), enforced by the gate. Overflow → trim older-role bullets; edits to the folder's `forge.md` are throwaway (recreated each run); durable content fixes belong in `career-profile/`.
- **PATHFINDER long-career overflow** — 7+ roles/18+ years can blow 2 pages even at default caps; expect the iterate loop (generate → render → gate → trim → repeat). A 2-page PDF with page 2 only 20% full also fails.
- **`lin-verify-resumes.py` path must include `jobs/`** — the gate script expects the full relative path `companies/{co}/jobs/{slug}/`, NOT `companies/{co}/{slug}/`. Passing `companies/ebay/sr-product-manager-listings-flow` (missing `jobs/`) returns exit 2 with "Not a directory" even though the folder exists at `companies/ebay/jobs/sr-product-manager-listings-flow/`. This is easy to get wrong when the worklist returns `{company_slug}/{job_slug}` without the `jobs/` segment.
- **Manual gate-pass for subagent-completed folders** — when subagents timeout mid-batch, some folders have both PDFs rendered but no `gate-pass.json` and `job.yml status` still `staged`. Run the gate check manually: `python3 scripts/lin-verify-resumes.py companies/{co}/jobs/{slug}/` (with correct path). On exit 0, write `resumes/gate-pass.json` (`{"passed": true, "forge_pages": 2, "pathfinder_pages": 2, "checked_at": "ISO"}`), update `job.yml` (status→built, build_model, build_provider, built_at), and append status-history. This recovers subagent timeouts without re-running the full build.

- **Fallback provider stamps builds with wrong model** (discovered 2026-06-28) — when a cron build uses a provider-specific model (e.g. `glm-5.2-short` on `neuralwatt`) and the primary provider returns 429/timeout, Hermes' global fallback chain fires. The subagent stamps `build_model` and `build_provider` with the *fallback* model, not the cron's pinned model. In this session, 15/235 built resumes were stamped `build_model: deepseek-v4-flash` because the fallback chain was `[{model: deepseek-v4-flash, provider: opencode-go}]`. **Diagnosis:** `grep "build_model:" companies/*/jobs/*/job.yml | sort | uniq -c | sort -rn` — if any model doesn't match the cron's pinned model, the fallback fired. **Fix:** either (a) set the fallback to the same model family as the cron's primary (e.g. `glm-5.2` on `ollama-cloud` for a `glm-5.2-short` cron), or (b) remove fallback entirely (`fallback_providers: []`) — but this makes builds crash on provider errors instead of failing over. Fallback config lives in `~/.hermes/profiles/lin/config.yaml`. Always verify model availability on the target provider via `~/.hermes/provider_models_cache.json` before configuring (grep for the model id in the provider's models list). Also consult `~/.hermes/user_docs/readme_LLM.md` before making LLM config changes — the user keeps this reference for shared vs per-profile config.
- **Manual page-fill fix recipes (for timed-out subagent recovery)** — when a subagent times out leaving PDFs that fail the gate, you can fix them directly without regenerating content:
  - **PATHFINDER 3 pages → 2 pages:** `sed -i 's/font-size: 11px;/font-size: 10.5px;/g' /tmp/cv-lin-{slug}.html && sed -i 's/line-height: 1.5;/line-height: 1.4;/g' /tmp/cv-lin-{slug}.html && sed -i 's/font-size: 10.5px;/font-size: 10px;/g' /tmp/cv-lin-{slug}.html && sed -i 's/margin-bottom: 14px;/margin-bottom: 10px;/g' /tmp/cv-lin-{slug}.html && sed -i 's/margin-bottom: 12px;/margin-bottom: 8px;/g' /tmp/cv-lin-{slug}.html` then re-render with `generate-pdf.mjs`. Check if 2 pages → run gate.
  - **PATHFINDER page 2 <65% fill:** bump font sizes UP: `sed -i 's/font-size: 10.5px;/font-size: 11px;/g'` and `sed -i 's/line-height: 1.4;/line-height: 1.55;/g'` — this expands content to fill page 2.
  - **FORGE 3 pages → 2 pages:** trim the 2 oldest roles (early career: Software Test Engineer, Management Consultant Intern) from `forge.md`. Each role is ~4 lines. Re-render with `build-resume.js`.
  - **FORGE page 2 <65% fill:** add back one trimmed role (e.g. Software Test Engineer with 1 bullet) to increase page 2 content.
  - **Always re-run the gate after any fix:** `HOME=~ python3 scripts/lin-verify-resumes.py companies/{co}/jobs/{slug}/` — the gate checks both PDFs, so a FORGE fix doesn't require a PATHFINDER re-render and vice versa.
- **Affirm dedup blocks re-staging** — if a role was previously applied to (status: applied in a different job folder under the same company), the promote script's `isAlreadyApplied()` check blocks re-staging even for a different role at the same company. The queue entry will silently not match. This is correct behavior — check existing folders before attempting promotion.
- **Closed-folder dedup blocks `--id` promotion** (discovered 2026-06-28) — `existingJobFolderRel(role)` in `isPromotionSelectable()` also blocks `--id` promotion when ANY existing job folder for the same `co_slug` exists with `status: closed`, even for a completely different role/URL. The only symptom is "No candidates matched" from the promote script. **Fix:** check `find companies/{co_slug} -name job.yml` for existing folders before promoting. If a closed folder exists, the new role cannot be promoted via `--id` — pick the next candidate instead. This is broader than the `isAlreadyApplied` check (which matches on company+role canonical key); `existingJobFolderRel` matches on `co_slug` alone when folder slugs collide.
- **`HOME=~` always** — the lin profile sandboxes `$HOME`; ALL `node scripts/lin-*.mjs` commands (worklist, verify, etc.) resolve relative paths from `$HOME` and silently break without it, not just the Chromium renderers. Every terminal call in the workflow needs the prefix. See conventions §9.
- **Symlink loops** — `engines/{forge,pathfinder}` symlinks must resolve under `career-profile/`; verify with `find engines -type l -exec readlink -f {} \;` if inputs look stale.
- **Update prompts** — any "career-ops update"/"interview-coach update" prompt means the disabled-rename was reverted; re-rename `update-system*.mjs` → `*.UPDATE-DISABLED`.
- **Fresh vendor/platform move** — `cd engines/pathfinder && npm install` and `cd engines/forge/resume-factory && npm install` (fetches Chromium via postinstall).
- **Tavily 429 blocks web_extract AND web_search — browser-only liveness fallback** (discovered 2026-06-28) — when Tavily is rate-limited (429), both `web_extract` and `web_search` (via execute_code) fail for ALL URLs, not just some. `web_search` returns `{"success": false, "error": "Tavily search failed: Client error '429 Too Many Requests'"}`. This means URL recovery for `about:link-XXX` placeholder candidates is impossible via search, AND liveness checks can't use web_extract. **Fallback:** use Chrome CDP browser_navigate for all liveness checks. Greenhouse/Ashby pages render fully in the snapshot (apply form visible). LinkedIn pages show the posting with Apply link. Check for "No longer accepting applications" text for expired LinkedIn postings. Greenhouse expired jobs redirect to `?error=true` board index (see lin-stage skill for detection).
- **"Build the next N resumes" when staged=0 — full pipeline trigger** (discovered 2026-06-28) — when the user says "build the next N resumes" and `lin-worklist --status staged` returns 0, the user means the FULL pipeline (find → stage → build). Don't just report "0 staged" — run the lin-stage workflow first (find real-URL roles, bump queue_state, liveness-check, promote), then build. See lin-stage skill gotcha "Build the next N resumes when staged=0" for the full workflow.
- **Dead-PID lockfile** — the lockfile records `pid` and `started_at`. Before skipping because the lock exists, check whether that PID is still alive (`ps -p <pid>`). If the process died without cleaning up, delete the stale lock immediately — do NOT wait 2 hours. A dead process at 08:49 blocks the 09:35 cron and every subsequent run until manual intervention. The staler-than-2h rule is a fallback for truly stuck (but alive) processes, not dead ones.

## Swapping the build model (this is the only frontier stage — choose deliberately)

When evaluating cheaper alternatives to the current build model:

- **Source of truth for what a provider exposes is `~/.hermes/provider_models_cache.json`** (the live per-provider fetch), NOT `config.yaml`'s `providers:` block and NOT `data/pricing.json`'s seed list. The latter two lag the real catalog — trusting them will make you wrongly claim a model "doesn't exist" (e.g. `qwen3.7-plus` / `mimo-v2.5-pro` are absent from crof's registry and the pricing seed but live on opencode-go). Always grep the live cache before recommending or excluding a model.
- **Quality axes in priority order for this stage:** (1) faithfulness — never invent metrics or experience, a fabricated number is a career-risk failure not a style nit; (2) adherence to the long FORGE spec (`engines/forge/references/commands/resume.md`, ~430 lines) and the md/HTML format specs; (3) agentic tool-loop reliability across the render→gate→trim→re-render loop; (4) structural output fidelity. Raw reasoning-benchmark rank matters less than these.
- **A/B test design:** freeze a fixed input sample (snapshot `job.md` + masters so every model sees byte-identical inputs). Include at least one 7+ role / 18+ year career — that's the page-fill stress case. Run each candidate via the single-role verb in a scratch copy (never against live pipeline state). Score: zero faithfulness violations (hard disqualifier, diff every generated metric against `career-profile/resume.md`+`experience.md`) and gate-pass within retry budget are gates; iteration count, judged ATS/bullet quality (blind), latency are the ranking axes. Run all candidates on ONE provider when possible so provider isn't a confound.
- **Cost framing:** do NOT anchor the decision on subscription-vs-PAYG math — the user is migrating to token-based pricing and dropping flat subs. Treat "most/least expensive" as a quality proxy only, not a real-cost argument.
