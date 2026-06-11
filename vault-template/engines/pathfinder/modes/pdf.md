# Mode: pdf — ATS-Optimized PDF Generation

## Complete Pipeline

1. Read `cv.md` as the base source of truth and `article-digest.md` (if it exists) as a supplementary source of proof points
2. Ask the user for the JD if not already in context (text or URL)
3. Extract 15-20 keywords from the JD
4. Detect JD language → CV language (EN default)
5. Detect company location → paper format:
   - US/Canada → `letter`
   - Rest of the world → `a4`
6. Detect role archetype → adapt framing
7. Adapt the Professional Summary for this JD:
   - START FROM the existing summary in `cv.md` — do NOT rewrite from scratch
   - Inject JD keywords SURGICALLY: insert a keyword into an existing sentence or append it at the end; do not restructure whole sentences
   - Voice rules (see also `_shared.md` section "Professional Writing & ATS Compatibility"):
     * Implicit first-person: start with strong action verbs; no "I" subject; NEVER third-person (e.g. "He led…", "She built…", "[Candidate name] is…", "The candidate…")
     * No passive voice ("was responsible for" → "owned", "built", "led")
     * No corporate filler (see list in `_shared.md`: leveraged, spearheaded, facilitated, passionate about, proven track record, robust, seamless, cutting-edge, synergies, best practices, etc.)
   - Preserve ALL metrics and numbers from `cv.md` exactly as they appear — do not round, paraphrase, or invent
   - If the candidate has an "exit narrative" defined in `modes/_profile.md` and it fits the JD, append it as a closing sentence. Otherwise close with a sentence that connects the candidate's experience to the JD domain.
   - Max 4 lines / ~70 words
8. Select top 3-4 most relevant projects for the offer

8a. **Apply content budget BEFORE selecting bullets — HARD RULE: the final PDF MUST fill exactly 2 full pages. No half-empty pages. No 3-page overflow. Every role from `cv.md` MUST appear in the final PDF — never drop a role entirely.**

    Classify each `cv.md` role by its recency relative to today and apply the matching max-bullets cap:

    | Role recency              | Max bullets |
    |---------------------------|-------------|
    | Current (0–2 years)       | 6           |
    | Recent (2–5 years)        | 4           |
    | Prior (5–10 years)        | 3           |
    | Early career (10+ years)  | 2           |

    Procedure:
    1. Parse the start date of each role from `cv.md` (format `Mon YYYY`). Treat "Present" as today's date.
    2. Compute recency = years elapsed since the start date.
    3. If the role has more bullets than its cap, pick the top-N by JD relevance.
    4. If the role has fewer bullets than its cap, keep them all.

    If content still overflows 2 pages after applying the caps, apply this trim sequence in order:
    1. Reduce "early career" roles (10+ years) to 1 bullet each
    2. Reduce "prior" roles (5–10 years) to 2 bullets
    3. Reduce "recent" roles (2–5 years) to 3 bullets
    Never reduce "current" roles (0–2 years) below their relevance-based selection. Never drop a role entirely.

9. Reorder bullets WITHIN each job by JD relevance. The order of jobs themselves MUST exactly match the order in `cv.md` — do NOT swap, move, or reorder whole job blocks. Only bullets within a single job may be reordered.

9a. Experience order rule (applies to any CV):
    - The visual order in the PDF = the order of appearance in `cv.md` (top to bottom).
    - The user deliberately chose that order in `cv.md` (they may, for example, prioritize a principal role over a more-recent parallel role). Do NOT reorder by date, relevance, duration, or any other criterion.
    - Before writing the HTML to disk, verify the job list in `{{EXPERIENCE}}` follows the same order as the `###` headings in the `PROFESSIONAL EXPERIENCE` section of `cv.md`.

9b. Self-Employed line-order exception (within-job line mapping):

    Default mapping for every job block: cv.md's italic company line (`*Company | Location*`) renders into `<div class="job-company">` (the prominent top slot of `.job-header`); cv.md's `###` heading text (the role title) renders into `<div class="job-role">` (the secondary slot below). The date goes in `.job-period` (top-right). The location goes in `.job-location`.

    EXCEPTION — Self-Employed entries: for any cv.md role whose italic company line contains "Self-Employed" (case-insensitive; matches "Self-Employed", "Self Employed", "self-employed"), flip the within-job mapping:
    - Render the role title (the `###` heading text, e.g. "AI Product Builder") inside `<div class="job-company">` — the prominent top slot.
    - Render "Self-Employed" inside `<div class="job-role">` — the secondary slot below.
    - The date and location slots are unchanged.

    Rationale: "Self-Employed" is not a real employer name and should not occupy the visually prominent company slot. The role title (e.g. "AI Product Builder") is the signal the user wants foregrounded for that entry. This exception applies ONLY to Self-Employed entries — every other role keeps the default company-on-top mapping.

