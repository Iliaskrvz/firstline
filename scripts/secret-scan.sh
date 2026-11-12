#!/usr/bin/env bash
# Secret scan: run on its own BEFORE pushing. Checks staged changes and commits not yet on origin.
# Prints only file names and line numbers, never the matching values.
set -euo pipefail
cd "$(dirname "$0")/.."
PATTERN='sk-ant-[A-Za-z0-9_-]{10,}|fc-[a-f0-9]{20,}|sb_secret_[A-Za-z0-9]|postgres(ql)?://[^:@ /]+:[^@ ]{6,}@|kq_whsec_[A-Za-z0-9]|polar_(oat|pat|whs|at|rt|cs)_[A-Za-z0-9]{10,}|server-[A-Za-z0-9]{24,}|fl_live_[A-Za-z0-9]{16,}|re_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,}'
base=$(git rev-parse --verify -q '@{u}' || git rev-list --max-parents=0 HEAD)
hits=$( { git diff --cached -U0; git log -p "$base"..HEAD; } | grep -nE "$PATTERN" | cut -d: -f1 || true)
tracked_env=$(git ls-files | grep -E '(^|/)\.env($|\.local|\.production)' || true)
if [ -n "$hits" ] || [ -n "$tracked_env" ]; then
  echo "SECRET SCAN: FOUND possible secrets. Do not push."
  [ -n "$hits" ] && echo "  matches at diff lines: $(echo $hits | tr '\n' ' ')"
  [ -n "$tracked_env" ] && echo "  tracked env files: $tracked_env"
  exit 1
fi
echo "SECRET SCAN: clean ($(git rev-list --count "$base"..HEAD) unpushed commit(s) + staged changes checked)"
