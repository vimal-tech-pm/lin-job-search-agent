---
name: lin-score
description: Lin stage 2 — evaluation. Runs the A–G PATHFINDER evaluation on pending pipeline roles, decides Canada eligibility, and upserts the evaluation queue. Browserless by design. Part of the Lin pipeline scan → score → stage → build → finalize → apply.
user_invocable: true
args: verb
argument-hint: "[all | --greenfield | <url> | describe]"
---

# lin-score — evaluation

Workdir: `~/.hermes/profiles/lin/lin` (absolute — under profile cron `~` resolves to the profile home sandbox, not `~`; see Gotchas → "Profile cron `~` expansion"). Shared contracts: `~/.hermes/profiles/lin/skills/lin/references/conventions.md` (§3 queue contract, §8 digest rules). **Evaluation only** — never build resumes, never apply. **Browserless/CDP-free always**: JD extraction via `web_extract` → `curl -sL <url> > /tmp/jd.html` + Python/regex fallback. Never `browser_navigate`/Playwright here.

## Verbs

- `all` (the cron verb) — batch-evaluate pending `- [ ]` rows in `data/pipeline.md`, oldest first, up to `daily.score_cap`.
- `--greenfield` — backlog drain: cap `greenfield.score_cap`, timebox `greenfield.score_timebox_min` minutes. Stop early when the timebox elapses; record progress and exit cleanly so the next run resumes the remaining `- [ ]` rows. After a large drain, run the **geo sanity audit** (below).
- `<url>` — single-role evaluation for a JD not in the pipeline; same steps, ends visible in the dashboard queue.
- `describe` — list your workflow steps and digest format; do NOT execute anything.

## Source metadata preservation (before anything else)

Parse each pending row as `- [ ] DATE | Company | Role | URL | src=<source> [dup_of=<sibling>] [canonical_key=<key>] [posted=<YYYY-MM-DD>]`. Default missing `src=` to `portal`. Carry `source`, `duplicate_of`, `canonical_key`, and `posted_date` (from `posted=`) into the queue upsert. Never let scoring default LinkedIn/Indeed/Gmail/manual discoveries back to portal.

## Batch worklist (cap from pipeline-config; oldest first)

**Never read full `data/pipeline.md` into the agent context.** It is historical and can be ~85KB+. Build the compact score worklist with the deterministic helper instead:

```bash
node scripts/lin-score-worklist.mjs --json
```

The helper reads `career-profile/pipeline-config.json` → `daily.score_cap`, scans `data/pipeline.md` internally, and returns only the pending rows to score this run. Each item contains only: `line_number`, `date`, `company`, `role`, `url`, `source`, `duplicate_of`, `canonical_key`, and `posted_date`. If it returns zero items, respond `[SILENT]`. Do not call `read_file` on `data/pipeline.md`; if you need a human view, use `node scripts/lin-score-worklist.mjs` (no `--json`).

## Per-role workflow

For each compact worklist item:

1. Extract the JD (browserless, per above).
2. Run the full A–G evaluation: `engines/pathfinder/modes/oferta.md` as sub-prompt (archetype, CV match, level/strategy, comp research, personalization plan, interview prep, posting legitimacy). Composite score 0–5 + verdict per the score→verdict table in `engines/pathfinder/modes/_shared.md` (≥4.5 Strong apply · 4.0–4.4 Investable · 3.5–3.9 Investable Stretch · 3.0–3.4 Long-Shot Stretch · <3.0 SKIP). **Verdict reflects role fit only — location/Canada is a separate gate, never folded into the verdict.**
3. Save report → `reports/{###}-{co-slug}-{YYYY-MM-DD}.md` (next number = highest in `reports/` + 1).
4. Save JD snapshot → `jds/{###}-{co-slug}-{YYYY-MM-DD}.md` (raw markdown body).
5. Generate evaluation PDF if score ≥ 3.0 (`engines/pathfinder/modes/pdf.md` → `generate-pdf.mjs`, `HOME=~`).
6. **Canada rubric** → `canada_eligible ∈ yes|no|unknown` + `canada_eligible_reason` (<120 chars quoting the JD):
   - `yes` — Canada listed, or remote with no geo exclusion ruling out Canada, or explicit sponsorship/relocation support without US-citizenship/clearance requirements.
   - `no` — onsite-only non-Canada with no sponsorship, remote-US-only without sponsorship path, US citizenship/clearance required, or explicit no-sponsorship with non-Canada base.
   - `unknown` — no location, bare "remote", or ambiguous. **Default to unknown in doubt.** `geo_gate.reason` is the closed enum `null|visa|remote-only|onsite-only`; prose goes in `geo_gate.detail`.