10. Build the competency grid (6-8 phrases) from the candidate's REAL competencies in `cv.md` (the Skills/Tools section and verifiable evidence in the experience bullets) — NOT from the JD wishlist. Procedure: take the JD's required skills, then include a competency tag ONLY when `cv.md` already demonstrates it. Use the JD's exact vocabulary only as a relabel of a real skill (e.g. cv "cloud migration" → tag "Cloud Migration"); never add a tag for a JD requirement the candidate cannot back up (e.g. do NOT add "Kubernetes Monitoring", "Grafana Cloud", or "Cloud Provider Observability" if they are absent from `cv.md`). Never use the Skills section category LABELS ("Product & Strategy", "Platform & Technical", etc.) as competency tags. If fewer than 6 real overlapping competencies exist, emit fewer tags — do not pad with JD keywords.
11. Inject keywords naturally into existing achievements (NEVER invent)
12. Generate complete HTML from template + personalized content
13. Read `name` from `config/profile.yml` → normalize to kebab-case lowercase (e.g. "Alex Morgan" → "candidate-Morgan") → `{candidate}`
14. Write HTML to `/tmp/cv-{candidate}-{company}.html`
15. Run: `node generate-pdf.mjs /tmp/cv-{candidate}-{company}.html output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`

15a. Verify the generated output in TWO checks, in this order. Both must pass before continuing to the report.

     **Check (1) — Role count (HARD GATE):**
     - Count `###` headings under "## PROFESSIONAL EXPERIENCE" in `cv.md` → `N_source`
     - Count `<div class="job-header">` blocks (or distinct `.job-company` elements) in the generated HTML → `N_rendered`
     - If `N_rendered == N_source` → pass, continue to Check (2).
     - If `N_rendered < N_source` → a role was dropped. This violates Step 8a's "never drop a role entirely" rule. Regenerate HTML by re-applying Step 8a's trim sequence MORE aggressively: reduce every non-current role by 1 additional bullet, down to a minimum of 1 bullet per role. Every role from `cv.md` must be present, even if reduced to a single bullet. Then re-run.
     - Maximum 2 regeneration attempts on this check. If after attempt 2 a role is still missing, STOP, do NOT produce the PDF, and ask the user which section they want to compress further (or whether to allow a 3-page PDF). Do NOT silently ship a PDF with a missing role.

     **Check (2) — Page count:** parse the line `"📊 Pages: N"` from generate-pdf.mjs output:
     - Pages = 2 → pass, continue to report
     - Pages = 1 → content too sparse; loosen the Step 8a caps (add +2 bullets to each "current" role, +1 to each "recent" role), regenerate HTML and re-run BOTH checks
     - Pages ≥ 3 → overflow; apply the Step 8a trim sequence (still honoring "never drop a role"), regenerate HTML and re-run BOTH checks
     - Maximum 2 regeneration attempts on this check; if still incorrect after attempt 2, report the current page count to the user and ask which section they prefer to cut or expand. Never resolve overflow by dropping a role.

16. Report: PDF path, page count (must be 2), **roles rendered / roles in `cv.md`** (must be equal, e.g. `7/7`), % keyword coverage, list of all roles included (verify none were dropped)

## ATS Rules (clean parsing)

- Single-column layout (no sidebars, no parallel columns)
- Standard headers: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- No text in images/SVGs
- No critical info in PDF headers/footers (ATS ignores them)
- UTF-8, selectable text (not rasterized)
- No nested tables
- JD keywords distributed: Summary (top 5), first bullet of each role, Skills section

## PDF Design

- **Fonts**: Calibri (Carlito-Bold, 700) headings + DM Sans (body, 400-500)
- **Fonts self-hosted**: `fonts/`
- **Header**: name in Calibri 26-28px bold + gradient line `linear-gradient(to right, hsl(187,74%,32%), #2563b0)` 2px + contact row
- **Section headers**: Calibri 11-12px, uppercase, letter-spacing 0.06em, cyan primary `hsl(187,74%,32%)`
- **Body**: DM Sans 10.5-11px, line-height 1.5
- **Company names**: accent blue `#2563b0`
- **Primary text**: `#1a1a2e`; secondary text: `#555555` (no other mid-grays)
- **Margins**: 0.6in
- **Background**: pure white

