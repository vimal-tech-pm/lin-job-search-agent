#!/usr/bin/env python3
"""Ensure a Chrome instance is listening on CDP port 9222 for Lin cron scans."""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

PORT = 9222
URL = f"http://127.0.0.1:{PORT}/json/version"
PROFILE_DIR = Path("$LIN_REAL_HOME/.hermes/profiles/lin/chrome-cdp")
LOG_DIR = Path("$LIN_REAL_HOME/.hermes/profiles/lin/logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_DIR.mkdir(parents=True, exist_ok=True)


def reachable(timeout=1.5):
    try:
        with urlopen(URL, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        return True, data.get("Browser", "Chrome CDP reachable")
    except Exception as e:
        return False, str(e)


ok, msg = reachable()
if ok:
    print(f"Chrome CDP already running on 127.0.0.1:{PORT}: {msg}")
    sys.exit(0)

chrome = None
for candidate in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
    path = subprocess.run(["bash", "-lc", f"command -v {candidate}"], text=True, capture_output=True).stdout.strip()
    if path:
        chrome = path
        break

if not chrome:
    print("Chrome CDP unavailable: no google-chrome/chromium binary found")
    sys.exit(0)

# Prefer visible Chrome when a desktop is available; otherwise use headless Chrome for cron/server runs.
display = os.environ.get("DISPLAY") or ":0"
use_visible = bool(os.environ.get("DISPLAY")) or Path("/tmp/.X11-unix/X0").exists()
cmd = [
    chrome,
    "--remote-debugging-address=127.0.0.1",
    f"--remote-debugging-port={PORT}",
    f"--user-data-dir={PROFILE_DIR}",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-sandbox",
]
if not use_visible:
    cmd.insert(1, "--headless=new")
else:
    os.environ.setdefault("DISPLAY", display)

log = open(LOG_DIR / "lin-chrome-cdp.log", "ab", buffering=0)
try:
    subprocess.Popen(cmd, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True, env=os.environ.copy())
except Exception as e:
    print(f"Chrome CDP start failed: {type(e).__name__}: {e}")
    sys.exit(0)

for _ in range(20):
    time.sleep(0.5)
    ok, msg = reachable(timeout=1)
    if ok:
        mode = "visible" if use_visible else "headless"
        print(f"Started {mode} Chrome CDP on 127.0.0.1:{PORT}: {msg}")
        sys.exit(0)

print("Chrome CDP start attempted but port 9222 did not become reachable; scan may skip")