7. Upsert the queue row: build the JSON object (score, verdict, report, jd_snapshot, canada fields, source/duplicate_of/canonical_key, posted_date, location, keywords), write to a temp file, then
   ```bash
   node scripts/lin-evaluation-queue.mjs upsert --id {###} --file /tmp/lin-entry-{###}.json
   ```
   **Never pass JSON via a CLI arg; omit `id` from the payload** (the `--id` flag sets it).
8. Move the original pipeline row to processed using the worklist `line_number`: `- [x] #NNN | {url} | {company} | {role} | {score}/5 | PDF ✅/❌`.

**3+ pending items:** delegate evaluations to parallel subagents only after building the compact worklist; pass each subagent one URL/JD context plus the oferta.md path, never the full pipeline.

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
- **Profile cron `~` expansion** — under the lin profile cron scheduler, `HOME` is injected as the profile home sandbox (`~/.hermes/profiles/lin/home`), NOT `~`. So `~/.hermes/profiles/lin/lin/...` resolves to `~/.hermes/profiles/lin/home/.hermes/profiles/lin/lin/...` — a non-existent doubled path. The 2026-06-24 21:26 lin-score run wasted early turns on `cat: career-profile/pipeline-config.json: No such file or directory` and `Cannot find module '.../home/.hermes/profiles/lin/lin/scripts/lin-score-worklist.mjs'` because of this. **Always use absolute paths** (`~/.hermes/profiles/lin/lin/...`) in terminal commands and read_file calls, never `~/` or `$HOME/`. The workdir is already set correctly via the cron job's `workdir` field, so `cd` is not needed — but if you reference a file outside cwd, spell the full absolute path. This applies to all lin-* cron skills, not just lin-score. Full reproduction + timeline: `references/cron-workdir-and-context-blowup-2026-06-24.md`.
- **Avoid full-pipeline context blowups** — on cron runs, do not read all of `data/pipeline.md` into the model if it is large. Use `node scripts/lin-score-worklist.mjs --json` to list only pending `- [ ]` rows and cap-sized work items, then read only the specific rows/JDs needed. A previous `lin-score` run failed with stale LLM streams / `[Errno 32] Broken pipe` after loading the full ~84KB pipeline plus large mode files (~39K tokens) on `deepseek-v4-flash`; the durable fix is context diet, not treating it as a data/Gmail/CDP problem. Details and verification commands: `references/context-diet-worklist.md`.
- **Provider stale-stream vs context blowup** — if cron output shows `Stream stale for 600s — no chunks received` and `[Errno 32] Broken pipe` with a small context estimate (for example ~8–9K tokens) and no tool calls/results yet, do not overfit to the full-pipeline-context failure. Treat it as provider/API stream instability: retry once, confirm the compact worklist still has pending items, and if repeated move the score job to a more reliable provider/model or add fallback for repeated `ReadError`. `lin-score` is browserless; cookie/CDP failures are not the cause. The 2026-06-24 21:26 run combined BOTH: a subagent timeout at 600s pushed context to ~81K tokens, then four consecutive 600s stale-stream kills exhausted all 3 retries and the job failed with `Broken pipe` at 22:40. When a delegated scoring subagent times out, do not let the parent retry into an already-bloated context — abort the batch, deliver the failure digest (`⚠️ score failed after {n} roles: {one-line cause}; processed rows are saved, the rest resume next run.`), and let the next scheduled run pick up the remaining worklist with a fresh context.
- **Cron prompt should pin the worklist command** — the skill tells you to use the worklist helper, but the cron `prompt` field in `jobs.json` is thin (`Run the lin-score skill, verb "all"...`). The agent must discover the absolute path each run, and the profile-cron `~` expansion bug (above) means the first attempt often fails. The durable fix is to bake the absolute-path worklist command into the cron prompt itself so the agent runs it correctly on the first tool call. See `references/cron-prompt-pin-worklist.md` for the exact prompt template and the `jobs.json` update recipe. This pattern applies to all lin-* cron jobs that depend on a deterministic helper script — pin the absolute path in the prompt, don't rely on the agent finding it.
