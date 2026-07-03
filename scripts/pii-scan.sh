#!/usr/bin/env bash
# pii-scan.sh — blocking gate before any public push. Exit 1 on ANY hit.
# Patterns cover: owner identity, contact info, real application data leakage.
set -uo pipefail
cd "$(dirname "$0")/.."

# Identity patterns: checked EVERYWHERE, including tests.
ID_PATTERNS=(
  'vimal'                                # owner name (any case)
  'cryptoantman'                         # personal email
  'sekar'                                # surname
  '[0-9]{3}[- .][0-9]{3}[- .][0-9]{4}'   # phone (555 placeholders allowlisted)
  '996819994'                            # telegram chat id
)
# Data-leak patterns: real application values; synthetic fixtures under tests/ are exempt.
DATA_PATTERNS=(
  'applied_at: "20'
  'pathfinder_score: [0-9]'
)
# vimal-tech-pm / portfolio / credit lines are intentional; 555 numbers are placeholders.
ALLOW='vimal-tech-pm|github\.com/vimal|vimalsekar-portfolio|Vimal Sekar|555[- .]?0[0-9]{2}[- .]?0[0-9]{3}'

FAIL=0
scan() { # $1=pattern $2=extra-grep-v (optional)
  local hits
  hits=$(grep -rniE --exclude-dir=.git --exclude-dir=node_modules --exclude=pii-scan.sh "$1" . \
    | grep -viE "$ALLOW" | { [[ -n "${2:-}" ]] && grep -vE "$2" || cat; } || true)
  if [[ -n "$hits" ]]; then echo "PII HIT [$1]:"; echo "$hits" | head -10; FAIL=1; fi
}
for p in "${ID_PATTERNS[@]}"; do scan "$p"; done
for p in "${DATA_PATTERNS[@]}"; do scan "$p" '/tests/'; done

# real company slugs from the live vault must not appear as vault paths
if [[ -d ~/.hermes/profiles/lin/lin/companies ]]; then
  for co in $(ls ~/.hermes/profiles/lin/lin/companies | head -80); do
    hits=$(grep -rli --exclude-dir=.git --exclude-dir=node_modules --exclude=pii-scan.sh "companies/$co/" . || true)
    [[ -n "$hits" ]] && { echo "PII HIT [vault company path $co]: $hits"; FAIL=1; }
  done
fi
[[ $FAIL -eq 0 ]] && echo "PII SCAN CLEAN" || echo "PII SCAN FAILED — do not push"
exit $FAIL
