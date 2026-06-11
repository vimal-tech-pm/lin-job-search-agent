# Lin dashboard queue retroactive fixes

Use when a dashboard row looks wrongly blocked, Canada eligibility was corrected manually, or sub-3.0/skip rows are missing from the dashboard.

## Key model

Dashboard blocking is not controlled by `canada_eligible` alone. Queue rows can still render as blocked if stale geo metadata remains:

```json
{
  "canada_eligible": "yes",
  "geo_gate": { "reason": null, "blocks_stage": true }
}
```

This is inconsistent. A row with `canada_eligible: "yes"` should not have an effective geo block.

## Correct retroactive fix

For a row where the JD explicitly offers visa sponsorship / immigration support and has no hard negative like US citizenship or security clearance:

```json
"canada_eligible": "yes",
"canada_eligible_reason": "Visa sponsorship: Available ...",
"geo_gate": { "reason": null, "blocks_stage": false }
```

Then recompute/reconfirm queue state:

- score < 3.0 -> `queue_state: "evaluated"`, `recommendation: "skip"`
- score >= 4.2 and not blocked -> `queue_state: "recommended"`, `recommendation: "auto_stage"`
- otherwise -> `queue_state: "evaluated"`, `recommendation: "review"`

## Sponsorship classification

Treat as Canada-eligible (`yes`) when the JD/employer text explicitly says:

- "we do sponsor visas"
- "visa sponsorship: available"
- "visa sponsorship: yes"
- "immigration support" / "immigration lawyer"

Do not unblock based only on evaluator speculation like "could ask whether they sponsor" or "TN theoretically possible".

Keep blocked (`no`) when the JD says:

- "does not sponsor"
- "must have unrestricted right to work in the US"
- US citizenship / permanent residence / security clearance required

## Dashboard renderer guardrail

`lin-tracker.mjs` should not render a geo-block chip when `canada_eligible === "yes"`, even if old queue rows still contain `geo_gate.blocks_stage: true`.

## SKIP section

Rows with score < 3.0 are stored as `recommendation: "skip"`. The dashboard should show these in a separate `SKIP (<3.0)` section, not hide them and not mix them into Review.

## Verification

After any retroactive queue edit:

```bash
cd ~/.hermes/profiles/lin/lin
node --check scripts/lin-evaluation-queue.mjs
node --check scripts/lin-tracker.mjs
node scripts/lin-evaluation-queue.mjs validate
node scripts/lin-tracker.mjs
```

Then inspect `data/applications.md` or `data/applications.html` and confirm:

- rows with explicit sponsorship show `🇨🇦 Y`
- rows with explicit sponsorship have no geo-block chip
- explicit no-sponsorship rows remain blocked
- SKIP (<3.0) rows are visible separately
