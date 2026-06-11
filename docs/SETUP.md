# Lin — Setup Guide

## Prerequisites
- [Hermes](https://hermes-agent.nousresearch.com/) installed with at least one model provider configured (a cheap one like DeepSeek for the pipeline, optionally a frontier one for resume builds)
- Node 20+ and Python 3.10+
- Telegram connected to Hermes (for digests) — optional but recommended

## 1. Profile + files
Follow the README install block. Everything assumes the profile is named `lin`; if you pick another name, search-replace `profiles/lin` in `skills/` and `cron/inject-jobs.py`.

## 2. The sandbox HOME rule
Hermes profiles sandbox `$HOME`. Anything that launches Chromium (PDF rendering, the resume quality gate) needs your REAL home. Export once in your shell/profile:
```bash
export LIN_REAL_HOME=/home/<you>
```
Scripts fall back to `$HOME` when unset.

## 3. Your content (the part that matters)
- `career-profile/resume.md` — master ATS-clean resume. **Resumes are only ever built from this + experience.md; the engines never invent content.**
- `career-profile/experience.md` — every role/project/metric, exhaustive.
- `career-profile/pipeline-config.json` — thresholds & caps (`auto_build_floor`/`auto_build_top_n` control what builds automatically).
- `engines/pathfinder/portals.yml` — companies/searches to scan.
- The geo-eligibility rubric in `skills/lin-score/SKILL.md` ships configured for **Canada** — edit that section for your geography.

## 4. Models per job
Edit `cron/inject-jobs.py`: each job pins `model` + `provider`. Ship suggestion: a cheap model everywhere except `lin-build` (resume writing — use your best model). Then:
```bash
hermes -p lin gateway stop && python3 cron/inject-jobs.py && hermes -p lin gateway start
hermes -p lin cron resume lin-scan   # enable stage by stage as you gain confidence
```

## 5. Dashboard
```bash
node ~/.hermes/profiles/lin/lin/scripts/lin-tracker.mjs   # generate
node ~/.hermes/profiles/lin/lin/scripts/lin-serve.mjs     # serve + action endpoints
# open http://127.0.0.1:7777/  (settings at /settings)
```
The `lin-serve-watchdog` cron keeps the server alive daily. `LIN_SERVE_HOST=127.0.0.1` locks it to localhost (default binds LAN for phone access).

## 6. Verify
```bash
cd ~/.hermes/profiles/lin/lin && node --test tests/*.test.mjs   # 60 tests
hermes -p lin chat -q "lin-score describe" -s lin-score -m <your-cheap-model> --provider <p>
```

## Safety rails you inherit
- Apply is confirm-gated and only legal on finalized roles; nothing ever auto-submits.
- Every settings/profile save backs the file up first; queue edits validate; status invariants have a checker (`scripts/lin-migrate-status.mjs --check`).
- Emails are never sent without explicit confirmation (drafts only).
