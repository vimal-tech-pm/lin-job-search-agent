---
name: lin
description: Job-search agent router — maps verbs (old and new vocabulary) to the lin-* stage skills. The pipeline is scan → score → stage → build → finalize → apply, each stage its own skill and cron. Use this for muscle memory; stage skills are directly invocable too.
user_invocable: true
args: verb
argument-hint: "[scan | add <url…> | score [all|--greenfield|<url>] | stage | build | finalize | prepare <slug|url> | build-request <#id> | apply <co/slug> | won't-apply <slug|#id> | track | status | interview <slug> | research <co> | cover <slug> | linkedin | help]"
---

# Lin — Router

**This skill only dispatches.** Read and follow the target skill at `~/.hermes/profiles/lin/skills/<skill>/SKILL.md` for the actual workflow. Shared contracts: `references/conventions.md` (lifecycle, schemas, queue, lockfiles, digest rules) · platform footguns: `references/hermes-ops.md`. Vault: `~/.hermes/profiles/lin/lin/`.

## Verb → skill dispatch

| Verb (aliases) | Do |
|---|---|
| `scan` / `scan portal\|linkedin\|indeed\|gmail` | **lin-scan** — verb `all` (or the named channel) |
| `add <url> [url…]` | **lin-scan** — verb `add` (manual add-to-pipeline, `source: manual`) |
| `add to next resume build <url>` / `add to build <url>` | **explicit build intake** — add via lin-scan, immediately score that URL/row, then stage the resulting queue id with **lin-stage `--id NNN`** after liveness. Do **not** stop at queue append; do **not** use `request-build` for sub-threshold rows because it refuses scores below `promote_threshold`. |
| `score` / `score all` (`pipeline`) | **lin-score** — verb `all` |
| `score --greenfield` (`bootstrap`) | **lin-score** — verb `--greenfield` (backlog drain) |
| `score <url>` | **lin-score** — single-role evaluation |
| `stage` | **lin-stage** — verb `auto` (also `--id NNN`, `--top N`) |
| `build` / `resume <co/slug>` | **lin-build** — old dual-resume path; verb `batch` / single-role rebuild |
| `build-forge` / `forge-build` | **lin-build-forge** — Forge-only fastpath; builds/packages staged roles while `lin-build` + `lin-finalize` crons are paused |
| `finalize` | **lin-finalize** — old dual-resume finalization; verb `batch` |
| `compare <slug>` / `answers <slug>` / `package <slug>` | **lin-finalize** — that single step |
| `cover <slug>` | **lin-finalize** — verb `cover` (opt-in; package-mutating) |
| `build-request <#id\|slug>` | run `node scripts/lin-evaluation-queue.mjs request-build --id <id>` and confirm the flag |
| `prepare <slug\|url>` (`intake`) | **express lane** — see below |
| `apply <co/slug>` | **lin-apply** — verb `apply` (confirm-gated) |
| `won't-apply <slug\|#id> [reason]` (`wont-apply`, `don't apply`) | **lin-apply** — verb `wont-apply` (quote `"#id"` in shells) |
| `direct <company> <role> <url>` | **lin-apply** — verb `direct` (record an outside-Lin application) |
| `track` (`tracker`) | **lin-track** — verb `run` |
| `status` / `status-check` / `gmailscan for applied` | **lin-status** — verb `check` |
| `followups` | **lin-status** — verb `followups` |
| `outlook` | **lin-status** — verb `outlook` |
| `deep-prep` | **lin-deep-prep** — verb `run` |
| `interview <slug>` (`prep`) / `research <co>` / `linkedin` / `answer <slug> <q…>` | **lin-coach** — matching verb (advisory only) |
| `help` / empty | print this table + the next sensible step (below) |
| anything else | "Unknown verb — run `/lin help`. Pipeline: scan → score → stage → build → finalize → apply." |

## Express-prepare contract (`prepare <slug|url>`)

