#!/usr/bin/env bash
# no_agent cron payload: refresh tracker, print Telegram digest (stdout is the message).
# Empty stdout = no message; non-zero exit = error alert. Both probe-confirmed Hermes semantics.
set -euo pipefail
cd "$(dirname "$(dirname "$(readlink -f "$0")")")/lin"
OUT=$(node scripts/lin-tracker.mjs 2>&1) || { echo "📊 Lin track FAILED: ${OUT:0:300}"; exit 1; }
DIGEST=$(printf '%s\n' "$OUT" | awk '/Lin funnel digest:/,/^$/')
echo "📊 Lin track — $(date +%F)"
echo "${DIGEST:-$OUT}"
# stale applied (>7 days, no status change) — top 5
python3 - <<'EOF'
import glob, re, datetime
now = datetime.datetime.now(datetime.timezone.utc)
rows = []
for f in glob.glob('companies/*/jobs/*/job.yml'):
    t = open(f, encoding='utf-8').read()
    if not re.search(r'^status:\s*applied', t, re.M):
        continue
    m = re.search(r'^applied_at:\s*[\'"]?([0-9][0-9T:.Z+-]+)', t, re.M)
    if not m:
        continue
    raw = m.group(1).strip()
    try:
        d = datetime.datetime.fromisoformat(raw.replace('Z', '+00:00'))
        if d.tzinfo is None:
            d = d.replace(tzinfo=datetime.timezone.utc)
        days = (now - d).days
    except ValueError:
        continue
    if days > 7:
        parts = f.split('/')
        rows.append((days, f"{parts[1]}/{parts[3]}"))
for days, slug in sorted(rows, reverse=True)[:5]:
    print(f"⏳ stale: {slug} — applied {days}d ago")
EOF
echo "staged awaiting build: $(node scripts/lin-worklist.mjs --status staged | grep -c . || true)"
echo "built awaiting finalize: $(node scripts/lin-worklist.mjs --status built | grep -c . || true)"
