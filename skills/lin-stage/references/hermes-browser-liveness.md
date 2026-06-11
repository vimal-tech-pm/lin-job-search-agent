# Hermes browser liveness for Lin promotion

Use this when redesigning or auditing Lin promotion/liveness checks.

## Durable lesson

Hermes agents can use browser tools directly (`browser_navigate`, snapshots, etc.); Node scripts cannot. Do not solve agent-visible browser checks by adding Playwright subprocesses to scripts unless the task explicitly requires a local browser engine.

For Lin promotion, keep liveness as an agent responsibility and keep staging as a deterministic script responsibility:

1. `lin-promote-evaluations.mjs --list-candidates --json --threshold=<n> --limit=<n>` returns promotion candidates without checking liveness or writing folders.
2. The Hermes cron agent checks each candidate with a **web_extract-first strategy**: call `web_extract(candidate.source_url)` first. For Greenhouse/Ashby/Lever URLs (~80% of the queue), this returns the full JD with apply-path text. Classify from extracted content when possible.
3. Only fall back to `browser_navigate(candidate.source_url)` when web_extract returns empty, errors, or the page is a known client-side SPA (Wellfound, Workday).
4. The agent writes a liveness JSON file, e.g.:
   ```json
   {
     "checked_by": "hermes-browser",
     "results": [
       {
         "id": "123",
         "checked_url": "https://example.com/job",
         "status": "active",
         "checked_at": "2026-06-02T00:00:00.000Z",
         "evidence": "Role title and apply button visible; no closed signal"
       }
     ]
   }
   ```
4. The agent invokes `lin-promote-evaluations.mjs --threshold=<n> --limit=<n> --liveness-file=<path>`.

## Classification rules

Be conservative:

- `active`: role/company visible, application/apply path visible, and no closed/expired signal.
- `expired`: clear closed/no-longer-accepting/filled/expired/404/410/not-found signal.
- `uncertain`: timeout, CAPTCHA, login wall, blank page, generic careers page, title mismatch, or ambiguity.

Default to `uncertain`. Missing liveness must hold the role, not stage or close it.

## Boundary rules

- Only `scan` needs logged-in CDP/Chrome for portal discovery.
- `score` stays browser-tool/CDP-free; use `web_extract`/curl-style fetching.
- `prepare` is CDP/login-independent but may use Hermes browser tools for public liveness checks.
- Existing resume/PDF rendering can still use local headless Playwright/Chromium through FORGE/PATHFINDER; do not conflate that with promotion liveness.

## Common pitfall

Do not claim “prepare is fully browserless” if the prepare cron uses Hermes `browser_navigate`. Say: “prepare is CDP/login-independent; liveness is checked by Hermes browser tools.”