One role, end to end, in this session:
1. **URL not yet in the queue:** run lin-score's single-role flow (evaluate, snapshot, queue upsert). `--no-resume` stops here (triage only). If the verdict is SKIP/Weak, stop and ask before continuing (`--force-resume` overrides).
2. **Stage that one row:** lin-stage with `--id <queue-id>` (liveness ladder applies — a dead posting stops here).
3. **Build:** lin-build single-role for the new folder.
4. **Finalize:** lin-finalize compare → answers → package.
Already-staged slug? Start at step 3. Already-built? Start at step 4. End state: `materials_ready`, PACKAGE.md path printed, "after you submit: `/lin apply <co/slug>`".

**Forge-only fastpath active:** when cron `lin-build-forge` is enabled and `lin-build`/`lin-finalize` are paused, replace steps 3-4 with a single call to `lin-build-forge <co/slug>` (builds, verifies, stamps, drafts answers, packages to `materials_ready` in one pass). Skip the separate finalize step.

## Help — suggest the next step

After printing the table, look at the vault (`cd ~/.hermes/profiles/lin/lin` first — chat sessions don't start there): pending `- [ ]` rows in `data/pipeline.md` → suggest `score`; eligible queue rows ≥3.95 → suggest `build-request` or `stage`; `staged`/`built` folders (via `node ~/.hermes/profiles/lin/lin/scripts/lin-worklist.mjs --status staged|built`) → suggest `build`/`finalize`; `materials_ready` → suggest reviewing PACKAGE.md then `apply`.

## Notes

- Crons are optional accelerators; every skill runs manually — pinned-model batch runs via `~/.hermes/profiles/lin/bin/lin-run <stage> [args]` (see `references/hermes-ops.md`).
- **Cron web provider changes:** before blaming a specific Lin cron job for Tavily/DDGS usage, check the owning profile's `web:` config and active env. Lin cron jobs usually enable the `web` toolset but do not pin the web provider in `cron/jobs.json`. Blank `web.backend` does not inherit root/default; it auto-detects and will pick Tavily first if `TAVILY_API_KEY` is present. Full audit/fix recipe: `references/web-provider-cron-resolution.md`.
- For cron web/search failures or “remove Tavily from cron” requests, audit cron definitions **and** the owning profile config separately; Lin cron web tools inherit `~/.hermes/profiles/lin/config.yaml`. See `references/cron-web-provider-audit.md`.
- **Cron stale-stream / fallback fixes:** a config patch can be present but operationally incomplete. After changing `stale_timeout_seconds`, `fallback_providers`, or `cron.script_timeout_seconds`, verify profile-scoped config, loaded fallback chain, latest cron output files, and fresh gateway logs. If logs still show `Stream stale for 600s` / `[Errno 32] Broken pipe` retrying the primary provider, call the fix partial even if a manual rerun succeeded. See `references/cron-stale-fallback-verification.md`.
- For LinkedIn cookie refresh / Chrome CDP cron changes, avoid disrupting productive browser jobs: schedule maintenance far from scan/stage/deep-prep, and use non-destructive cookie checks before any Chrome kill/restart. See `references/chrome-cron-noninterference.md`.
- Dashboard/control-server troubleshooting lives in `references/dashboard-operations.md`: `lin-serve` should be owned by the user systemd service `hermes-lin-serve.service`; if users ask whether dashboard buttons/Add/server survive restart, inspect the service and data files first rather than asking what the server does. When reviewing `lin-serve` static artifact routes, test encoded traversal (`%2e%2e%2f`) and symlinks; whitelist checks must constrain resolved paths to the resolved allowed root, not merely to the vault root. For dedup/backfill/static-route review pitfalls, see `references/dedup-and-static-route-review.md`.
- LinkedIn cookie refresh / Chrome safety lives in `references/linkedin-cookie-refresh-safety.md`: schedule the cookie cron in a quiet Chrome-free slot, check cookies non-destructively first, and never blindly kill shared CDP Chrome while scan/stage jobs may be doing real work.
- **Static artifact route + traversal guard** — `lin-serve.mjs` serves whitelisted read-only dirs (`reports/companies/jds/deep-prep/evals/output`) so dashboard `../` links resolve over HTTP. Has a two-layer traversal guard: `..`/`.` segment reject after decode + `realpathSync` confinement to the whitelisted root (not just VAULT). `career-profile` and `data` are intentionally excluded. See `references/static-route-security.md` for the full attack-surface audit and residual exposure notes (default bind `0.0.0.0`, directory listings, CORS `*`).
- **Canonical identity & dedup** — `scripts/lib/canonical.mjs` is the single definition of "the same job" (`canonicalKey`/`strictTitleKey`/`isLocationOnly`/`canonicalizeUrl`). Render-time collapse is loose (reversible); destructive backfill is strict (`strongMatch` evidence required). See `references/dedup-and-canonical-identity.md` for the render-vs-destructive principle, `LOCATION_WORDS` audit, `job_slug` placeholder collision root cause, primacy ordering gap, and duplicate-folder resolution heuristics.
- **Dashboard render-time columns** — the `ats` column (Greenhouse/Ashby/Workday/etc) and `level` column (Group/Director/Principal/Staff/Senior/PM) are derived at render time from URL domain patterns and role-title regex respectively — no `job.yml` schema change. `atsPlatform(url)` lives in `tracker-data.mjs`; `seniorityLevel(role)` lives in `tracker-html.mjs`. Both are sortable columns + filterable via dropdown. To add a new column see `references/dashboard-operations.md` § "Adding a new dashboard column". **Critical pitfall:** `$("f-X")` without `#` in dashboard.js silently kills ALL rail filters — see that reference. **Four more pitfalls** from Claude Code review (regex stray-backslash on full-file overwrite, duplicate helper drift, filter-dropdown must list all classifier IDs, sort by semantic rank not alphabetical) are in `references/dashboard-operations.md` § "Pitfalls when adding a new render-time column".
- **Dashboard code review via Claude Code** — for dashboard/tracker changes touching 3+ files, `HOME=~ claude -p "Review this diff for bugs..." --allowedTools Read --max-turns 15 --output-format json` with a focused `git diff` is an effective defect gate. Feed the diff via `$(cat /tmp/changes.diff)` in the prompt. Parse the JSON result for structured findings.
- **Dashboard Add is discovery intake only**: it posts `/add-jobs`, appends `source: manual` rows to `data/pipeline.md`, regenerates tracker HTML, and requires reload; it does not live-insert visible rows or trigger immediate resume build. Check `data/pipeline.md` and `data/evaluation-queue.json` before saying it failed.
- **Cron prompt pinning pattern:** lin-* cron jobs that depend on a deterministic helper script should bake the absolute-path command into the cron `prompt` field, not rely on the agent discovering it. Under the profile cron scheduler, `~` expands to the profile home sandbox (`~/.hermes/profiles/lin/home`), not `~`, so `~`-relative paths fail. Pin `cd ~/.hermes/profiles/lin/lin && node scripts/<helper>.mjs <args>` as the first command in the prompt. See `lin-score/references/cron-prompt-pin-worklist.md` for the recipe.
- The pipeline stage skills define their own digests, caps (always from `career-profile/pipeline-config.json`), and gotchas — never restate them here.
- **Status check is LLM-driven (2026-06-24):** `lin status` and its cron (`81ca02ebe5b3`) use an LLM agent, not regex, to classify emails. A Python helper (`scripts/llm-inbox-scan.py`) does GAPI plumbing; the LLM reads full email bodies and classifies. Old no_agent `lin-status` cron and Daily Digest cron (`f050366cceb4`) are paused. See `lin-status` skill → `references/llm-inbox-architecture.md`.
- **PyYAML datetime trap in llm-inbox-scan.py (2026-06-26):** `yaml.safe_load()` auto-parses ISO timestamps to `datetime` objects. Code that calls `.replace("Z", "+00:00")` on a datetime raises `TypeError` (not caught by `except (ValueError, AttributeError)`). 22 recently-closed jobs were silently dropped from the `companies[]` list, making the LLM classifier blind to them. Fix: `str(ts_str).replace(...)` + catch `TypeError`. Combined with the `furthest_stage: closed` corruption bug (LLM cron wrote a status value into a stage field), this made Semperis invisible and misclassified as "untracked." See `lin-status` → `references/llm-inbox-architecture.md` § "Closed-job inclusion and the PyYAML datetime trap."
