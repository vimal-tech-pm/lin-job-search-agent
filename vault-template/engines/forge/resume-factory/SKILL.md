---
name: resume-factory
description: "Generate ATS-friendly resumes in both PDF and DOCX formats from a standardized Markdown (.md) input file. Use this skill whenever the user asks to create, build, generate, or format a resume, CV, or curriculum vitae. Also trigger when the user mentions 'ATS-friendly resume', 'resume from markdown', 'professional resume', 'resume PDF', 'resume DOCX', or wants to apply a resume theme/template. Trigger when the user has a .md resume file and wants it converted to PDF/DOCX, or when they want to pick a resume style/theme. This skill supports multiple visual themes (like theme-factory for presentations) — each theme produces pixel-perfect, deterministic output regardless of which agent runs it. Do NOT use for cover letters, LinkedIn profiles, or non-resume documents."
---

# Resume Factory Skill

Generate ATS-friendly, professionally formatted resumes in PDF and DOCX from a standardized Markdown input. Multiple themes are supported — each theme is a complete formatting specification that produces identical output across independent agent runs.

## How It Works

```
Input (.md file)  ──►  Theme selection  ──►  Builder script  ──►  Output (.docx + .pdf)
```

The system has four parts:
1. **Standardized .md format** — a strict Markdown schema that upstream agents must follow
2. **Themes** — formatting specs (fonts, sizes, colors, spacing, borders) in `themes/`
3. **HTML templates** — one per theme in `templates/`, styled to match the theme spec and consumed by the PDF renderer
4. **Builder** — the single supported builder at `scripts/build-resume.js`, which validates the Markdown, generates `.docx` via the `docx` library, and (with `--pdf`) renders the HTML template to `.pdf` via Playwright + headless Chromium (`scripts/render-pdf-playwright.mjs`)

## CRITICAL: DO NOT WRITE YOUR OWN DOCX OR PDF GENERATION CODE

The provided builder is the only supported way to produce resume exports from this skill.

You **MUST** use:

```bash
node resume-factory/scripts/build-resume.js <input.md> <theme-name> <output-name> --pdf
```

**DO NOT:**
- Write custom Node.js or Python code to generate `.docx`, `.rtf`, or `.pdf`
- Call `python-docx`, `docx`, `officegen`, `pdfmake`, `fpdf2`, `reportlab`, or similar libraries directly
- Rebuild paragraph spacing, bullet formatting, tabs, or styles by hand
- Modify the builder because the markdown looks wrong

The fix path is always:
1. Validate the `.md` against `references/md-format-spec.md`
2. Correct the markdown if it is malformed
3. Re-run `build-resume.js`

If the output looks wrong, debug the markdown input first. Do not replace the builder.

## Why Playwright for PDF?

PDF rendering uses Playwright + headless Chromium against an HTML/CSS template. This gives:

- **Real Calibri** (with Carlito as a metric-compatible OFL fallback) so the PDF matches the DOCX theme instead of silently substituting Roboto or Helvetica.
- **Full print CSS** — `break-inside: avoid`, `widows/orphans`, `print-color-adjust: exact`, `@media print` — for precise page-break control and consistent colors.
- **ATS-safe Unicode normalization** — em/en-dashes, smart quotes, zero-width characters, and non-breaking spaces are replaced in body text before rendering (`scripts/render-pdf-playwright.mjs`).
- **Selectable, indexable text** via Chromium's clean text runs — no cell-positioned fragments that break extraction order.

There is no fallback engine. If Playwright or Chromium is missing, `--pdf` exits 1 with a one-line install instruction so failures are visible to the user rather than hidden behind a lower-fidelity render.

## Step-by-Step Usage

### Step 1: Verify the input .md file

Check that the user's `.md` file follows the **Resume Markdown Spec** (see `references/md-format-spec.md`). If it doesn't, fix it or ask the user to fix it before proceeding.

**CRITICAL**: Read `references/md-format-spec.md` BEFORE processing any .md file. The format is strict — deviations will produce broken output.

### Step 2: Choose a theme

Show the user the available themes from the `themes/` directory. If the user hasn't specified a theme, list them and ask. If they name one, proceed.

Available themes:
1. **Executive Clean** — Navy accents, Calibri font family, clean lines. Best for senior professionals, corporate roles, consulting. (`themes/executive-clean.md` / `templates/executive-clean.html`)

*(More themes will be added over time.)*

### Step 3: Read the theme spec

Read the chosen theme file from `themes/`. It contains every formatting parameter the builder needs. The theme also has a matching HTML template in `templates/<theme-name>.html` that the PDF renderer consumes.

### Step 4: Install dependencies (first run only)

```bash
npm install --prefix resume-factory
```

The `postinstall` hook downloads the Chromium browser Playwright needs (`playwright install chromium`). This is a one-time step per environment.

### Step 5: Validate and build

**Validate** the input against the Markdown schema:

```bash
node resume-factory/scripts/build-resume.js <input.md> <theme-name> <output-name> --validate-only
```

**Build DOCX only:**

```bash
node resume-factory/scripts/build-resume.js <input.md> <theme-name> <output-name>
```

**Build DOCX + PDF:**

```bash
node resume-factory/scripts/build-resume.js <input.md> <theme-name> <output-name> --pdf
```

If Playwright or Chromium is not installed, the `--pdf` step will exit 1 with a one-line install instruction. No partial or fallback PDF is produced — fix the install and rerun.

