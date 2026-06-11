#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agents_file="$repo_root/AGENTS.md"
claude_file="$repo_root/CLAUDE.md"

if [[ ! -f "$agents_file" ]]; then
  echo "Missing file: AGENTS.md" >&2
  exit 1
fi

if [[ ! -f "$claude_file" ]]; then
  echo "Missing file: CLAUDE.md" >&2
  exit 1
fi

if cmp -s "$agents_file" "$claude_file"; then
  echo "OK: AGENTS.md and CLAUDE.md are identical."
  exit 0
fi

echo "Mismatch: AGENTS.md and CLAUDE.md differ."
echo
diff -u "$agents_file" "$claude_file" || true
exit 1
