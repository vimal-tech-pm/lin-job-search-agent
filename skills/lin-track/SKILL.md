---
name: lin-track
description: Regenerate and read the Lin dashboard/tracker (applications.md/html, win-rate). Deterministic — the scheduled job is no_agent; this skill is the interactive twin.
user_invocable: true
args: verb
argument-hint: "[run | describe]"
---

# lin-track — tracker & dashboard

Workdir: `~/.hermes/profiles/lin/lin`. **Deterministic — does not need LLM judgment.** The scheduled `lin-track` cron is `no_agent` and runs `scripts/lin-track-digest.sh` (tracker + stale-applied report + leftovers; stdout = the Telegram digest). This skill exists for interactive runs and for humans reading the spec.

## Verbs

- `run` — regenerate everything:
  ```bash
  node scripts/lin-tracker.mjs
  ```
  Walks every `companies/*/jobs/*/job.yml`, merges `engines/pathfinder/data/applications.md` + `data/evaluation-queue.json`, rewrites `data/applications.md` (markdown view), `data/applications.html` (dashboard — open at `http://127.0.0.1:7777/`, not `file://`), `data/win-rate.md` (28-day rolling). Then print `data/applications.md`'s Funnel + Counts sections (or summarize in chat if asked).
- `describe` — list what the tracker rebuilds and the digest format; do NOT execute anything.

## Notes

- Every mutating pipeline script (package/apply/wont-apply/promote) already refreshes the tracker — manual `run` is for "show me now", not a required step.
- Scripts are `.mjs` only — the same files cron invokes; never create `.js` copies.
- Lifecycle buckets per `~/.hermes/profiles/lin/skills/lin/references/conventions.md` §1: Staged → Built → Materials ready → Applied → Interviewing → Offer → Closed; legacy `new/decoding` normalize to staged on read.
- The scheduled digest (from `lin-track-digest.sh`): funnel block verbatim + `⏳ stale: {co/slug} — applied {n}d ago` (top 5 >7d) + leftovers lines. Script failure delivers an error alert (no_agent semantics — it cannot fail silently).

## Gotchas

- SKIP rows (<3.0) render in their own section — they must stay visible, never mixed into Review or hidden.
- A row can stay visually geo-blocked after `canada_eligible` is fixed if `geo_gate.blocks_stage` is still true — dual-field repair (see lin-stage gotchas).
- Email-status column reads `last_email_status`/`last_email_check` from job.yml (written by lin-status).
