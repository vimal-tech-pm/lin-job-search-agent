# Daily Workflow Architecture

The Lin system runs a daily scan → evaluate → review cycle. Intake (resume build) is intentionally manual — the cron scores jobs, the user decides which to pursue.

## Flow

```
lin01dailyscan cron (6:30 AM M-F, paused by default)
  │
  ├── Step 1: lin scan
  │     └── Scans 100+ portals/companies via CDP browser
  │     └── Deduplicates against scan-history.tsv
  │     └── Appends fresh URLs to data/pipeline.md (max 30/run)
  │
  ├── Step 2: lin pipeline (auto-run)
  │     └── Processes pending items in data/pipeline.md (cap 5/run)
  │     └── For each: extract JD → A-G evaluation → score (0-5) → report → PDF → tracker
  │     └── Moves from [- ] pending to [-x] processed with score
  │
  └── Step 3: Telegram digest
        └── Section 1: New roles found (top 10 listed)
        └── Section 2: Evaluation scores with ⭐ for ≥ 4.2
    
User reviews digest
  │
  ├── Score ≥ 4.2 → run `lin intake <url>` manually
  │     └── Full decode → resume build (FORGE + PATHFINDER) → ATS compare → package → tracker
  │
  ├── Score 3.0-4.1 → review report in reports/ folder, decide
  │
  └── Score < 3.0 → SKIP
```

## Cron Jobs

| ID | Schedule | What it does | Paused? |
|---|---|---|---|
| `lin01dailyscan` | M-F 6:30 AM | Scan → pipeline eval → Telegram digest | Yes — needs logged-in CDP browser |
| `lin02weeklytrk` | Mon 9 AM | Read-only tracker summary + outcome funnel + engine usage | Yes — safe to enable anytime |
| `lin03followups` | M-F 6 PM | Nudge stale applied jobs (> 7 days) | Yes — enable after first applications |

## Scoring Thresholds (PATHFINDER 0-5 scale)

| Range | Verdict | Action |
|---|---|---|
| ≥ 4.5 | Strong apply | Auto-generate draft application answers; recommended for intake |
| 4.2 – 4.4 | Strong apply | Recommended for manual `lin intake <url>` |
| 3.0 – 4.1 | Investable Stretch / Long-Shot Stretch | PDF generated; user decides |
| < 3.0 | Weak / SKIP | Report only; no PDF |

## Key Rules

- **Scan discovers, pipeline scores, user intakes.** Never auto-intake or auto-apply from the cron.
- **CDP precheck:** if `http://localhost:9222/json/version` is unreachable, skip cleanly — don't crash.
- **Cap at 5 evaluations per cron run** to keep token costs reasonable.
- **Oldest-first** when processing pipeline pending items.
- **Metadata-only Telegram digest** — no JD bodies or PDF contents in the message.

## Portals Scanned

Defined in `engines/pathfinder/portals.yml`. Currently ~100+ companies across:
- Ashby, Greenhouse, Lever, Workday, Workable
- LinkedIn, Indeed, Wellfound
- Company career pages (direct Playwright)
- 60+ EMEA companies (disabled by default)
