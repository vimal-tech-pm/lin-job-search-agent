# Resume Factory

This repo vendors the `resume-factory` skill so resume outputs can follow one strict Markdown contract and compile into `.docx` and `.pdf`.

## Source Of Truth

- Markdown schema: [references/md-format-spec.md](references/md-format-spec.md)
- Theme spec: [themes/executive-clean.md](themes/executive-clean.md)
- Original upstream skill guidance: [SKILL.md](SKILL.md)

## Builder

A single builder generates both outputs:

- **DOCX** — [`scripts/build-resume.js`](scripts/build-resume.js) renders the parsed Markdown via the `docx` npm package.
- **PDF** — [`scripts/render-pdf-playwright.mjs`](scripts/render-pdf-playwright.mjs) renders the theme's HTML template (e.g. [`templates/executive-clean.html`](templates/executive-clean.html)) to PDF using headless Chromium via Playwright.

There is no fallback PDF engine. If Playwright or Chromium is missing, the `--pdf` step exits 1 with a one-line install instruction so the user sees the failure and installs the missing dependency.

## Local Development Notes

- `node` (>= 20) and `npm` are required.
- Chromium is provisioned automatically by the `postinstall` hook (`playwright install chromium`).
- `resume-factory/node_modules/` is a local artifact and should not be committed.

## Usage

Install dependencies (this also downloads the Chromium browser Playwright needs):

```bash
npm install --prefix resume-factory
```

The builder accepts: `<input.md> <theme-name> <output-name> [--pdf] [--validate-only]`

```bash
# Validate only
node resume-factory/scripts/build-resume.js source_files/Your_Name_Master_Resume.md executive-clean out/resume --validate-only

# Build DOCX + PDF
node resume-factory/scripts/build-resume.js source_files/Your_Name_Master_Resume.md executive-clean out/Your_Name_Resume --pdf
```

Any saved resume Markdown intended for export should match the schema in `references/md-format-spec.md`.
