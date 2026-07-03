# Chrome-using Lin cron non-interference

Use when changing LinkedIn cookie refresh, scan, stage, or any Lin cron that touches Chrome/CDP on port `9222`.

## User preference / operating rule

the user does not want maintenance cron jobs to interrupt productive cron jobs. Treat scan/stage/deep-prep/browser liveness checks as “actual work.” A maintenance job must not kill shared Chrome while those jobs may be active.

## Scheduling rule

Before changing a Chrome/CDP cron schedule, inspect nearby Lin cron schedules and choose a slot far away from Chrome users.

Known Chrome/CDP users in Lin:
- `lin-scan` starts/uses Chrome via `ensure_chrome_cdp.py`.
- `lin-stage` may use browser fallback for liveness.
- `lin-deep-prep` or coach/browser tasks may use browser depending on research mode.
- `lin-linkedin-cookie-refresh` uses the shared Chrome profile/port.

Prefer a maintenance slot with multi-hour clearance from scan/stage/deep-prep. In this session, noon was selected because it was far from the 06:30/20:30 scan, 08:00/22:00 stage, and 09:45/23:45 deep-prep windows.

## Script behavior rule

Use a non-destructive ladder before any kill/restart:

1. **Cookie-only check** through CDP (`Storage.getCookies`) — no navigation, no page mutation, no `pkill`.
2. **Existing Chrome verification** — navigate to LinkedIn only if cookies are missing/stale.
3. **Fresh Chrome/login** — only after auth is truly dead and ideally only during the safe maintenance slot. This is the only tier allowed to kill/restart old Chrome.

Never make the first step `pkill chrome` unless the job is explicitly a recovery/repair job and the user accepted disruption.

## Chrome launch flags

Any Lin script that launches Chrome from cron/CDP must include `--password-store=basic` in the Chrome command. Without it, visible Chrome on `DISPLAY=:0` can contact GNOME Keyring/KWallet/libsecret and trigger the Ubuntu keyring unlock popup from scheduled jobs. Known Chrome launchers that should carry this flag:
- `scripts/ensure_chrome_cdp.py`
- `scripts/linkedin_cookie_refresh.py`

## Failure analysis ladder

When cookie cron fails:
- Read the cron output stack trace first.
- Check whether the failure happened before decrypt/login; if so it is not a credential issue.
- Compare Chrome log timestamps. If no DevTools line appears for the cron timestamp, the script likely connected to an old/dying Chrome endpoint rather than a newly started one.
- Distinguish: cron schedule conflict, script CDP lifecycle, profile config, GPG/env, LinkedIn challenge, and browser target selection.

## Reporting

Explain the cron-specific cause, not just “the script failed.” Include:
- job id and run time,
- exact failing operation,
- whether credentials were reached,
- whether another Chrome-using cron could have been affected,
- what was changed to avoid interference.
