# Verdict/Score Mismatch — Detection and Fix

**Bug:** PATHFINDER's oferta evaluator sometimes sets `verdict: "skip"` for roles scored ≥ 3.0 because it conflates Canada/location ineligibility with role fit. The verdict must reflect role fit only; Canada eligibility is a separate geo-gate.

**Root cause:** The evaluator prompt (`oferta.md`) had no explicit verdict-to-score mapping and no rule separating location from fit. Fixed June 2026.

## Detection

Query evaluation-queue.json for score ≥ 3.0 with verdict = "skip":

```python
import json

with open("data/evaluation-queue.json") as f:
    queue = json.load(f)

mismatches = []
for r in queue["roles"]:
    score = r.get("score")
    verdict = (r.get("verdict") or "").strip().lower()
    if score is not None and score >= 3.0 and verdict == "skip":
        mismatches.append((r["id"], r["company"], score))
```

## Fix recipe

### Step 1: Fix verdicts in evaluation-queue.json

Use the mapping table:

| Score | Verdict |
|---|---|
| ≥ 4.5 | Strong apply |
| 4.0 – 4.4 | Investable |
| 3.5 – 3.9 | Investable Stretch |
| 3.0 – 3.4 | Long-Shot Stretch |
| < 3.0 | SKIP |

Write a Python script that iterates matching entries and replaces the verdict. Save back to the JSON file.

### Step 2: Fix report headers

Reports live in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`. The header line is:

```
**Verdict:** skip
```

Replace with the correct verdict string. Regex: `\*\*Verdict:\*\*\s*[Ss][Kk][Ii][Pp]\b.*`

### Step 3: Refresh tracker

```bash
HOME=$LIN_REAL_HOME node scripts/lin-tracker.mjs
```

### Step 4: Prevent recurrence

The evaluator prompt files were patched June 2026:

- `engines/pathfinder/modes/_shared.md` — Added mandatory score→verdict mapping table + rule: "verdict reflects ROLE FIT ONLY, do NOT fold location into verdict"
- `engines/pathfinder/modes/oferta.md` — Added verdict rule in post-evaluation section + Verdict, JD Snapshot, Canada Eligible fields to report template

If the bug recurs, verify these patches are still in place.

## June 2026 batch fix summary

18 entries fixed across scores 3.0–4.1. 15 report headers updated. All were correctly geo-blocked (CA=no with appropriate geo_gate.reason); the error was only in the verdict label.
