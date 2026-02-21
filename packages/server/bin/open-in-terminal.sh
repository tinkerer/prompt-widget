#!/bin/bash
# Opens a prompt-widget tmux session in Terminal.app
# Usage: open-in-terminal.sh <tmux-session-name>
TMUX_NAME="$1"
if [ -z "$TMUX_NAME" ]; then
  echo "Usage: $0 <tmux-session-name>" >&2
  exit 1
fi
TMPFILE=$(mktemp /tmp/pw-open-XXXXXX.command)
cat > "$TMPFILE" << EOF
#!/bin/bash
tmux -L prompt-widget attach-session -t $TMUX_NAME
rm -f "$TMPFILE"
EOF
chmod +x "$TMPFILE"
open "$TMPFILE"
