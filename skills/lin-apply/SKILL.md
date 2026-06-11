---
name: lin-apply
description: Record application outcomes — mark a finalized role applied after the user submits, decline roles (won't-apply), or record direct applications that bypassed the pipeline. Manual-only skill; applying is never automated.
user_invocable: true
args: verb
argument-hint: "[apply <co/slug> | wont-apply <slug|#id> [reason] [--rejected] | direct <company> <role-title> <url> | describe]"
---

# lin-apply — record outcomes (manual only)

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§1 lifecycle — `applied` is only ever set here). **Lin never submits applications.** The user submits on the company site; this skill records it.

## `apply <co-slug/job-slug>`

1. Confirm explicitly: "Mark **{co}/{slug}** APPLIED with resume={ats_winner}, cover={cover_winner}? (y/N)" — wait for the user's yes.
2. Run the deterministic script (the dashboard Apply button calls the same one):
   ```bash
   node scripts/lin-apply.mjs <co-slug/job-slug> --yes --json
   ```
   Guards (script-enforced): refuses re-apply, refuses closed/offer, **requires `status: materials_ready`**, **requires a real `ats_winner`** (no defaults). Sets status/applied_at/applied_with, appends status-history, best-effort PATHFINDER tracker sync, refreshes the dashboard.
3. Suggest next: `/lin-coach interview <slug>` or `/lin-coach research <co>`; `/lin-status check` will pick up email signals.

A refusal means the role isn't finalized — run `/lin-finalize compare+package` first, or use `direct` below if the user already applied outside the pipeline.

## `wont-apply <slug | co/slug | #queue-id> [reason] [--rejected]`

Accepts aliases ("don't apply", "move #132 to won't apply"). Run:
```bash
node scripts/lin-wont-apply.mjs "<slug-or-#id>" [reason…] [--rejected]
```
- Default = user declined → `status_detail: "won't_apply: {reason}"` (Won't Apply view).
- `--rejected` = company rejected → `status_detail: "rejected: {reason}"` (Closed view).
Closes the job folder and the queue row together (dedup handled by the script + tracker). **Shell pitfall:** always quote `"#132"` — unquoted `#` starts a comment and the id vanishes.

## `direct <company> <role-title> <url>` — record an application that bypassed Lin

The user applied on a site without staging/building. Scaffold the record yourself (this flow does NOT use lin-apply.mjs and is the only sanctioned way to write `status: applied` directly):
1. Check `data/pipeline.md` + `reports/` for an existing scored evaluation of this company+role.
2. Create `companies/{co}/jobs/{slug}/` (slug rules per conventions §7) with:
   - `job.yml` — `status: applied`, `applied_at: {ISO now}`, `discovered_via: intake-manual`, `source_url: {url}`, score/verdict pasted from the report if one exists, `ats_winner: null` (no Lin materials were used — never invent one), `canada_eligible` from the report or `unknown`.
   - `status-history.md` — one row: `{ISO}  applied  user applied directly — no prepare step`.
   - If a report exists: copy it → `pathfinder-eval.md`; copy the JD snapshot → `job.md`. Else fetch the JD into `job.md` (web_extract; ask the user if dead).
   - Scaffold `companies/{co}/company.yml` if missing; create empty `resumes/`.
3. `node scripts/lin-tracker.mjs`. Do NOT build resumes or package — the application already happened.

## Dashboard server note

The Apply button works when the dashboard is opened at `http://127.0.0.1:7777/` (NOT `file://`). `scripts/lin-serve.mjs` hosts it; the `lin-serve-watchdog` no_agent cron keeps it alive. Server down → buttons fall back to copying the CLI command.

## Digest

Interactive skill — respond in chat: confirmation line with what changed (`{co}/{slug} → applied, resume={winner}`), or the refusal reason verbatim from the script.

## Gotchas

- Slugs come from the dashboard's first two columns (`coSlug`/`jobSlug`) or the folder path; queue rows that were never staged have **no** slug — use `#queue-id` with wont-apply, or `direct` for applications.
- Re-running `apply` on an applied role is refused by design; correcting a mistake means editing job.yml + status-history by hand, deliberately.
- `direct` exists so the tracker reflects reality; resist the urge to backfill materials for it.
