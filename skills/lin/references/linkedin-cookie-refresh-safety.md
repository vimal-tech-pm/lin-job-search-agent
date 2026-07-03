# LinkedIn cookie-refresh scheduling and Chrome safety

Use this when diagnosing or modifying `lin-linkedin-cookie-refresh` or any Lin cron that uses the shared Chrome/CDP profile on port 9222.

## User correction captured

Do not schedule cookie refresh close to Chrome-using Lin jobs, and do not blindly kill the shared Chrome instance while other crons may be doing real work.

## Why this matters

The LinkedIn cookie refresh script and Lin scan/stage/liveness workflows share the Chrome CDP profile/port (`127.0.0.1:9222`). A hard Chrome kill during scan/stage can interrupt actual job discovery or liveness work. Cookie refresh should be a low-disruption health check first, not an eager restart/login routine.

## Safer operating model

1. Schedule cookie refresh in a quiet slot far from Chrome-using jobs. In this setup, noon (`0 12 * * *`) is safer than twice daily near scan/stage/deep-prep windows.
2. First perform a non-destructive check: read LinkedIn cookies through CDP (`Storage.getCookies`) without navigation and without killing Chrome.
3. Only navigate to `/feed/` if cookies are missing/stale and a stronger auth check is needed.
4. Only kill/restart Chrome as the last fallback, and schedule that fallback in a slot where no Lin cron should be using Chrome.
5. If a kill/restart is truly needed, wait for port 9222 to become unreachable/free before starting fresh Chrome; otherwise the script can connect to a dying old browser and hang on a stale page target.

## Failure signature

A cron output with `WebSocketTimeoutException: Connection timed out` at `Page.navigate` after `Starting visible Chrome for LinkedIn login...` can mean the script connected to a stale/dying Chrome target, not that LinkedIn credentials failed. Check Chrome logs and target state before blaming GPG, password, CAPTCHA, or LinkedIn auth.

## Reporting

When the user asks why the cron failed, distinguish:
- **cron scheduling/resource collision** — ran near other Chrome/CDP work or killed shared Chrome;
- **script lifecycle bug** — connected to old/stale Chrome before port truly freed;
- **actual LinkedIn auth problem** — redirect/login/challenge after a successful CDP navigation.

Avoid saying it is a credentials problem unless the script actually reached decrypt/login and produced that evidence.