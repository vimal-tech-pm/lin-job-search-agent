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

**Pitfall — web search/extract down:** Tavily and web_extract occasionally return 429 errors (rate-limited) or are fully down. Do NOT skip research. Fall back to the browser tool:
  1. `browser_navigate` the company's official site → about/our-story/company page for founding history, scale stats
  2. `browser_navigate` careers page for culture signals (Connected Workplace, benefits, ERGs)
  3. `browser_navigate` job listings page for posting context
  4. Glassdoor: expect Cloudflare blocks — effectively unreachable via headless browser. Use LinkedIn company page or general web search instead.
  5. Known redirects: Zynga /about/ → cookies page; use /about/our-story/ instead.
  6. Compile findings into `companies/{co}/company-research.md` manually OR embed directly in interview-prep.md under a "Company Context" section.

See `references/company-research-browser-fallback.md` for a worked example of browser-based research during Tavily outages.

### Interview-prep.md structure

After research, write a comprehensive 10-section interview-prep.md. This structure has worked consistently across very different roles (gaming ML platform, vertical SaaS, cybersecurity):

| # | Section | Content |
|---|---------|---------|
| 1 | **Company Context** | Snapshot: founding, funding, scale, products/portfolio, culture, office locations. Extract from company site research. |
| 2 | **Role Decoder** | Table: "What They Say → What It Means". Translate every JD phrase into the real ask. Add unspoken truths (team dynamics, political context, hidden constraints). |
| 3 | **Your Narrative** | One-liner, why-this-company story, key themes to weave in. This is the framing the candidate repeats across all interviews. |
| 4 | **STAR Stories** | 5-6 stories ranked by relevance to THIS role. Each story needs: Hook sentence, Situation/Task/Action/Result, **company-specific bridge** paragraph that explicitly connects the story to the company's needs (see pitfall below). |
| 5 | **Domain Ramp Card** | Required when the candidate has a significant domain gap (new industry, new technical area). List key concepts, terminology, metrics the candidate must know. Include "what to say when they test your knowledge" framing. See `references/domain-ramp-cards.md` for worked examples. |
| 6 | **Anticipated Questions & Answers** | 6-8 likely questions with full tailored answers. MUST include the domain gap question if applicable. Answers should follow the bridge pattern. |
| 7 | **Questions to Ask Them** | 4-5 questions the candidate should ask each interviewer. Label by theme (role, strategy, culture, domain). |
| 8 | **Compensation & Negotiation** | Posted range, market estimate, candidate's floor, negotiation lever points. |
| 9 | **Interview Day Checklist** | Concrete actions: what to study, what to download, what to practice. |
| 10 | **Red Flags & Caveats** | Comp risks, domain gaps, applicant competition, acquisition integration risk. |

**Pitfall — generic prep:** A prep that reads like it could apply to any company fails its purpose. The Company Context, Role Decoder, Narrative, and STAR bridges must all be specific to the company. If you copy-paste sections between preps, you're doing it wrong.

**Pitfall — omitting the domain gap section:** When the candidate has zero experience in the company's industry (the most common gap for this candidate), you MUST include a Domain Ramp Card. Omitting it means the candidate walks in unprepared for the question they WILL get.

### STAR story "company bridge" pattern

Every story needs a bridge paragraph at the end that explicitly connects the story to the company's needs. Format:

> **{Company} bridge:** *"Your role says {JD requirement} — I demonstrated that when {specific part of story}. At {Company}, I'd apply the same approach to {their specific use case}."*

Example (Zynga bridge on a Confirmation Reimagined story):
> **Zynga bridge:** *"Your Platform ML team needs the same: a clear vision for how ML serves game teams, a strategy that delivers value incrementally, and KPIs that prove the platform works."*

This is the difference between a generic story and a tailored answer. Every story must have this bridge.

### Checking for multiple JDs

Before writing, check if the same role has been posted under different titles/URLs (#252 PM vs #858 Sr PM at Semperis is a real example). Cross-reference JDs, merge the superset of requirements, and note in the prep which posting(s) the candidate applied to.

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

## General career-profile interview prep / story bank

When the user asks for reusable interview prep based on their resume/experience rather than a specific job slug (e.g. “tell me about yourself,” “why are you shifting,” “zero-to-one,” “platform product,” “Senior PM questions,” or “make a story bank”), do not force the `interview <slug>` company-specific workflow. Use Lin career-profile as the source of truth and write advisory outputs under `career-profile/`.

Workflow:
1. Read `career-profile/resume.md`, `career-profile/experience.md`, `career-profile/narrative.md`, `career-profile/profile.yml`, and `engines/forge/memory/coaching_state.md` if available. `career-profile/linkedin.md` is useful only if populated; placeholder sections are not evidence.
2. If a reusable story bank already exists in `career-profile/story-bank.md`, read it before drafting so you do not regress stronger earned-secret wording or miss existing story coverage.
3. Produce two separate markdown artifacts unless the user asked otherwise:
   - `career-profile/interview-prep-senior-pm.md` or `career-profile/interview-prep.md`: clear reusable answers for common questions, role-transition narrative, Senior PM calibration, zero-to-one, platform product, technical depth, AI, roadmap, prioritization, metrics, stakeholder conflict, migration, failure/learning, and first-90-days.
   - `career-profile/story-bank-senior-pm.md` or `career-profile/story-bank.md`: STAR stories with opening line, Situation/Task/Action/Result, earned secret, best-fit questions, and proof points.
4. Keep the zero-to-one and AI positioning honest. For this candidate, the strongest framing is “enterprise zero-to-one / ambiguous opportunity to MVP or capability” plus hands-on AI prototyping, not overstated founder-style startup scale or long-tenured AI PM claims.
5. Verify the outputs with a lightweight word/section count or readback. Ensure every metric is grounded in the source files and flag assumptions instead of inventing detail.

Pitfall: generic interview prep that ignores the candidate’s existing Lin story material is a regression. Preserve differentiated “earned secret” language when available; the story bank should be a retrieval tool, not just a resume rewritten in STAR format.

## `describe`

List your verbs, the advisory-only boundary, and where outputs go; do NOT execute anything.

## Curated answer libraries (user-provided text)

When the user says "save for {Company}: {Q&A text}", they are giving you pre-written application answers to store for cross-session recall. This is **not** the `answer` verb — the user wrote these themselves.

**The user's explicit preference (corrected Jun '26): save full verbatim text to file.** Never rely on memory-only compression for these.

1. Write full text to `~/.hermes/profiles/lin/home/applications/{company}-answers.md`. Keep the original Q&A structure, clean markdown formatting.
2. Compress a one-line pointer into memory: `{Company} app: ~/.../applications/{company}-answers.md` — just enough to locate the file on future recall.
3. The user will always want the full text later. The file is the source of truth; memory is just the index.

See `references/application-answer-libraries.md` for storage pattern details, memory-full recovery, and recall flow.

## Gotchas

- Reference research (when the user names a reference): web-search their title/company history (LinkedIn blocks direct extraction — search name+company+"linkedin", RocketReach/ZoomInfo snippets), synthesize a background paragraph; partner/spouse references stay transparent about the relationship while emphasizing professional visibility.
- Everything here feeds the human — if a task wants to change application materials, hand it to lin-finalize instead of bending the boundary.
