# Lin — an open-source AI job-search agent (Hermes skill suite)

Lin turns job postings into tailored, submit-ready application packages and tracks every application — autonomously on a schedule, or entirely by hand. **You always submit; Lin never applies for you.**

**Pipeline:** `scan → score → stage → build → finalize → apply`

- 🔍 **Scan** career portals (+ optional LinkedIn / Indeed / Gmail channels, or paste URLs)
- 🧮 **Score** every role with a structured A–G evaluation (0–5) + a configurable geo-eligibility gate
- 🎯 **Stage** the best roles after verifying the posting is actually still accepting applications
- 🛠️ **Build** two competing tailored resumes per role — FORGE (narrative, for humans) vs PATHFINDER (keywords, for ATS) — on your strongest model, with a page-fill quality gate
- 📦 **Finalize**: ATS comparison picks the winner; application answers drafted; recruiter-named PDF packaged
- 📊 **Dashboard**: funnel-rail navigation, one sortable table, bulk actions, settings page, dark/light personalities — one self-contained HTML + a tiny local control server

🎭 **[Live demo (fictional data)](https://lin-job-search-agent.pages.dev/demo/)** · 🌐 **[Project page](https://lin-job-search-agent.pages.dev/)** · 📖 [Case studies](https://vimalsekar-portfolio.pages.dev/work/lin/)

## Why it's shaped this way

Eleven small skills own the workflows; ten thin cron jobs (prompts ≤ 2 lines) only schedule them; deterministic Node scripts do everything that doesn't need a model; and **only the resume-writing stage uses an expensive model** — everything else runs on cheap ones or none at all. Every stage is equally runnable manually (`/lin` chat verbs, `bin/lin-run` pinned-model one-shots, dashboard buttons). 60 automated tests, including a real-browser click-through.

## Install

```bash
# 1) Create a dedicated Hermes profile
hermes profile create lin   # or use an existing one

# 2) Copy this repo's pieces into place
cp -r skills/*            ~/.hermes/profiles/lin/skills/
cp -r vault-template      ~/.hermes/profiles/lin/lin
cp profile-scripts/*      ~/.hermes/profiles/lin/scripts/

# 3) Fill in YOUR content (the only source of truth for resumes)
$EDITOR ~/.hermes/profiles/lin/lin/career-profile/resume.md      # master resume
$EDITOR ~/.hermes/profiles/lin/lin/career-profile/experience.md  # full evidence dump
$EDITOR ~/.hermes/profiles/lin/lin/engines/pathfinder/portals.yml # companies to track

# 4) Engines: install deps once
cd ~/.hermes/profiles/lin/lin/engines/pathfinder && npm install
cd ~/.hermes/profiles/lin/lin/engines/forge/resume-factory && npm install

# 5) Schedule it (jobs are created paused — resume when ready)
python3 cron/inject-jobs.py    # after editing YOUR_TELEGRAM_CHAT_ID + models
```

Full walkthrough, knobs, and troubleshooting: **[docs/SETUP.md](docs/SETUP.md)** · day-to-day manual: **[vault-template/USER-GUIDE.md](vault-template/USER-GUIDE.md)**

## Repo layout

| Path | What |
|---|---|
| `skills/` | 11 Hermes skills — `lin` router + one per pipeline stage (each owns its workflow, Telegram digest format, and gotchas) |
| `vault-template/` | Your working vault: deterministic scripts + dashboard templates + tests + placeholder career profile + vendored engines |
| `profile-scripts/` | Scripts that live at the profile level (cron payloads, CDP bootstrap) |
| `cron/inject-jobs.py` | Creates the 10-job schedule (paused) with per-job model pinning |

## Credits

FORGE and PATHFINDER are adapted from MIT-licensed projects by **Noam Segal** and **Santiago Fernández de Valderrama** — see [THIRD-PARTY.md](THIRD-PARTY.md). Built on [Hermes](https://hermes-agent.nousresearch.com/) by Nous Research. Re-architecture designed and implemented in collaboration with Claude (Anthropic).

MIT © Vimal Sekar
