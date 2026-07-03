# LinkedIn cookie refresh CDP failures

Use this when `lin-linkedin-cookie-refresh` fails even though credentials/GPG are fine.

## Symptom

Cron output shows the no-agent cookie refresh script failing before credential decrypt/login:

```text
Starting visible Chrome for LinkedIn login...
websocket._exceptions.WebSocketTimeoutException: Connection timed out
  navigate(ws, FEED_URL)
  cdp_send(ws, "Page.navigate", {"url": url})
```

The health file stays stale (last successful `linkedin-session-health.json` timestamp), and no `Decrypted LinkedIn credentials` line appears.

## Interpretation

This is usually a Chrome/CDP lifecycle or target-selection problem, not a LinkedIn password, GPG, cookie, or CAPTCHA problem. The refresh script owns port `9222`, kills old remote-debugging Chrome, starts visible Chrome, connects to CDP, then navigates the selected page target. If old Chrome is still shutting down, the port/profile is in a half-alive state, or the script selects a stale/non-responsive first page target, `Page.navigate` can hang until websocket timeout.

## Forensic checks

```bash
# Latest cron output
ls -t ~/.hermes/profiles/lin/cron/output/lin-linkedin-cookie-refresh/*.md | head -3

# Confirm whether auth health actually updated
cat ~/.hermes/profiles/lin/lin/data/linkedin-session-health.json
stat ~/.hermes/profiles/lin/lin/data/linkedin-session-health.json

# Check CDP after failure
ps -ef | grep -E 'chrome.*remote-debugging-port=9222|linkedin_cookie_refresh' | grep -v grep || true
ss -tlnp 2>/dev/null | grep ':9222' || true
python3 - <<'PY'
import json, urllib.request
for url in ['http://127.0.0.1:9222/json/version','http://127.0.0.1:9222/json/list']:
    print('\n', url)
    try:
        data=json.loads(urllib.request.urlopen(url, timeout=2).read())
        print(data if not isinstance(data, list) else [{k:t.get(k) for k in ('id','type','url','title')} for t in data[:5]])
    except Exception as e:
        print(type(e).__name__, e)
PY
```

## Durable fix pattern

Patch the refresh script rather than treating this as an auth issue:

1. Wait for old `remote-debugging-port=9222` Chrome processes to fully exit after `pkill`.
2. Escalate to `SIGKILL` only for the remote-debugging Chrome if the port/profile remains locked.
3. Add `--remote-allow-origins=*` consistently to every Chrome process that should accept websocket CDP clients.
4. After startup, create/select a fresh page target for LinkedIn instead of blindly using the first `/json/list` page.
5. Wrap `Page.navigate`/CDP send timeout errors and write health status like `cdp_timeout` so future cron output distinguishes CDP failures from auth failures.
6. Keep credential decrypt after the initial `/feed/` auth check so passwords stay unused unless the session is really unauthenticated.

## Login-form detection failure after credentials decrypt

If the latest cron output shows:

```text
Starting visible Chrome for LinkedIn login...
Decrypted LinkedIn credentials
ERROR: could not find LinkedIn login form
```

interpret it as **not GPG** and **not proven bad LinkedIn credentials**. The script successfully decrypted credentials, navigated to LinkedIn, then failed to find the expected username/password fields. Check `data/linkedin-session-health.json`; a typical state is `status: failed_no_form`, `url: https://www.linkedin.com/login/`, `li_at: false`, `JSESSIONID: true`.

Likely causes:
- LinkedIn served a changed login DOM, checkpoint/challenge/interstitial, or partially rendered page.
- The script's fixed sleeps / selector wait are too brittle for the current page load.
- CDP target selection or page lifecycle selected a stale/unresponsive page, so DOM inspection ran on the wrong or incomplete target.

Patch strategy:
1. On `failed_no_form`, write safe diagnostics: current URL, title, first body-text snippet, visible input metadata (`type`, `name`, `id`, `autocomplete`, placeholder) and, if safe, a screenshot path. Do **not** log credentials or cookie values.
2. Replace fixed sleeps after `Page.navigate` with explicit DOM-ready/load-state polling and selector polling.
3. Broaden selectors for LinkedIn login fields, but first detect checkpoint/challenge/interstitial pages and report them distinctly.
4. Create/select a fresh page target for the login flow instead of blindly using the first `/json/list` page.
5. Only call it a credential failure after the form is found, filled, submitted, and LinkedIn returns an explicit rejection.

## GPG decrypt failure after Chrome starts

If the latest cron output changes from CDP timeout to:

```text
Starting visible Chrome for LinkedIn login...
ERROR: GPG decrypt failed
```

interpret it as a credential-decryption environment issue, not proof of a bad LinkedIn password, CAPTCHA, or account challenge. The script reached the login fallback and failed before it could use credentials.

Durable pitfall: Hermes cron script execution can inject a per-profile subprocess HOME such as `$HERMES_HOME/home` when that directory exists. In `linkedin_cookie_refresh.py`, using `gpg_env.setdefault("HOME", "~")` is insufficient because `setdefault` preserves the wrong cron-provided HOME. For GPG-backed local credentials, force the real OS keyring location:

```python
gpg_env = os.environ.copy()
gpg_env["HOME"] = "~"
gpg_env["GNUPGHOME"] = "~/.gnupg"
```

Do this only inside the GPG decrypt subprocess environment, not globally for all cron scripts; profile HOME isolation is intentional for most tools.

## Important distinction

`lin-score` is browserless/CDP-free. A cookie refresh failure may affect LinkedIn scan/stage browser work, but it is not the cause of score cron failures.