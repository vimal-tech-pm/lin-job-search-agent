---
name: lin-finalize
description: Lin stage 3c — finalize materials. ATS-compares built resumes, picks the winner, drafts application answers, packages with recruiter-named files; also owns cover letters. Part of the Lin pipeline scan → score → stage → build → finalize → apply.
user_invocable: true
args: verb
argument-hint: "[batch | compare <slug> | answers <slug> | package <slug> | cover <slug> | describe]"
---

# lin-finalize — compare · answers · package · cover

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§1 lifecycle, §5 gate marker, §6 lockfile, §10 canonical answers rule). This skill owns every **package-mutating** step after resumes exist. Browserless except best-effort form fetches.

## Verbs

- `batch` (the cron verb) — finalize every folder in the built worklist.
- `compare <slug>` / `answers <slug>` / `package <slug>` — run one step standalone (the old advanced verbs).
- `cover <slug>` — opt-in cover letter (below). Most tech roles don't need one.
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Workflow (`batch`)

1. **Lockfile** per conventions §6 (`.lin-finalize.lock`).
2. **Worklist** — gate-marker enforced by the script (status string alone is never trusted):
   ```bash
   node scripts/lin-worklist.mjs --status built --json
   ```
3. **Per folder:**
   1. **ATS compare** → `resumes/ats-compare.md` with: keyword coverage (classify JD keywords must-have/nice-to-have/soft; count hits per resume weighted summary > recent bullets > older bullets), structural score (2-page fit, section order vs JD priorities, action-verb density, recency-tier caps 6/4/3/2), one-paragraph qualitative verdict per resume, winner + rationale. **Anti-stuffing guardrail (include verbatim in the comparison prompt):** *"Do NOT recommend a resume because it stuffs keywords. Prefer the one that tells a clearer story while covering must-haves. If both cover must-haves, narrative quality and structural fit decide."* Set `job.yml.ats_winner`, append status-history.
   2. **Application answers (best-effort, NON-BLOCKING):** try `job.yml.external_apply_url`, then `source_url` via `web_extract`. Unfetchable form (Airtable/SPA)? Do NOT block — draft from `job.md` + `pathfinder-eval.md` + `career-profile/{resume,experience}.md`. Match each question's exact format constraints (lengths, %, links, their terminology). Mark live-form-only fields `[FILL IN]`; never fabricate references. Save → `resumes/application-answers.md` (canonical-file rule, conventions §10).
   3. **Package:** `node scripts/lin-package.mjs {slug}` — stages `{First}_{Last}_Resume_{Company}_{YYYYMMDD}.pdf` (+`.docx` if FORGE won) at the folder root, writes `PACKAGE.md` (attach table, screening answers parsed from job.md, pre-submit checklist), bumps `built → materials_ready`, refreshes the tracker. The script refuses winnerless folders — compare must precede it.
   4. **Auto-cover (conditional):** if `job.yml.cover_required: true` (the stage step saw a cover-letter field on the apply form) AND no `cover_winner` is set yet, run the `cover <slug>` flow below automatically — the role's application asks for one. Skip silently when `cover_required` is false/absent (most tech roles); the user can still trigger it by hand from the dashboard.
4. Remove the lockfile.

## `cover <slug>` (opt-in; package-mutating, so it lives here)

1. FORGE-style draft vs `career-profile/cover-letter-base.md` using `job.md` + `experience.md` + the tailored `resumes/forge.md` (if built) + `company-research.md` (if present) → `covers/forge.md`. Evidence only from tailored resume / experience dump.
2. PATHFINDER-style draft, same inputs → `covers/pathfinder.md`.
3. `covers/cover-compare.md` — tone, hook, narrative coherence, role-specific evidence; name a winner.
4. Render winner to PDF: `python3 scripts/cover-to-pdf.py companies/{co}/jobs/{slug}/covers/{winner}.md` (handles `HOME=~` itself).
5. Update `job.yml.artifacts.cover_{winner}` + `cover_winner`, then `node scripts/lin-package.mjs {slug}` to stage `{First}_{Last}_Cover_{Company}_{YYYYMMDD}.pdf` and refresh PACKAGE.md + tracker. Covers are always delivered as one-page PDFs.

## Digest (Telegram)

```
📦 Lin finalize — {YYYY-MM-DD}
Ready: • {Company} — {role} — winner {engine} — PACKAGE.md ✓ — answers: {M} drafted, {K} [FILL IN]   ← per role
built awaiting finalize: {M} · staged awaiting build: {N}        ← leftovers, from lin-worklist
Next: review PACKAGE.md, submit on the site, then /lin apply <co/slug>
```
- Empty worklist: silent (no message).
- Failure variant: `⚠️ finalize failed at {Company}: {one-line cause}; that folder stays built, the rest proceeded.`

## Gotchas

- **`HOME=~` always** — the lin profile sandboxes `$HOME`; all `node scripts/lin-*.mjs` commands (worklist, package, apply) resolve relative paths from `$HOME` and silently break without it. Every terminal call in this workflow needs the prefix. See conventions §9.

- **Airtable forms are invisible** to curl/web_extract (client-side). Ask the user to paste questions; never assume last cycle's questions are current. See `~/.hermes/profiles/lin/skills/lin-scan/references/job-board-quirks.md`.
- **External application portals** — some Greenhouse listings route to Constellation/Lever/etc.; scan the JD body for the real submission URL, record it in `job.md` + `PACKAGE.md` so apply doesn't assume Greenhouse.
- **Answers are NOT emails** — when answers include an email address to contact, draft and SAVE only; never send via himalaya/SMTP without the user's explicit "yes, send it" (conventions §10 hard rule).
- **Covers are always PDF** — `lin-package.mjs` stages `_Cover_*.pdf`, not `.md`.
- **Winner flips on rebuild** — a re-built role re-enters at `built` with `ats_winner: null`; compare re-decides. Don't carry a stale winner forward.
- **SILENT on non-empty worklist** — if the worklist command `node scripts/lin-worklist.mjs --status built --json` fails silently (returns `[]` or errors), the digest rule says "Empty worklist: silent" and the cron delivers nothing. But the worklist may be non-empty — the command just failed due to missing `HOME=~` prefix or a path resolution error. **Before committing to SILENT, verify**: re-run the worklist command with `HOME=~` and check the raw JSON output. If it returns folders, the worklist is NOT empty — proceed with the batch. Only go SILENT when the verified worklist is genuinely `[]`.
- **Large built sets (>10 roles)** — split into 2–3 parallel subagents of ~14-15 each. A single subagent hits the 50-iteration tool-call limit before completing all folders, dying mid-run with a stale lockfile. Each subagent runs the full compare→answers→package loop for its assigned folders. No lockfile needed for manual parallel runs. After all finish, run `node scripts/lin-tracker.mjs` once.
