# Lin static-route security (lin-serve.mjs)

`lin-serve.mjs` serves whitelisted vault subdirs over HTTP so dashboard
`../reports/`, `../companies/`, `../jds/` links resolve (they only worked under
`file://` before). This is a read-only GET route — no mutations. Load this reference
when reviewing or changing `serveStatic()` in `lin-serve.mjs`.

## Whitelisted roots

```js
const STATIC_ROOTS = new Set(["reports", "companies", "jds", "deep-prep", "evals", "output"]);
```

`career-profile` and `data` are intentionally NOT whitelisted — those are config and
queue state, not linked artifacts. The settings page serves the few career-profile
files it needs via `/profile-file`.

## The traversal guard (defense in depth)

`serveStatic()` (`lin-serve.mjs:397-419`) has two layers:

1. **Segment reject** (`:403-405`): after `decodeURIComponent`, reject any `..` or `.`
   path segment. This stops `%2e%2e%2f` (encoded-slash) before path resolution.
2. **Root confinement** (`:408-412`): `realpathSync` the requested path AND the
   whitelisted root (`VAULT/<top>`). The file must be inside `rootReal`, not just
   inside `VAULT`. This blocks symlink escapes and sibling-dir reads that stay inside
   the vault.

```js
// after decoding + whitelist check:
if (segments.some((s) => s === ".." || s === ".")) { sendJson(res, 403, ...); return; }
let rootReal = fs.realpathSync(path.join(VAULT, top));
let real = fs.realpathSync(path.resolve(VAULT, rel));
if (real !== rootReal && !real.startsWith(rootReal + path.sep)) { sendJson(res, 403, ...); return; }
```

## Attack vectors verified blocked (2026-06-24)

All return 403 or 404 — no file outside the 6 roots is readable:

- `/reports/%2e%2e%2fcareer-profile%2fprofile.yml` — the original bypass → 403
- `/reports/%2e%2e%2fdata%2fevaluation-queue.json` → 403
- `%252e%252e%252f` (double-encoding) → 404 (decoded to literal `%2e..`, no match)
- `%5c..` (backslash) → 404
- `%2E%2E%2F` (mixed-case) → 403
- Unicode fullwidth dots `．．` → 404
- Null byte `…%00.md` → 404
- Literal `../` → 404
- `file:///etc/passwd` (absolute) → 404
- Overlong UTF-8 `%c0%ae` → 400
- Symlink inside `reports/` → `career-profile/resume.md` → 403/404 (unit tested)

## Vectors that still work (by design)

- `/reports/<file>.md` → 200 (the point of the route)
- `/companies/<co>/jobs/<slug>/` → 200 (serves PACKAGE.md or dir listing)
- `/reports/.` and `/reports/./` → 200 (listing of `reports/` itself — stays in root)

## Residual exposure concerns (not security bugs, but worth noting)

1. **Server default bind is `0.0.0.0`** (`lin-serve.mjs:36`), not `127.0.0.1`. The
   comment says "Lock down with LIN_SERVE_HOST=127.0.0.1 if the machine sits on an
   untrusted network." If the machine is on LAN/Tailscale, all whitelisted files are
   readable by anyone on the network. The systemd service file should set
   `Environment="LIN_SERVE_HOST=127.0.0.1"` unless LAN access is explicitly wanted.
2. **Directory listings are enabled** (`:410-418`) for all 6 roots. This exposes
   filenames (report names contain company + role, JD filenames contain company +
   date). Acceptable for localhost; reconsider if binding to LAN.
3. **CORS is `*`** (`:44`) even for static files. Same-origin dashboard needs CORS
   for the action endpoints, but static files don't. Low risk since it's read-only.
4. **`.json` and `.yml` are served** with content-types that browsers will render.
   `evaluation-queue.json` is NOT in a whitelisted root, so it's blocked. But
   `companies/<co>/jobs/<slug>/job.yml` IS reachable (`.yml` → `text/plain`). This
   exposes `source_url`, `score`, `ats_winner`, `canada_eligible_reason`, etc. — not
   secrets, but more than the dashboard links need.

## Regression tests

`tests/lin-serve.test.mjs` covers:
- serves a report as markdown (200)
- serves a company folder (200)
- blocks path traversal (`..%2f..%2f..%2f..%2fetc%2fpasswd`) → 404/403
- blocks encoded-slash escape (`%2e%2e%2fcareer-profile%2fresume.md`) → 403/404
- blocks encoded-slash escape (`%2e%2e%2fdata%2fevaluation-queue.json`) → 403/404
- blocks symlink inside root pointing outside → 403/404
- 404s non-whitelisted roots (`/career-profile/`, `/data/`)

When changing `serveStatic()`, run: `HOME=~ node --test tests/lin-serve.test.mjs`