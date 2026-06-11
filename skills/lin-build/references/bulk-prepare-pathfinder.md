# Bulk Re-Prepare for Pathfinder-Only Jobs

**Trigger:** the candidate says "rerun lin03prepare for all materials_ready which has ATS as pathfinder only" or similar.

## Pre-flight

1. **Find candidates:**
   ```bash
   cd ~/.hermes/profiles/lin/lin
   find companies -name job.yml \
     -exec grep -l 'status: materials_ready' {} \; \
     | xargs grep -l 'ats_winner: pathfinder'
   ```
2. **Count them.** If zero, report and stop.
3. **Confirm with user** — show the list of company/role pairs and count. Wait for explicit "yes."

## Execution

4. **Start CDP browser** (required for liveness checks):
   ```bash
   python3 ~/.hermes/profiles/lin/scripts/ensure_chrome_cdp.py
   ```
   Verify with `curl -s http://127.0.0.1:9222/json/version`.

5. **Launch via delegate_task in parallel waves.** Max 7 per wave (the concurrency cap). Each subagent:
   - `goal`: "Run lin prepare for <co>/<job-slug>"
   - `context`: Include the exact co-slug/job-slug path, plus instructions to skip decode/score (already staged), re-render both engines from scratch, run quality gate, ATS compare, package, and refresh tracker. Reference the lin skill's §prepare.
   - `toolsets`: ["browser", "terminal", "file", "search", "web"]

6. **If more than 7 jobs:** split into waves. Wave 1 = 7, wave 2 = remaining. Wait for wave 1 to complete before launching wave 2 (tracker writes may conflict otherwise).

## Post-flight

7. **Check results** — scan subagent summaries for `ats_winner` flips (pathfinder → forge vs. stayed pathfinder).
8. **Verify ats-compare.md** exists for each. Use correct path: `companies/{co}/jobs/{slug}/resumes/ats-compare.md` (NOT `companies/{co}/{slug}/resumes/` — the `jobs/` subfolder is in the path).
9. **Refresh tracker:** `node scripts/lin-tracker.mjs`
10. **Report to user** — summary table showing winner before/after.

## Pitfalls

- Do NOT launch prepare for jobs with `ats_winner: forge` — the user specifically wants pathfinder-only jobs re-evaluated so FORGE gets another shot.
- Subagents may self-report writing ats-compare.md but the file may not actually exist. Always verify with explicit file checks after completion.
- The `jobs/` path segment is mandatory: `companies/{co}/jobs/{slug}/`, not `companies/{co}/{slug}/`. Checking the wrong path produces false MISSING for every file.
