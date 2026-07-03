# Lin dedup/static-route review pitfalls

Use when reviewing changes to the Lin applications dashboard, dedup/backfill, discovery suppression, promotion collision guards, or `lin-serve` static artifact routing.

## Static artifact route guard

A whitelist like `reports|companies|jds` is not enough if the handler decodes the whole path and then only checks that the resolved file remains inside the vault. This bypasses intentionally excluded in-vault roots:

```text
/reports/%2e%2e%2fcareer-profile%2fprofile.yml
/reports/%2e%2e%2fdata%2fevaluation-queue.json
```

Correct guard:

1. Identify the allowed top-level root from the raw/normalized path.
2. Resolve `rootReal = realpath(VAULT/top)`.
3. Resolve the requested file.
4. Allow only when `real === rootReal || real.startsWith(rootReal + path.sep)`.
5. Add symlink tests: a symlink inside an allowed root pointing to `career-profile/` or `data/` must be denied.

Also question directory listings, broad `.json`/`.yml` serving, `0.0.0.0` default binding, and `Access-Control-Allow-Origin: *` when the server can be reached over LAN/Tailscale.

## Dedup/backfill review

Render-time dedup can be more aggressive than persisted backfill because siblings remain visible. Destructive backfill should require stronger evidence than `canonicalKey(company,title)` alone.

Flag these cases:

- Parenthetical stripping merges semantic product areas: `PM (Growth)` vs `PM (Payments)`.
- Queue-vs-queue duplicates where the only evidence is same stripped title + company.
- Placeholder/degenerate identities from URL-only manual adds. Backfill should use `hasCanonicalIdentity()` and should not treat known placeholders as real identity.
- Closed/archived folders: discovery may correctly admit a repost after closure, but render/backfill primacy can still hide or mark the new pending row if archived records are not demoted consistently.

Preferred destructive backfill evidence:

- same canonical URL or same ATS job id;
- explicit `duplicate_of` / `source_duplicate_of`;
- same canonical key plus location-only parenthetical/noise;
- otherwise send to manual review, do not mutate.

## Primacy consistency

Render, backfill, discovery, and promotion must agree on live/archive semantics. Avoid separate rank maps that drift. Prefer a shared primacy helper that distinguishes active folders from closed folders and live queue rows from closed/duplicate/error queue rows.
