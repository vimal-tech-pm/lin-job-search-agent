# Lin dashboard operations notes

Use this when troubleshooting `http://127.0.0.1:7777/`, dashboard buttons, Add flow, or service survivability.

## lin-serve survivability

`lin-serve` is the Node localhost/LAN control server for the dashboard:

```bash
node ~/.hermes/profiles/lin/lin/scripts/lin-serve.mjs
```

It serves `data/applications.html` and exposes mutating endpoints like `/apply`, `/wont-apply`, `/request-build`, `/run-stage`, `/add-jobs`, `/cover`, and `/run-pipeline`.

Preferred durable setup mirrors the Hermes gateway: a user-level systemd service under:

```text
~/.config/systemd/user/hermes-lin-serve.service
```

Expected properties:

- `ExecStart=/usr/bin/node ~/.hermes/profiles/lin/lin/scripts/lin-serve.mjs`
- `WorkingDirectory=~/.hermes/profiles/lin/lin`
- `Environment="HERMES_HOME=~/.hermes/profiles/lin"`
- Hermes venv and `~/.local/bin` in `PATH`, because server endpoints call `hermes -p lin ...` and vault scripts.
- `Restart=always`, usually `RestartSec=5`.
- `[Install] WantedBy=default.target`.

The reason this survives machine restart is not cron; it is `systemd --user` plus `loginctl enable-linger user` / `Linger=yes`, the same mechanism used by `hermes-lin-gateway.service`.

When verifying, use:

```bash
systemctl --user status hermes-lin-serve.service --no-pager -l
ss -tlnp | grep 7777
curl -s http://127.0.0.1:7777/health
loginctl show-user user | grep Linger
```

If the service exists and is active, a separate `lin-serve-watchdog` cron is redundant and can cause ownership confusion; systemd should own boot and crash recovery.

## Static artifact route (read-only file serving)

`lin-serve.mjs` serves whitelisted vault subdirs over HTTP so the dashboard's
`../reports/`, `../companies/`, `../jds/` links resolve (they only worked under
`file://` before). This is a GET-only route — no mutations.

Whitelisted roots: `reports`, `companies`, `jds`, `deep-prep`, `evals`, `output`.
`career-profile` and `data` are NOT served (config/queue state, not linked
artifacts). The settings page serves the few career-profile files it needs via
`/profile-file`.

Security: two-layer traversal guard in `serveStatic()` — `..`/`.` segment reject
after decode + `realpathSync` confinement to the whitelisted root. See
`references/static-route-security.md` for the full attack-surface audit.

**Residual exposure:** the server defaults to `LIN_SERVE_HOST=0.0.0.0` (binds all
interfaces). Directory listings are enabled for all whitelisted roots. If the
machine is on an untrusted LAN, set `LIN_SERVE_HOST=127.0.0.1` in the systemd
service or environment. CORS is `*` (needed for action endpoints, not for static
files but harmless on read-only).

## Dashboard bulk actions

The sticky selection bar is driven by `scripts/templates/dashboard.js` and rendered into `data/applications.html` by `scripts/lib/tracker-html.mjs` / `scripts/lin-tracker.mjs`.

Current intended UX:

- Review/Top matches: selected rows show bulk `Prepare` and `Won't apply`.
- Skip tab: selected rows show `Prepare anyway`, `Won't apply`, and, after a successful prepare, `⚡ Run pipeline now`.
- `Prepare anyway` on Skip rows must show a simple confirmation: skipped jobs were rejected by Lin; preparing overrides the skip decision and uses resume-build tokens.
- After successful bulk prepare, each prepared row should flip in-place to `requested ✓`, gain row-level `⚡ now`, and the sticky bar should expose `⚡ Run pipeline now` for the selected rows.
- `⚡ Run pipeline now` calls `/run-pipeline`, which runs stage → build → finalize for all flagged/staged roles; it is not per-row.

When changing this behavior, patch the template/source files first, regenerate with `node scripts/lin-tracker.mjs`, then verify both the source and generated HTML. The regression test lives in `tests/dashboard-clickthrough.test.mjs` and should cover the Skip bulk-prepare path.

Keep dashboard UX answers to the user simple and direct: state the visible labels/buttons and the exact action sequence, not a long design rationale unless he asks for it.

## LinkedIn authenticated scan session

LinkedIn scan uses the same persistent Chrome/CDP profile as Lin browser scans:

```text
~/.hermes/profiles/lin/chrome-cdp
```

A weekly no-agent cron refresh keeps that profile logged in:

- Job ID: `lin-linkedin-cookie-refresh`
- Schedule: `0 19 * * 0` — Sunday 7 PM ET only
- Script: `~/.hermes/profiles/lin/scripts/linkedin_cookie_refresh.sh`
- Credentials: `~/.hermes/credentials/linkedin.asc` (GPG-encrypted)
- Health: `~/.hermes/profiles/lin/lin/data/linkedin-session-health.json`

Manual verification:

```bash
~/.hermes/profiles/lin/scripts/linkedin_cookie_refresh.sh
cat ~/.hermes/profiles/lin/lin/data/linkedin-session-health.json
curl -s http://127.0.0.1:9222/json/version
```

Expected health: `authenticated: true`, `challenge: false`, and `cookies_present.li_at: true`. If status is `challenge`, complete LinkedIn CAPTCHA/2FA in the visible Chrome window and rerun the script. Do not run password login daily; LinkedIn is bot-sensitive, so weekly refresh plus persistent profile is the intended setup.

## Adding a new dashboard column (render-time derivation pattern)

For metadata that's deterministically derivable from existing fields (URL → ATS platform, role title → seniority level), prefer **render-time derivation** over adding `job.yml` schema fields. No backfill needed for ~200 existing roles.

### Files to change (in order)

