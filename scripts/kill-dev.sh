#!/usr/bin/env bash
# kill-dev.sh — tear down the kobo-dev-genba tmux session at the end of a
# dispatch (Phase 1 DoD requires no lingering dev server).
set -euo pipefail
SESSION="${1:-kobo-dev-genba}"
if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
  echo "killed: $SESSION"
else
  echo "no session: $SESSION"
fi
