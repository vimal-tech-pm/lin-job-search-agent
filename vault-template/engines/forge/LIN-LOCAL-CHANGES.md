# FORGE — Local Changes (vendored into Lin)

Tracks every divergence from stock `interview-coach-skill@3d5375c5`. Append-only, newest first.

---

## 2026-05-26 — Initial vendor

- **Updater disabled:** `scripts/update-system-candidate.mjs` → `scripts/update-system-candidate.mjs.UPDATE-DISABLED`.
- **AGENTS.md / CLAUDE.md:** Update Check section (was lines 28–45) replaced with a `VENDORED INTO LIN` banner. AGENTS.md and CLAUDE.md kept byte-identical (FORGE convention).
- **Symlinks retargeted** to Lin's shared `career-profile/`:
  - `source_files/First_Last_Master_Resume.md` → `../../../career-profile/resume.md`
  - `source_files/candidate_source_material.md` → `../../../career-profile/candidate-background.md`
- **New symlink added:**
  - `source_files/cover-letter-base.md` → `../../../career-profile/cover-letter-base.md`
- **User state preserved byte-identical:**
  - `applications/active/{AlphaSense,ClickUp,Gen_II,Hopper,Netomi}_*` — 5 application folders
  - `memory/coaching_state.md` — 327 lines (cmp = 0 vs. source)
  - `memory/interview_tracker.md`
- **Removed during cleanup:** `.git/`, `resume-factory/node_modules/` (re-installed in vendor copy via `npm install`).

## 2026-05-26 — Playwright browser cache symlink

- **Problem:** Lin profile sandbox sets `$HOME` to `$LIN_REAL_HOME/.hermes/profiles/lin/home`. Playwright resolves `$HOME/.cache/ms-playwright/` at runtime, which doesn't exist in the sandbox, causing PDF generation to fail with "Executable doesn't exist at …/chrome-headless-shell".
- **Fix:** Symlinked `$LIN_REAL_HOME/.hermes/profiles/lin/home/.cache/ms-playwright` → `$LIN_REAL_HOME/.cache/ms-playwright` so Playwright finds Chromium without env-var overrides. No change to `build-resume.js` — the symlink is at the filesystem level.

## User-layer files (do NOT touch when porting upstream changes)

Per FORGE's data contract, these files are USER LAYER and must never be overwritten:
- `memory/coaching_state.md`, `memory/interview_tracker.md`
- `source_files/*` (now symlinks to Lin's career-profile)
- `applications/active/*`, `applications/archive/*`
- `plans/*`
- `resume-factory/themes/` and `resume-factory/templates/` (user-customised theme)

System-layer files that are SAFE to update from upstream (with porting):
- `CLAUDE.md`, `AGENTS.md` (preserve the VENDORED banner)
- `references/*`, `releases/*`, `archive/*`
- `scripts/*` (except the disabled updater)
- `resume-factory/*` (except themes/, templates/)
