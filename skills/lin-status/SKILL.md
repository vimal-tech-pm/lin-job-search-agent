---
name: lin-status
description: Lin applied-job maintenance — Gmail/Outlook status checks (rejections, interviews, offers) auto-applied to job.yml, and stale-application follow-up drafts. NOT discovery. Part of the Lin pipeline.
user_invocable: true
args: verb
argument-hint: "[check | followups | outlook | describe]"
---

# lin-status — applied-job maintenance

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§8 digest, §10 never-send rule). **Maintenance, not discovery** — never feed results into `data/pipeline.md` or the evaluation queue; writes go to `job.yml` + `status-history.md` only. Discovery is `lin-scan gmail`.

## Verbs

- `check` (the cron verb) — Gmail status scan for applied jobs.
- `followups` — stale-application nudge drafts (its own paused cron).
- `outlook` — manual Outlook inbox check (browser-based).
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## `check` — Gmail status scan

1. Run `node scripts/lin-gmail-status.mjs --since 7` (auto-write mode is the default; `--dry-run` to preview).
2. The script: reads every `job.yml` with `status: applied`; searches Gmail per company (GAPI primary, himalaya fallback — himalaya commands need `HOME=$LIN_REAL_HOME` because the profile sandboxes `$HOME`); classifies ❌ rejection / 🎙️ interview / 🎉 offer / 📨 acknowledgement / none; **auto-applies** rejection→`closed`, interview→`interviewing`, offer→`offer` (no approval gate — the user wants immediate application; the Telegram digest is the notification); skips acknowledgements; refreshes the tracker.
3. Gmail unreachable (neither backend) → print `Gmail not reachable`, exit 0 cleanly. Never fabricate results.
4. Highlight any interview/offer prominently at the top of the digest.

## `followups` — stale-application drafts

Walk `companies/*/jobs/*/job.yml` for `status: applied` with `applied_at` > 7 days and no later status-history row. Oldest first, cap 5 per run. Per flagged entry: write `companies/{co}/jobs/{slug}/follow-up-draft.md` — subject + 4–6 sentence polite check-in referencing the role and application date; address the recruiter by name if known in `companies/{co}/linkedin-contacts.md`, else generic. **Never auto-send; never change job.yml status.** The user reviews and sends manually.

## `outlook` — manual Outlook check (browser)

Prereq: CDP on `127.0.0.1:9222` (`python3 ~/.hermes/profiles/lin/scripts/ensure_chrome_cdp.py`) with Outlook logged in. List applied jobs (last 2 weeks first), `browser_navigate("https://outlook.live.com/mail/0/")`, extract text via `document.body.innerText` slices (the SPA defeats snapshots — see `references/outlook-cdp-status-check.md`), match company names, classify with the same rules as `check`, apply updates via the same job.yml + status-history writes, refresh tracker.

## Digest (Telegram)

`check`:
```
📬 Lin status — {YYYY-MM-DD}
🎙️ INTERVIEW: {Company} — {role}            ← first, if any
🎉 OFFER: {Company} — {role}                 ← first, if any
❌ rejected: {Company} ({n} total closed)
checked {N} applied · updated {M} · acknowledgements skipped {K}
```
No applied jobs or zero signals: one line `📬 Lin status — {date}: {N} checked, no changes.` Gmail unreachable: `📬 Gmail not reachable — skipped.`

`followups`: `🔁 Lin follow-up nudge — {N} stale apps` + per entry `• {Company} — {role} (applied {n}d ago) — draft at {path}`. N=0 → silent.

## Gotchas

- **Acknowledgements are not status changes** — "thanks for applying" mail from Greenhouse/Lever is classified `acknowledgement` and skipped.
- **Company-name matching is substring-based** on the display name from `company.yml`; brand-name mismatches can miss emails — when a known applied company shows `no_email` repeatedly, check what name their emails actually use.
- **himalaya sandbox rule** — every himalaya command: `HOME=$LIN_REAL_HOME himalaya …` (config at `~/.config/himalaya/config.toml`). Setup notes: `references/himalaya-gmail-fallback.md`, `references/himalaya-smtp-setup.md`.
- **Never send email without explicit confirmation** — drafts only, conventions §10 hard rule (the user was burned once; non-negotiable).