1. **`scripts/lib/tracker-data.mjs`** — Add the classifier helper (e.g. `atsPlatform(url)`), thread the derived field into every row kind in `buildRows()` (job rows, queue rows, pending rows).
2. **`scripts/lib/tracker-html.mjs`** — Add the column header `<th data-col="X">`, the cell renderer function, the cell `<td>` in `rowHtml()`, and bump the expand-row `colspan` by 1.
3. **`scripts/templates/dashboard.js`** — Add the column to `sortKey()` so clicking the header sorts. Add a `<select id="f-X">` filter to the filter bar HTML (in tracker-html.mjs) and the filter logic in `rowVisible()`. Register the filter in the `["q", "f-score", ...]` forEach list.
4. **`scripts/templates/dashboard.css`** — Styling for the new cell class.
5. **`scripts/lin-package.mjs`** — If the metadata should appear in PACKAGE.md, add it to the header line.

After all edits: `HOME=~ node scripts/lin-tracker.mjs` to regenerate.

### Existing render-time columns

| Column | Derived from | Helper | Added |
|---|---|---|---|
| **level** | role title (regex: Group > Director > Principal > Staff > Senior > PM) | `seniorityLevel()` in tracker-html.mjs | 2026-06-26 |
| **ats** | `external_apply_url → source_url` fallthrough, domain regex match | `atsPlatform(url)` in tracker-data.mjs | 2026-06-26 |

### CRITICAL PITFALL — missing `#` in `$()` selector kills ALL rail filters

The dashboard.js `$` helper is `(s, el) => (el || document).querySelector(s)`. It uses CSS selector syntax, so `$("#f-level")` queries `#f-level`, but `$("f-level")` (missing `#`) queries for a `<f-level>` HTML tag — which doesn't exist — returns `null` — and `.value` on null throws a `TypeError`.

This TypeError kills the entire `refresh()` function. Since `refresh()` is called by every rail stage button click and every filter change, **ALL rail filters and stage buttons stop working** — not just the one you touched. The user sees the page load fine (IIFE initialization runs before any refresh call), but clicks do nothing.

**Always use `$("#f-X")` with the `#` prefix** for ID-based queries in dashboard.js. If rail filters stop working after a dashboard.js edit, grep for `$("f-` (without `#`) — that's the bug.

### Pitfalls when adding a new render-time column (from Claude Code review)

1. **Don't touch unrelated regexes** — when rewriting `tracker-data.mjs` (which is a full-file overwrite via `write_file`), verify character classes like `[)\].,;]` haven't gained stray backslashes. A `[)\\].,;]` change silently breaks URL trailing-punctuation stripping because `\\` becomes a literal backslash and the `]` closes the class early. Always diff the full file after a `write_file` overwrite.

2. **Don't duplicate helpers across files** — if `lin-package.mjs` needs `atsPlatform()`, import it from `tracker-data.mjs` rather than copy-pasting. Duplicated regex lists drift: the copy in lin-package had LinkedIn without trailing slash, missing 13 platforms, and different URL precedence. Use `import { atsPlatform } from "./lib/tracker-data.mjs"` — `atsPlatform()` is a pure function, no `init()` needed.

3. **Filter dropdown must list every ID the classifier can produce** — if `ATS_PATTERNS` defines 22 platform IDs but the `<select>` only lists 10, rows classified as `icims`/`bamboohr`/`jobvite`/etc. become un-filterable (they don't match `other` either — `data-ats="icims" !== "other"`). Always enumerate all classifier IDs in the dropdown.

4. **Sort columns with semantic rank, not alphabetical** — for level/seniority, `Director → Group → PM → Principal → Senior → Staff` is meaningless. Map to ordinals (Group=5, Director=4, Principal=3, Staff=2, Senior=1, PM=0) in `sortKey()` and default to descending (most senior first).

### Browser caching after regeneration

After `node scripts/lin-tracker.mjs` regenerates `data/applications.html`, the browser may serve the old cached version. `location.reload(true)` or a hard refresh is needed. In CDP, `Page.reload` with `ignoreCache: true` works, but the tab may navigate to `chrome://newtab` — use `Page.navigate` to re-navigate to `http://127.0.0.1:7777/applications.html` and wait a few seconds before querying the DOM.

## Dashboard Add button behavior

The dashboard Add box is discovery intake only, not immediate resume-build.

Client behavior in `data/applications.html`:

- Reads URLs from `#add-urls`.
- Calls `POST /add-jobs` when the server is reachable.
- If the server is unreachable, copies a fallback CLI command like `/lin add <url...>` instead of mutating data.
- On success, clears the text box, shows a toast, bumps the Pending count, but does **not** insert rows into the current DOM.

Server behavior in `scripts/lin-serve.mjs`:

- `/add-jobs` wraps pasted URLs as `{ company: "?", role: "?", url }`.
- Runs `scripts/lin-discovery-append.mjs --source manual --file <tmp.json>`.
- Then runs `scripts/lin-tracker.mjs` to regenerate the dashboard.

Where to look:

- New/processed discovery rows: `data/pipeline.md`.
- Scored/manual rows after later processing: `data/evaluation-queue.json`.
- Rendered dashboard: `data/applications.html`.

Common explanations for “I clicked Add but saw no row”:

1. The page needs reload; Add does not live-insert rows.
2. Current rail/filter is not Pending/All.
3. URL was detected as duplicate, so no fresh pending row appears.
4. Score already processed the pending row and moved it to review/skip/recommended/staged.
5. Page was opened as `file://` or another origin with server unreachable, so the action copied CLI fallback rather than posting.

Recommended answer pattern: say Add works as “add to pipeline,” not “build now”; then inspect `data/pipeline.md` tail and `data/evaluation-queue.json` manual/source rows before concluding it failed.