## Section Order (optimized for "6-second recruiter scan")

1. Header (large name, gradient, contact, portfolio link)
2. Professional Summary (3-4 lines, keyword-dense)
3. Core Competencies (6-8 phrases in flex-grid, each backed by `cv.md` — see Step 10; never JD-only keywords)
4. Work Experience (order = cv.md order, see Step 9a)
5. Projects (top 3-4 most relevant)
6. Education & Certifications
7. Skills (languages + technical)

## Keyword Injection Strategy (ethical, truth-based)

Legitimate reformulation examples:
- JD says "RAG pipelines" and CV says "LLM workflows with retrieval" → change to "RAG pipeline design and LLM orchestration workflows"
- JD says "MLOps" and CV says "observability, evals, error handling" → change to "MLOps and observability: evals, error handling, cost monitoring"
- JD says "stakeholder management" and CV says "collaborated with team" → change to "stakeholder management across engineering, operations, and business"

**NEVER add skills the candidate does not have. Only reformulate real experience using the exact vocabulary of the JD.**

**Supplementary source usage:**
- `cv.md` remains the canonical base of the CV
- `article-digest.md` is used to recover specificity that was compressed out of `cv.md`
- If a detail appears only in `article-digest.md`, use it to enrich bullets or recover relevant older experience — but keep the output shaped like a CV, not a dossier

## HTML Template

**HARD RULE — template fidelity.** Output ONLY the template's blocks with the `{{...}}` placeholders filled: Header, Professional Summary, Core Competencies, Work Experience, Projects, Education, Certifications, Skills. Do NOT add any section, heading, or commentary that is not in the template. Specifically NEVER emit "Target Fit Evidence", "Role Alignment Notes", "Selected Proof Points", "Tailoring emphasis…", "Key Achievements" proof-point dumps, or any explanation of how the resume maps to the JD. All tailoring rationale belongs in the evaluation/compare report (`ats-compare.md` / `pathfinder-eval.md`), never in the resume PDF. The rendered HTML must contain exactly the template's section count — no extra `<div class="section">` blocks.

Use the template in `templates/cv-template.html`. Replace the `{{...}}` placeholders with personalized content:

| Placeholder | Content |
|-------------|-----------|
| `{{LANG}}` | `en` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |
| `{{NAME}}` | (from profile.yml) |
| `{{CONTACT_ITEMS}}` | Header contact HTML built from `config/profile.yml`: email, phone, LinkedIn, portfolio if present, location |
| `{{SECTION_SUMMARY}}` | Professional Summary |
| `{{SUMMARY_TEXT}}` | Personalized summary with keywords |
| `{{SECTION_COMPETENCIES}}` | Core Competencies |
| `{{COMPETENCIES}}` | `<span class="competency-tag">competency</span>` × 6-8, each backed by `cv.md` (Step 10) — never JD-only keywords or Skills category labels |
| `{{SECTION_EXPERIENCE}}` | Work Experience |
| `{{EXPERIENCE}}` | HTML for each role with reordered bullets |
| `{{SECTION_PROJECTS}}` | Projects |
| `{{PROJECTS}}` | HTML for top 3-4 projects |
| `{{SECTION_EDUCATION}}` | Education |
| `{{EDUCATION}}` | HTML for education |
| `{{SECTION_CERTIFICATIONS}}` | Certifications |
| `{{CERTIFICATIONS}}` | HTML for certifications |
| `{{SECTION_SKILLS}}` | Skills |
| `{{SKILLS}}` | HTML for skills |

### Contact row generation

Build `{{CONTACT_ITEMS}}` from `candidate` in `config/profile.yml` in this exact order:

1. `candidate.email`
2. `candidate.phone`
3. `candidate.linkedin`
4. `candidate.portfolio_url` if present
5. `candidate.location`

Render each present item as a `<span>` or `<a>` and render `<span class="separator">|</span>` only between present items. If `phone` or `portfolio_url` is missing, omit that item and its separator. Never leave leading, trailing, doubled, or empty separators.

## Canva CV Generation (optional)

If `config/profile.yml` has `canva_resume_design_id` set, offer the user a choice before generating:
- **"HTML/PDF (fast, ATS-optimized)"** — existing flow above
- **"Canva CV (visual, design-preserving)"** — new flow below

