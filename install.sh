#!/bin/bash
# Symlink the extension into your VSCode server so it loads in Remote-SSH sessions.
# Then run "Developer: Reload Window".
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.vscode-server/extensions/bdsp.cluster-monitor-0.1.0"
mkdir -p "$HOME/.vscode-server/extensions"
ln -sfn "$SRC" "$DEST"
echo "Linked $DEST -> $SRC. Reload the VSCode window."
