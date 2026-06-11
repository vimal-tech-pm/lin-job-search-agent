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
| `score` / `score all` (`pipeline`) | **lin-score** — verb `all` |
| `score --greenfield` (`bootstrap`) | **lin-score** — verb `--greenfield` (backlog drain) |
| `score <url>` | **lin-score** — single-role evaluation |
| `stage` | **lin-stage** — verb `auto` (also `--id NNN`, `--top N`) |
| `build` / `resume <co/slug>` | **lin-build** — verb `batch` / single-role rebuild |
| `finalize` | **lin-finalize** — verb `batch` |
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

## Help — suggest the next step

After printing the table, look at the vault (`cd ~/.hermes/profiles/lin/lin` first — chat sessions don't start there): pending `- [ ]` rows in `data/pipeline.md` → suggest `score`; eligible queue rows ≥3.95 → suggest `build-request` or `stage`; `staged`/`built` folders (via `node ~/.hermes/profiles/lin/lin/scripts/lin-worklist.mjs --status staged|built`) → suggest `build`/`finalize`; `materials_ready` → suggest reviewing PACKAGE.md then `apply`.

## Notes

- Crons are optional accelerators; every skill runs manually — pinned-model batch runs via `~/.hermes/profiles/lin/bin/lin-run <stage> [args]` (see `references/hermes-ops.md`).
- The pipeline stage skills define their own digests, caps (always from `career-profile/pipeline-config.json`), and gotchas — never restate them here.
