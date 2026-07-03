# Queue Mining: Finding Real-URL Roles for Manual Staging

When `--auto` candidates all have `about:link-XXX` placeholder URLs, or staged=0
and the user wants to build, you need to mine the queue for roles with real URLs
that can be promoted immediately.

## Diagnosis

1. Run `--list-candidates --json --auto` — if all `source_url` values are
   `about:link-XXX`, auto-staging is blocked.
2. Check `geo_blocked_auto_skipped` count — if it's very high (100+), many
   good roles may be geo-gated but still promotable via `--id` (manual bypass).

## Mining Script

```python
import json, os

q = json.load(open('data/evaluation-queue.json'))
unbuilt = []
for r in q.get('roles', []):
    url = r.get('source_url', '')
    if not url or url.startswith('about:link') or url == 'None':
        continue
    qs = r.get('queue_state', '')
    if qs not in ['recommended', 'evaluated']:
        continue
    score = r.get('score', 0)
    if score < 3.0:
        continue
    co_slug = r.get('co_slug', '')
    job_slug = r.get('job_slug', '')
    folder = f"companies/{co_slug}/jobs/{job_slug}"
    if os.path.exists(folder):
        yml = f"{folder}/job.yml"
        if os.path.exists(yml):
            with open(yml) as f:
                if 'materials_ready' in f.read() or 'applied' in f.read():
                    continue  # Already built/applied
    unbuilt.append({
        'id': r.get('id'),
        'company': r.get('company', '?'),
        'role': r.get('role', r.get('title', '?')),
        'score': score,
        'url': url,
        'co_slug': co_slug,
        'job_slug': job_slug,
        'queue_state': qs,
    })

unbuilt.sort(key=lambda x: x['score'], reverse=True)
for r in unbuilt[:15]:
    print(f"  [{r['id']:>3}] {r['company']:<20} {str(r['role'])[:40]:<40} score={r['score']}  qs={r['queue_state']}")
```

## Promotion Steps

1. **Pre-filter on `canada_eligible`** (2026-06-28) — before running liveness
   checks, filter the mined candidates to `canada_eligible == 'yes'` (the applicant is
   Toronto-based, Canada-only). This saves ~70% of browser liveness checks.
   Include `canada_eligible == 'unknown'` as fallback if the `yes` pool is too
   small. The `location` field also helps — look for Canada/Toronto mentions.
2. **Bump queue_state** — roles in `evaluated` state are invisible to `--id`.
   Update them to `recommended` in `data/evaluation-queue.json` first.
3. **Verify liveness via browser** — Tavily may be 429. Navigate to each URL:
   - See `references/ats-expiry-detection.md` for ATS-specific expiry patterns
   - Greenhouse expired → URL has `?error=true`, title is "Jobs at {Company}"
   - LinkedIn expired → "No longer accepting applications" text on page
   - Ashby expired → "Job not found" heading
   - Workable expired → "This job is no longer available"
   - Indeed expired → "This job has expired on Indeed"
4. **Write liveness file** — `/tmp/lin-liveness-stage.json` with all results.
5. **Promote by --id** — one at a time with the liveness file.
   **Watch for closed-folder dedup blocks** — `existingJobFolderRel(role)`
   blocks `--id` promotion when ANY existing folder for the same `co_slug`
   exists, including `status: closed` folders. "No candidates matched" is
   the only symptom. Check `find companies/{co_slug} -name job.yml` first.
6. **Verify** — `lin-worklist --status staged --json` should show all promoted roles.

## Expected Yield

- ~101 roles with real URLs and score ≥ 3.0 exist in a typical queue of 1000+
  (observed 2026-06-28)
- ~50%+ of older Greenhouse URLs (2+ weeks old) are expired — much higher than
  the ~30% noted for Greenhouse in the SKILL.md gotcha. In one session: Gusto,
  Rithum, Fixify, Toast, Liberate, Human Interest, Postscript, Varicent all
  expired (8/14 Greenhouse URLs dead)
- Ashby URLs are stable when active but completely gone when expired ("Job not
  found" page, no redirect) — ~40% expired in one session (Taktile, MeridianLink,
  Vanta, Deel)
- LinkedIn URLs are moderately stable (~70% active) — some show "No longer
  accepting applications" after 4+ months (Scribd, BiggerPockets)
- Workable URLs expire with "no longer available" banner (Accellor)
- Wellfound URLs are stable (Basestation active after 2 weeks)
- Workday URLs are hard to liveness-check (generic careers page, no job ID)
- ~15% of candidates are US-only despite being in the queue — pre-filter on
  `canada_eligible == 'yes'` before liveness checks to save browser time
- ~13% of candidates are blocked by closed-folder dedup (existing job folder
  for same company with `status: closed`) — check for existing folders before
  promoting by `--id`