---
name: lin-coach
description: Interview prep, standalone tailored answers, company research, and LinkedIn profile review for Lin-tracked roles. Advisory only — never mutates job packages, resumes, or statuses.
user_invocable: true
args: verb
argument-hint: "[interview <slug> | answer <slug> <question…> | research <co> | linkedin | describe]"
---

# lin-coach — interview & narrative coaching (advisory only)

Workdir: `~/.hermes/profiles/lin/lin`. **Hard boundary: lin-coach never edits `job.yml`, `resumes/`, or statuses.** Allowed writes: `interview-prep.md`, `interview-answer-*.md`, `company-research.md`, `linkedin-contacts.md`, `career-profile/linkedin.md`, and PACKAGE.md *reference lines* pointing at answer files (nothing else in PACKAGE.md). Cover letters are NOT here — `/lin-finalize cover <slug>` (they mutate packages).

## `interview <slug>`

Invoke FORGE's prep workflow (`engines/forge/references/commands/prep.md`) with `companies/{co}/jobs/{slug}/job.md` as JD context and `companies/{co}/company-research.md` as intel (run `research` first if missing). FORGE reads/updates its own `engines/forge/memory/coaching_state.md`. Output summary → `companies/{co}/jobs/{slug}/interview-prep.md`.

## `answer <slug> <question…>` — tailored single-answer drafting

Do NOT route through FORGE prep. Write a standalone tailored answer:
1. Research the role: fetch the JD, extract its explicit value-phrases ("zero to initial customers", "AI-native", "validation discipline" …) — these are the tailoring hooks.
2. Map candidate evidence: `career-profile/resume.md` + `experience.md`; pick the strongest story and frame it onto the hooks. Every paragraph must land on something the JD asked for.
3. Follow the question's structure — sub-parts become labeled sections; concrete metrics; no prose that doesn't map to an ask.
4. Add the bridge: "You said this role requires {JD phrase} — I demonstrated that when {example}."
5. Optional second story if the role stresses a second axis.
6. Save → `companies/{co}/jobs/{slug}/interview-answer-{question-slug}.md`; add a reference line under "Interview Prep Answer" in PACKAGE.md (scaffold PACKAGE.md only if absent).
**Pitfall:** a generic answer with a tailored preamble reads as lazy — the framing, metric choice, and emphasis must shift with the JD throughout.

## `research <co>`

PATHFINDER `deep` mode (`engines/pathfinder/modes/deep.md`) → `companies/{co}/company-research.md`; PATHFINDER `contacto` → `companies/{co}/linkedin-contacts.md` (outreach drafts — drafts only, never send; conventions §10).

## `linkedin`

Read `career-profile/linkedin.md` as the profile source; invoke FORGE's `linkedin` command (`engines/forge/references/commands/linkedin.md`) with it + `career-profile/profile.yml` + `narrative.md`. Write optimized Headline/About/Experience/Skills back into the matching sections of `career-profile/linkedin.md`; append audit findings under "Review notes log". Placeholder-only file → ask the user to paste their current sections first; never fabricate.

## `describe`

List your verbs, the advisory-only boundary, and where outputs go; do NOT execute anything.

## Gotchas

- Reference research (when the user names a reference): web-search their title/company history (LinkedIn blocks direct extraction — search name+company+"linkedin", RocketReach/ZoomInfo snippets), synthesize a background paragraph; partner/spouse references stay transparent about the relationship while emphasizing professional visibility.
- Everything here feeds the human — if a task wants to change application materials, hand it to lin-finalize instead of bending the boundary.
