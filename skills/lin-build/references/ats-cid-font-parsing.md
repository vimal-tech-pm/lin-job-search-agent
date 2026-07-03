# ATS CID Font Parsing — FORGE PDF Investigation

## The problem

the user reported that his FORGE resume PDF was not parsing properly on job websites. Investigation revealed TWO separate issues:

1. **Phone number format** (the actual ATS failure) — `+1 555 000 0000` with + sign, spaces, and country code. ATS parsers stripped/misparsed the phone. All other fields (name, email, linkedin, location, bullets, metrics) parsed fine.
2. **CID font subsetting** (theoretical concern, not the actual failure) — Playwright/Chromium subsets all fonts as CIDFontType2 + Identity-H, which some ATS parsers may struggle with, especially for obscure font names like Carlito.

## Resolution (2026-06-18)

### Phone number fix (APPLIED)

Changed phone from `+1 555 000 0000` to `555-000-0000` (dashes, no country code) across:
- `career-profile/resume.md` (master resume — source of truth)
- `career-profile/profile.yml`
- 168 active `companies/*/resumes/forge.md` files
- All Python/shell scripts with hardcoded phone: `lin_build_generate.py`, `lin-build-generate-artifacts.py`, `lin_build_autogen.py`, `lin-build-batch.py`, `batch-build.py`, `batch-build.sh`, `build-batch-5.py`
- `engines/forge/resume-factory/references/md-format-spec.md` and `assets/sample-resume.md`
- 5 `engines/forge/applications/active/` resume files

Verified: `pdftotext /tmp/forge-fixed.pdf -` shows `555-000-0000 | you@example.com | ...`

### Page 2 margin fix (APPLIED)

Three edits to fix page 2 having no top margin (was flush at 0.04in vs page 1 at 0.57in):
1. Removed `@page { margin: 0 }` from `executive-clean.html` (was blocking Playwright margins)
2. Set `.page { padding: 0 }` in template (removed double-stacked CSS padding)
3. Bumped Playwright margins from 0.40in to 0.50in top/bottom in `render-pdf-playwright.mjs`

Verified: both pages now have ~0.55in top margin (measured via PIL pixel scan).

**CRITICAL PITFALL:** `git checkout` / `git stash` / `git stash pop` on these files reverts the fix. This already happened once during cleanup. Always verify after git operations:
```bash
grep -n "0.50in" engines/forge/resume-factory/scripts/render-pdf-playwright.mjs
grep -n "padding: 0" engines/forge/resume-factory/templates/executive-clean.html
```

### Liberation Sans font switch (NOT applied — optional future improvement)

The proven fix for CID font concerns is to replace Carlito `@font-face` blocks with system `Liberation Sans` (Arial-compatible, pre-installed at `/usr/share/fonts/truetype/liberation/`). This gives ATS parsers a standard font name they recognize. However, since only the phone number was failing (not general text), this is beneficial but not urgent.

To apply: in `executive-clean.html`, remove all 4 `@font-face` blocks, replace `font-family: "Calibri", "Carlito", Arial, sans-serif` with `font-family: "Liberation Sans", Arial, Helvetica, sans-serif`.

If you need to test the visual difference: `pdftoppm -png -r 150` both PDFs and compare side-by-side. Liberation Sans is slightly wider than Carlito — text wraps at slightly different points but same content fits on 2 pages.

## Diagnosis steps

```bash
# 1. Check if text extracts cleanly with pdftotext
pdftotext companies/<co>/jobs/<slug>/resumes/forge.pdf -

# 2. Inspect PDF font internals
strings companies/<co>/jobs/<slug>/resumes/forge.pdf | grep -E 'BaseFont|Encoding|ToUnicode'
# Subsetted fonts show: AAAAAA+Carlito-Bold, /Encoding /Identity-H, /Subtype /CIDFontType2

# 3. Verify phone number format in output
pdftotext <pdf> - | grep -o '905[-) ]\{0,1\}872[-. ]\{0,1\}1552'
```

## Failed approaches (for reference)

| Approach | Result |
|---|---|
| Playwright `page.pdf()` font subsetting option | No such option exists (Playwright 1.59.1) |
| Ghostscript `-dSubsetFonts=false -dEmbedAllFonts=true` | Preserves existing subsetting from input |
| PDF -> PostScript -> PDF roundtrip | Garbled text (CID-to-glyph mapping lost) |
| Hidden text layer via JS injection | Chromium optimizes away off-screen text |
| Hidden text layer in HTML template | Corrupts pdftotext extraction (interleaved streams) |
| Base64 data URI font embedding | 3.5MB bloat, Chromium still subsets |
