#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_ID="md-workbench.desktop"
TARGET_DIR="$HOME/.local/share/applications"
TARGET_PATH="$TARGET_DIR/$DESKTOP_ID"

mkdir -p "$TARGET_DIR"

cat > "$TARGET_PATH" <<EOF
[Desktop Entry]
Type=Application
Name=md-workbench
Comment=Edit and render Markdown
Exec=$APP_DIR/scripts/run.sh %f
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
StartupWMClass=md-workbench
EOF

chmod 0644 "$TARGET_PATH"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$TARGET_DIR" || true

xdg-mime default "$DESKTOP_ID" text/markdown || true
xdg-mime default "$DESKTOP_ID" text/x-markdown || true

echo "Installed $DESKTOP_ID and set as default for text/markdown (and text/x-markdown)."
echo "Query with: xdg-mime query default text/markdown"