If the user has no `canva_resume_design_id`, skip this prompt and use the HTML/PDF flow.

### Canva workflow

#### Step 1 — Duplicate the base design

a. `export-design` the base design (using `canva_resume_design_id`) as PDF → get download URL
b. `import-design-from-url` using that download URL → creates a new editable design (the duplicate)
c. Note the new `design_id` for the duplicate

#### Step 2 — Read the design structure

a. `get-design-content` on the new design → returns all text elements (richtexts) with their content
b. Map text elements to CV sections by content matching:
   - Look for the candidate's name → header section
   - Look for "Summary" or "Professional Summary" → summary section
   - Look for company names from cv.md → experience sections
   - Look for degree/school names → education section
   - Look for skill keywords → skills section
c. If mapping fails, show the user what was found and ask for guidance

#### Step 3 — Generate tailored content

Same content generation as the HTML flow (Steps 1-11 above), plus the same layout rules (Steps 8a, 9/9a, 9b):
- Adapt Professional Summary with JD keywords + exit narrative (Step 7)
- Reorder bullets WITHIN each role by JD relevance; keep job order = cv.md order
- Apply the per-age-tier bullet caps (Step 8a) — every role must appear; trim older tiers first if needed
- Apply the Self-Employed line-order exception (Step 9b): for any Self-Employed entry, swap the prominent and secondary text so the role title (e.g. "AI Product Builder") is on top and "Self-Employed" appears below
- Select top competencies backed by `cv.md` that overlap the JD (see Step 10) — never JD-only keywords the candidate can't back up
- Inject keywords naturally (NEVER invent)

**IMPORTANT — Character budget rule:** Each replacement text MUST be approximately the same length as the original text it replaces (within ±15% character count). If tailored content is longer, condense it. The Canva design has fixed-size text boxes — longer text causes overlapping with adjacent elements. Count the characters in each original element from Step 2 and enforce this budget when generating replacements.

#### Step 4 — Apply edits

a. `start-editing-transaction` on the duplicate design
b. `perform-editing-operations` with `find_and_replace_text` for each section:
   - Replace summary text with tailored summary
   - Replace each experience bullet with reordered/rewritten bullets
   - Replace competency/skills text with JD-matched terms
   - Replace project descriptions with top relevant projects
c. **Reflow layout after text replacement:**
   After applying all text replacements, the text boxes auto-resize but neighboring elements stay in place. This causes uneven spacing between work experience sections. Fix this:
   1. Read the updated element positions and dimensions from the `perform-editing-operations` response
   2. For each work experience section (top to bottom), calculate where the bullets text box ends: `end_y = top + height`
   3. The next section's header should start at `end_y + consistent_gap` (use the original gap from the template, typically ~30px)
   4. Use `position_element` to move the next section's date, company name, role title, and bullets elements to maintain even spacing
   5. Repeat for all work experience sections
d. **Verify layout before commit:**
   - `get-design-thumbnail` with the transaction_id and page_index=1
   - Visually inspect the thumbnail for: text overlapping, uneven spacing, text cut off, text too small
   - If issues remain, adjust with `position_element`, `resize_element`, or `format_text`
   - Repeat until layout is clean
e. Show the user the final preview and ask for approval
f. `commit-editing-transaction` to save (ONLY after user approval)

#### Step 5 — Export and download PDF

a. `export-design` the duplicate as PDF (format: a4 or letter based on JD location)
b. **IMMEDIATELY** download the PDF using Bash:
   ```bash
   curl -sL -o "output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf" "{download_url}"
   ```
   The export URL is a pre-signed S3 link that expires in ~2 hours. Download it right away.
c. Verify the download:
   ```bash
   file output/cv-{candidate}-{company}-canva-{YYYY-MM-DD}.pdf
   ```
   Must show "PDF document". If it shows XML or HTML, the URL expired — re-export and retry.
d. Report: PDF path, file size, Canva design URL (for manual tweaking)

#### Error handling

- If `import-design-from-url` fails → fall back to HTML/PDF pipeline with message
- If text elements can't be mapped → warn user, show what was found, ask for manual mapping
- If `find_and_replace_text` finds no matches → try broader substring matching
- Always provide the Canva design URL so the user can edit manually if auto-edit fails

## Post-generation

Update tracker if the offer is already registered: change PDF from ❌ to ✅.
