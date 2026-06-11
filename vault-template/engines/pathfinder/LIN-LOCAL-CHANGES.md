# PATHFINDER — Local Changes (vendored into Lin)

Tracks every divergence from stock `career-ops@4995750b`. Append-only, newest first.

---

## 2026-05-26 — D3: lin-render.mjs helper added

- **New file:** `lin-render.mjs` (Lin-added; not part of stock PATHFINDER). Reads a substitution JSON, fills `templates/cv-template.html`, and calls stock `generate-pdf.mjs`. Lets `/lin resume` produce tailored PATHFINDER PDFs deterministically from LLM-emitted JSON without re-implementing PATHFINDER's full `modes/pdf.md` pipeline in code.

## 2026-05-26 — Initial vendor

- **Updaters disabled:**
  - `update-system.mjs` → `update-system.mjs.UPDATE-DISABLED`
  - `update-system-candidate.mjs` → `update-system-candidate.mjs.UPDATE-DISABLED`
- **CLAUDE.md:** Update Check section (was lines 25–42) replaced with a `VENDORED INTO LIN` banner.
- **Symlinks retargeted** to Lin's shared `career-profile/`:
  - `cv.md` → `../../career-profile/resume.md` (was a symlink to Lin-Base's `career-profile/resume.md`; retargeted to point into Lin's vault)
  - `modes/_profile.md` → `../../../career-profile/narrative.md` (was a regular file containing the user's narrative; **hoisted** to Lin's career-profile as `narrative.md` and replaced with a symlink so all user-layer content lives in one place)
  - `config/profile.yml` → `../../../career-profile/profile.yml` (was a symlink to Lin-Base's profile.yml; retargeted into Lin's vault — the relative target string needed updating from `../../` to `../../../` because vendoring added a directory level)
- **User state preserved:**
  - `data/applications.md`, `data/pipeline.md`, `data/follow-ups.md`, `data/scan-history.tsv`
  - `reports/*` — historical evaluation reports
  - `interview-prep/*` — story bank, company intel
  - `jds/*` — saved JDs
  - `portals.yml`, `config/profile.yml`, `article-digest.md`
- **Removed during cleanup:** `.git/`, `node_modules/` (re-installed), `output/` (legacy PDFs — Lin generates fresh ones into `companies/{co}/jobs/{job}/resumes/`), `.claude/worktrees/`, `.playwright-mcp/`.

## User-layer files (per PATHFINDER's data contract)

These must never be overwritten by an upstream port:
- `cv.md` (symlink), `config/profile.yml`, `modes/_profile.md` (symlink), `article-digest.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*` (not vendored, regenerated per-job), `interview-prep/*`

System-layer files that are SAFE to update from upstream (with porting):
- `modes/_shared.md`, `modes/oferta.md`, all other modes except `_profile.md` (which is a symlink to Lin's narrative.md)
- `CLAUDE.md` (preserve the VENDORED banner)
- `*.mjs` scripts (except the disabled updaters)
- `dashboard/*`, `templates/*`, `batch/*`
