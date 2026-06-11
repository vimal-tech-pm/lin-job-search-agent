---
name: lin-deep-prep
description: Lin stage 2b — deep preparation for high-scoring roles. Produces full STAR+R interview packages (8,000+ chars) for queue rows above the deep-prep threshold. Browserless. Part of the Lin pipeline.
user_invocable: true
args: verb
argument-hint: "[run | describe]"
---

# lin-deep-prep — high-score role deep preparation

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§3 queue contract, §8 digest rules). Browserless — no CDP, no browser tools. Never apply to jobs. Output dir: `deep-prep/`.

## Verbs

- `run` (the cron verb) — process eligible candidates up to the cap.
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Workflow (`run`)

**Step 0 — Config** from `career-profile/pipeline-config.json`: `deep_prep_threshold` (default 3.8), `deep_prep_cap` (default 20), `canada_block_values` (default `["no"]`).

**Step 1 — Candidates** from `data/evaluation-queue.json` `roles[]`; select rows satisfying ALL:
- numeric `score >= deep_prep_threshold`
- not already deep-prepped (`deep_prep` not true, `deep_prep_path` absent/empty)
- `queue_state ∈ evaluated|recommended|staged|built`
- `recommendation` ≠ skip and `queue_state` ≠ skipped
- `canada_eligible` not in `canada_block_values`
- not declined/closed: skip `status ∈ closed|applied|wont_apply|won't_apply`
Sort score desc, then newest id; cap at `deep_prep_cap`.

**Step 2 — Deep prep each candidate.** Read the report (`report`/`report_path`) and JD snapshot (`jd_snapshot`/`jd_path`); missing/invalid path → skip that candidate, record in the digest, never fabricate. Produce `deep-prep/{###}-{co-slug}-{YYYY-MM-DD}.md` — a FULL package, normally ≥8,000 chars, NO condensed summaries, sections never merged:
1. **Full STAR+R skeletons for the top 5 JD requirements** — complete Situation-Task-Action-Result-Reflection narratives from specific CV evidence; each with a concrete metric and a reflection paragraph.
2. **Gap mitigation** — per gap from the A–G eval: severity (Hard/Moderate/Minor + justification), adjacent CV evidence, narrative reframe, pre-interview action plan.
3. **Personalized cover letter draft** — 3–4 paragraphs, references specific company products/mission/values; no templates.
4. **Sell-senior / downlevel strategy** — concrete level-positioning arguments with CV achievements to lead.
5. **Question strategy** — 5 thoughtful company/role-specific interviewer questions.
6. **Comp negotiation notes** — expected range, CV leverage points, flag-early vs wait items.

**Step 3 — Quality gate before marking:** the file must exist, be ≥8,000 chars, contain all six sections (≥5 STAR+R skeletons, gap mitigation, 3–4 para cover, level strategy, 5 questions, comp notes). Incomplete → leave the role unmarked, list under needs-regeneration, don't count it.

**Step 4 — Queue update (safe):** preserve the top-level object shape; update matching `roles[]` entries only: `deep_prep: true`, `deep_prep_at: {ISO}`, `deep_prep_path: deep-prep/{file}`. Write via temp file + atomic rename.

**Step 5 — Refresh:** `node scripts/lin-evaluation-queue.mjs validate` (pre-existing unrelated errors: note briefly, don't stop), then `node scripts/lin-tracker.mjs`.

## Digest (Telegram)

Send ONLY if ≥1 role was processed or skipped-for-missing-files; otherwise silent.
```
🧠 Lin deep-prep — {YYYY-MM-DD}
• {Company} — {role} ({score}/5) — deep-prep at {path}      ← per processed role
• skipped {Company} — missing report/JD path                 ← per skipped candidate
```

## Gotchas

- The 8,000-char floor is the gate against the condensed-summary failure mode — a short "package" is a failed package.
- Never replace `evaluation-queue.json` with a bare list; the top-level object shape is load-bearing.
- This stage reads reports/JDs from disk only; if you find yourself wanting a browser, the candidate's paths are broken — skip and report.