The DOCX is the primary ATS artifact. The PDF is a convenience output for human review, email attachments, and LinkedIn uploads.

### Step 6: Page-count check and Page Overflow Recovery

The builder automatically checks page count after PDF generation. If the resume exceeds 2 pages, the builder exits with a non-zero code and prints role/bullet counts with a target recommendation.

**Do not deliver a resume that exceeds 2 pages.** If the build fails due to overflow, apply the following trim-and-rebuild loop (max 3 passes):

**Pass targets:**
- Pass 1: reduce to ≤22 bullets
- Pass 2: reduce to ≤20 bullets
- Pass 3: reduce to ≤18 bullets

**Trim priority order** (apply in order, rebuild after each change):

1. For resumes generated by the interview-coach `apply` or JD-targeted `resume` workflow, preserve every master-resume role and reduce low-relevance roles to 1 compact bullet before cutting other content.
2. For other resume workflows, remove roles <6 months (internships, short stints) unless directly relevant to the target JD.
3. Reduce bullets in roles >10 years old to 1-2 max.
4. Reduce bullets in oldest remaining roles to 2 max.
5. Reduce bullets in middle-recency roles to 3 max.
6. Shorten longest bullets (>150 chars) to 1-line versions.
7. Reduce Key Achievements from 8 -> 6 -> 4 (keep most quantified, most relevant). Tighten any achievement items causing row overflow (<=30 chars per item if 4-per-row layout wraps).
8. Tighten Professional Summary to 2 sentences.

**Do NOT create custom section names like "Earlier Career"** — ATS systems struggle with non-standard sections. For interview-coach `apply` or JD-targeted `resume` outputs, old roles keep their standard Professional Experience format with reduced bullets. For other resume workflows, old roles may be removed only after compression options have been exhausted.

**Tie-break rules** (when deciding which bullet or role detail to cut first):
- JD keyword overlap (higher = keep)
- Quantified impact present (yes = keep)
- Recency (newer = keep)
- Role seniority signal (higher scope = keep)
- If tied: cut detail from the oldest role first -> shortest tenure -> lowest quantified-impact density. For interview-coach `apply` or JD-targeted `resume` outputs, preserve the role header, company/date line, and one compact bullet.

**Stop conditions:**
- **Success**: PDF ≤ 2 pages
- **After 3 passes still >2 pages**: Stop and report to the user what was already removed, current page count, and ask whether to cut further or accept as-is

### Step 7: Deliver both files

Present both the `.docx` and `.pdf` to the user only after validation passes and the page count is 2 pages or fewer.

## ATS Compliance Rules (Built Into Every Theme)

These rules are non-negotiable and apply to ALL themes:

- **No tables for layout** — ATS parsers choke on table-based layouts
- **No text boxes or floating elements** — invisible to most ATS
- **No headers/footers for critical info** — many ATS skip these
- **No images, icons, or graphics** — ATS cannot read them
- **Standard section headings** — PROFESSIONAL SUMMARY, EXPERIENCE, EDUCATION, etc.
- **Simple bullet lists** — using proper Word numbering, not Unicode hacks
- **Single-column layout** — no multi-column tricks
- **Standard fonts** — Calibri (with OFL-licensed Carlito fallback for the PDF)
- **Hyperlinks for LinkedIn/email** — properly embedded, not just displayed text
- **Consistent date formats** — `Mon YYYY – Mon YYYY` pattern
- **Bold for metrics/numbers** — helps both ATS and human scanners

## Creating a New Theme

To add a new theme, create two files:

1. `themes/<name>.md` — formatting spec (modeled on `themes/executive-clean.md`). Every theme must specify:
   1. Page setup (size, margins)
   2. Color palette (with hex codes and where each color is used)
   3. Typography (font family, sizes for every element, bold/italic rules)
   4. Spacing (before/after for every paragraph type, line spacing)
   5. Borders (which elements get borders, color, weight, spacing)
   6. Special formatting (how key achievements render, how skills categories render)
2. `templates/<name>.html` — HTML + CSS template (modeled on `templates/executive-clean.html`) with the `{{NAME}}`, `{{TITLE}}`, `{{TAGLINE}}`, `{{CONTACT_HTML}}`, `{{SECTIONS_HTML}}`, size, color, and margin placeholders that `renderHtml` substitutes.

You also need a corresponding entry in the `THEMES` object at the top of `scripts/build-resume.js` so the DOCX side stays in sync.

## File Structure

```
resume-factory/
├── SKILL.md                          (this file)
├── README.md
├── package.json                      (JS dependency manifest; postinstall provisions Chromium)
├── themes/
│   └── executive-clean.md            (Theme 1 — navy/Calibri corporate)
├── templates/
│   └── executive-clean.html          (HTML/CSS for the PDF render path)
├── fonts/
│   ├── Carlito-Regular.ttf           (OFL-licensed Calibri metric fallback)
│   ├── Carlito-Bold.ttf
│   ├── Carlito-Italic.ttf
│   └── Carlito-BoldItalic.ttf
├── scripts/
│   ├── build-resume.js               (Single builder: parse/validate .md → .docx, render HTML for PDF)
│   └── render-pdf-playwright.mjs     (HTML → PDF via Playwright + Chromium; fail-fast if missing)
├── references/
│   └── md-format-spec.md             (Canonical .md input format spec)
└── assets/
    └── sample-resume.md              (Sample .md file for testing)
```
