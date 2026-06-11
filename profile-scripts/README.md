# Profile-level scripts

These belong in `~/.hermes/profiles/lin/scripts/` (the PROFILE scripts dir, not the vault):

- `lin-track-digest.sh` — payload for the no_agent `lin-track` cron (must be a real file here; the runner blocks symlinks resolving outside this dir).
- `lin-serve-watchdog.sh` — keeps the dashboard server alive (no_agent cron, daily).
- `ensure_chrome_cdp.py` — pre-agent Chrome/CDP bootstrap for browser scans (attach as `script:` on scan/stage jobs).
