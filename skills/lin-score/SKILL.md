---
name: lin-score
description: Lin stage 2 — evaluation. Runs the A–G PATHFINDER evaluation on pending pipeline roles, decides Canada eligibility, and upserts the evaluation queue. Browserless by design. Part of the Lin pipeline scan → score → stage → build → finalize → apply.
user_invocable: true
args: verb
argument-hint: "[all | --greenfield | <url> | describe]"
---

# lin-score — evaluation

Workdir: `~/.hermes/profiles/lin/lin`. Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§3 queue contract, §8 digest rules). **Evaluation only** — never build resumes, never apply. **Browserless/CDP-free always**: JD extraction via `web_extract` → `curl -sL <url> > /tmp/jd.html` + Python/regex fallback. Never `browser_navigate`/Playwright here.

## Verbs

- `all` (the cron verb) — batch-evaluate pending `- [ ]` rows in `data/pipeline.md`, oldest first, up to `daily.score_cap`.
- `--greenfield` — backlog drain: cap `greenfield.score_cap`, timebox `greenfield.score_timebox_min` minutes. Stop early when the timebox elapses; record progress and exit cleanly so the next run resumes the remaining `- [ ]` rows. After a large drain, run the **geo sanity audit** (below).
- `<url>` — single-role evaluation for a JD not in the pipeline; same steps, ends visible in the dashboard queue.
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Source metadata preservation (before anything else)

Parse each pending row as `- [ ] DATE | Company | Role | URL | src=<source> [dup_of=<sibling>] [canonical_key=<key>]`. Default missing `src=` to `portal`. Carry `source`, `duplicate_of`, `canonical_key` into the queue upsert. Never let scoring default LinkedIn/Indeed/Gmail/manual discoveries back to portal.

## Per-role workflow (cap from pipeline-config; oldest first)

1. Extract the JD (browserless, per above).
2. Run the full A–G evaluation: `engines/pathfinder/modes/oferta.md` as sub-prompt (archetype, CV match, level/strategy, comp research, personalization plan, interview prep, posting legitimacy). Composite score 0–5 + verdict per the score→verdict table in `engines/pathfinder/modes/_shared.md` (≥4.5 Strong apply · 4.0–4.4 Investable · 3.5–3.9 Investable Stretch · 3.0–3.4 Long-Shot Stretch · <3.0 SKIP). **Verdict reflects role fit only — location/Canada is a separate gate, never folded into the verdict.**
3. Save report → `reports/{###}-{co-slug}-{YYYY-MM-DD}.md` (next number = highest in `reports/` + 1).
4. Save JD snapshot → `jds/{###}-{co-slug}-{YYYY-MM-DD}.md` (raw markdown body).
5. Generate evaluation PDF if score ≥ 3.0 (`engines/pathfinder/modes/pdf.md` → `generate-pdf.mjs`, `HOME=$LIN_REAL_HOME`).
6. **Canada rubric** → `canada_eligible ∈ yes|no|unknown` + `canada_eligible_reason` (<120 chars quoting the JD):
   - `yes` — Canada listed, or remote with no geo exclusion ruling out Canada, or explicit sponsorship/relocation support without US-citizenship/clearance requirements.
   - `no` — onsite-only non-Canada with no sponsorship, remote-US-only without sponsorship path, US citizenship/clearance required, or explicit no-sponsorship with non-Canada base.
   - `unknown` — no location, bare "remote", or ambiguous. **Default to unknown in doubt.** `geo_gate.reason` is the closed enum `null|visa|remote-only|onsite-only`; prose goes in `geo_gate.detail`.
7. Upsert the queue row: build the JSON object (score, verdict, report, jd_snapshot, canada fields, source/duplicate_of/canonical_key, location, keywords), write to a temp file, then
   ```bash
   node scripts/lin-evaluation-queue.mjs upsert --id {###} --file /tmp/lin-entry-{###}.json
   ```
   **Never pass JSON via a CLI arg; omit `id` from the payload** (the `--id` flag sets it).
8. Move the pipeline row to processed: `- [x] #NNN | {url} | {company} | {role} | {score}/5 | PDF ✅/❌`.

**3+ pending items:** delegate evaluations to parallel subagents (one URL each, passing the oferta.md path as context).

After the batch: `node scripts/lin-evaluation-queue.mjs validate`, then `node scripts/lin-tracker.mjs`.

## Geo sanity audit (after greenfield drains)

Sample a few newly high-score JDs: if the fetched title/location conflicts with the pipeline row (gh_jid redirects, boilerplate mentioning Canada on a Remote-USA role), correct the queue row + report header, then re-run validate + tracker.

## Digest (Telegram)

```
🧮 Lin score — {YYYY-MM-DD}
{⭐ if score ≥ auto_build_floor} • {Company} — {role} — {X}/5 — {verdict}    ← per scored role
Funnel: <echo the 'Lin funnel digest:' block from lin-tracker.mjs stdout VERBATIM>
Backlog: {N} still pending — drain with: bin/lin-run score --greenfield      ← only if backlog > cap
```
- No pending items: silent (no message).
- Failure variant: `⚠️ score failed after {n} roles: {one-line cause}; processed rows are saved, the rest resume next run.`

## Gotchas

- **Fix the rubric, not the row** — when the user corrects a classification (Canada, score, geo-gate), fix the rubric/rule that produced it, then re-scan for similar misclassifications. Patching one row kicks the can.
- **Verdict/score mismatch** — verdict must map to score per the table; if you see `score ≥ 3.0` with `verdict: skip`, the evaluator folded geo into the verdict — fix recipe in `references/verdict-score-mismatch-fix.md`.
- **Upsert id type** — `--id 163` with `"id": 163` in the payload fails strict equality; omit `id` from the JSON.
- **Promotion threshold comes from config** — never hardcode 4.2/3.95 in reasoning; read `pipeline-config.json`. Stale queue rows classified under old thresholds are fixed via `lin-evaluation-queue.mjs reclassify` (dry-run → backup → `--write`), see `references/promotion-threshold-reclassify.md`.
