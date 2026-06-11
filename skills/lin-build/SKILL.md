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
- `--generic <role-title>` — master-resume workflow (no employer): synthetic JD under `company_slug: generic`, output copies to `$LIN_REAL_HOME/resumes/`. Full recipe: `references/core-resume-workflow.md`.
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
      HOME=$LIN_REAL_HOME node engines/forge/resume-factory/scripts/build-resume.js \
        companies/{co}/jobs/{slug}/resumes/forge.md executive-clean \
        companies/{co}/jobs/{slug}/resumes/forge --pdf
      ```
   2. **PATHFINDER:** invoke `engines/pathfinder/modes/pdf.md` as sub-prompt with `job.md` → tailored HTML at `/tmp/cv-lin-{slug}.html`. Render:
      ```bash
      HOME=$LIN_REAL_HOME node engines/pathfinder/generate-pdf.mjs \
        /tmp/cv-lin-{slug}.html companies/{co}/jobs/{slug}/resumes/pathfinder.pdf --format=letter
      ```
   3. **Quality gate:** `python3 scripts/lin-verify-resumes.py companies/{co}/jobs/{slug}/`
      - exit 0 → **write `resumes/gate-pass.json`** per conventions §5, set `job.yml` `status: built`, append status-history row.
      - exit 1 (fixable: page fill/count/density) → retry up to `prepare_retry_budget` from pipeline-config: PATHFINDER issues → regenerate HTML with tighter recency-tier bullet caps (e.g. 3/2/2/1), font ±0.2px, line-height ±0.03; FORGE issues → trim `forge.md` bullets from older roles. Still failing → leave `staged`, NO gate marker, record for the digest. **Never ship a bad PDF silently.**
      - exit 2 (hard: missing files) → leave `staged`, report.
4. Remove the lockfile. (No tracker refresh needed — finalize and the track job handle display.)

## Bulk re-prepare recipe (manual, occasional)

When the user wants pathfinder-only winners rebuilt so FORGE gets a fresh shot: find `materials_ready` + `ats_winner: pathfinder` folders, confirm the list with the user, then per folder run the single-role verb (waves of ≤7 parallel subagents). Afterwards report which flipped. The folders re-enter at `built` (compare re-picks the winner in finalize).

## Digest (Telegram)

```
🛠️ Lin build — {YYYY-MM-DD} — model: {model actually used; per-role if a fallback fired}
Built: • {Company} — {role} — FORGE {p}p · PATHFINDER {p}p — gate PASS      ← per role
Gate failed after retries: • {Company} — {specific issues}                  ← per failed role
staged awaiting build: {N}                                                  ← leftovers, from lin-worklist
```
- Empty worklist: silent (no message).
- Quota variant: `⚠️ provider limit after {n} roles; {m} staged remain — next run resumes automatically.`

## Gotchas

- **FORGE page limits** — 2 pages (or 3 with page 3 ≥55% fill), enforced by the gate. Overflow → trim older-role bullets; edits to the folder's `forge.md` are throwaway (recreated each run); durable content fixes belong in `career-profile/`.
- **PATHFINDER long-career overflow** — 7+ roles/18+ years can blow 2 pages even at default caps; expect the iterate loop (generate → render → gate → trim → repeat). A 2-page PDF with page 2 only 20% full also fails.
- **`HOME=$LIN_REAL_HOME` always** — both renderers and the verifier launch Chromium from the Playwright cache; the profile sandbox breaks them without it (conventions §9).
- **Symlink loops** — `engines/{forge,pathfinder}` symlinks must resolve under `career-profile/`; verify with `find engines -type l -exec readlink -f {} \;` if inputs look stale.
- **Update prompts** — any "career-ops update"/"interview-coach update" prompt means the disabled-rename was reverted; re-rename `update-system*.mjs` → `*.UPDATE-DISABLED`.
- **Fresh vendor/platform move** — `cd engines/pathfinder && npm install` and `cd engines/forge/resume-factory && npm install` (fetches Chromium via postinstall).
