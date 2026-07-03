# Multi-Gateway Telegram Diagnostics

> Diagnose "Telegram not responding" in a multi-gateway Hermes setup (default + lin + ironman). Covers the layered check to distinguish a stalled poller from a wrong-bot scenario from a dead gateway.

## Scenario

Three gateways run simultaneously:
- **Default** (no `--profile` flag) — PID from `gateway_state.json` or `ps aux`
- **Lin** — `--profile lin` flag
- **Ironman** — `--profile ironman` flag

Each has its own Telegram bot token. If the user says "Telegram isn't responding", they could be messaging the wrong bot, or the right bot's polling could have stalled.

## Diagnostic chain

### 1. List all running gateways

```bash
ps aux | grep '[h]ermes.*gateway'
```

Three PIDs is normal for this setup. Note each PID and its `--profile` argument.

### 2. Check each profile's Telegram bot token

```bash
# Default
grep -A2 'telegram:' ~/.hermes/config.yaml | grep 'token:'

# Named profile
grep -A2 'telegram:' ~/.hermes/profiles/<name>/config.yaml | grep 'token:'
```

Different prefix = different Telegram bot. The user's DM only reaches one of them.

### 3. Check gateway_state.json

```bash
cat ~/.hermes/gateway_state.json          # default
cat ~/.hermes/profiles/<name>/gateway_state.json  # named profile
```

Look for:
- `gateway_state`: should be `"running"`
- `platforms.telegram.state`: should be `"connected"`
- `updated_at`: recent timestamp — stale (>2h with no activity) suggests polling stalled

### 4. Check gateway.log for recent activity

```bash
# Default
tail -50 ~/.hermes/logs/gateway.log

# Named profile
tail -50 ~/.hermes/profiles/<name>/logs/gateway.log
```

Signs of a live gateway:
- `inbound message: platform=telegram user=NXG` — user messages are being received and processed
- `response ready: platform=telegram` — responses are being sent back
- Cron deliveries via `delivered to telegram:YOUR_TELEGRAM_CHAT_ID`

All-clear when the log shows inbound messages from today and responses sent.

### 5. Test bot connectivity

```bash
TOKEN=<the token from step 2>
curl -s "https://api.telegram.org/bot${TOKEN}/getMe"
```

Should return `{"ok":true,"user":{"id":...}}`. Timeout or 404 means the token is invalid or expired.

### 6. Check agent.log for inference failures

```bash
tail -50 ~/.hermes/logs/agent.log
```

A gateway can receive a message and start processing but fail during the LLM call (429, 401, model unavailable). The user sees "no response" but the gateway did work — it just never got a reply from the model.

## Common root causes

| Symptom | Likely cause |
|---|---|
| User messages the default bot, response comes from lin bot | **Different bots** — user is using the wrong Telegram bot for that profile |
| gateway_state says `connected`, log is silent for hours | Polling stalled; restart the gateway |
| gateway_state says `connected`, log is silent for hours | Polling stalled on dead socket; restart the gateway |
| `CLOSE-WAIT` sockets to Telegram IPs in `ss -tnp` | Stale TCP connections — Telegram server closed, gateway never noticed; polling thread stuck in `epoll_wait` on dead fd |
| Log shows `409 Conflict: terminated by other getUpdates request` | Two getUpdates long-polls on same token — either a second process or a stale long-poll held on Telegram's servers |
| Two gateways show same bot token | **Polling conflict** — Telegram bots refuse parallel pollers; only one gateway gets updates |

## Preventing the wrong-bot scenario

When the user is in a **lin profile session** (like this one), all commands route to the Lin bot. If you tell the user to "check Telegram for the cron digest", they'll see it from the Lin bot — the default bot won't contain Lin cron output (each profile's cron jobs have independent `deliver:` targets tied to their own gateway).

When diagnosing "Telegram not responding", always check which bot the user is messaging, not just which gateway is up.

## Deep diagnosis: silent polling stall (2026-06-20)

When `gateway status` says running and `gateway_state.json` says "connected"
but the bot is genuinely not responding, do NOT stop at step 3 of the chain
above. The state file can be stale for hours. Continue to:

### Step 7: Check TCP socket health

```bash
ss -tnp | grep <gateway-pid>
```

`CLOSE-WAIT` sockets to `149.154.166.110:443` (Telegram fallback IP) or
`api.telegram.org` mean the Telegram server closed the long-poll connection
but the gateway's HTTP client never noticed. The polling thread sits in
`epoll_wait` on a dead socket indefinitely.

### Step 8: Check thread states

```bash
ls /proc/<pid>/task | while read tid; do
  state=$(cat /proc/<pid>/task/$tid/stat 2>/dev/null | awk '{print $3}')
  wchan=$(cat /proc/<pid>/task/$tid/wchan 2>/dev/null)
  echo "tid=$tid state=$state wchan=$wchan"
done
```

A polling thread in `do_epoll_wait` is normal IF the socket is healthy.
It's stalled if the underlying socket is CLOSE-WAIT.

### Step 9: Check for 409 Conflict in logs

```bash
grep -i 'conflict\|409\|terminated.*getUpdates' \
  <hermes_home>/logs/gateway.log | tail -10
```

A 409 means two long-polls are running on the same token. The gateway has
a retry mechanism (up to 5 attempts, 20s waits), but the stale poll may
keep getting re-created.

### Step 10: Verify bot token isolation

```bash
grep 'token:' ~/.hermes/config.yaml ~/.hermes/profiles/*/config.yaml
```

Each profile MUST use a different token. Same token = permanent 409 conflict.

### Step 11: Check inbound message gaps

```bash
grep 'inbound message' <hermes_home>/logs/gateway.log | tail -10
```

A multi-hour gap with no inbound messages while the user was active means
polling is stalled. Compare with other profile gateways to confirm the user
was messaging a different bot during the gap.

### Fix

```bash
systemctl --user restart hermes-<profile>-gateway.service
```

A full reboot also works — all 6 Hermes systemd services auto-start (linger=yes).
A reboot is the cleanest fix when multiple gateways have stale sockets.
