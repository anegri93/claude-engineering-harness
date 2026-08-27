#!/usr/bin/env bash
set -euo pipefail
CLAUDE_DIR="${HOME}/.claude"
IMPORT_LINE='@~/.claude/harness/engineering.md'
rm -f "$CLAUDE_DIR/rules/harness-typescript.md" \
      "$CLAUDE_DIR/rules/harness-react.md" \
      "$CLAUDE_DIR/rules/harness-tests.md" \
      "$CLAUDE_DIR/rules/harness-sql.md" \
      "$CLAUDE_DIR/agents/engineering-code-reviewer.md" \
      "$CLAUDE_DIR/hooks/verify-project.sh" \
      "$CLAUDE_DIR/hooks/mark-baseline-dirty.sh"
rm -rf "$CLAUDE_DIR/skills/engineering-review" "$CLAUDE_DIR/harness" "$CLAUDE_DIR/harness-tools" "$CLAUDE_DIR/harness-runtime"
if [[ -f "$CLAUDE_DIR/CLAUDE.md" ]]; then
  tmp="$(mktemp)"
  awk -v import="$IMPORT_LINE" '
    $0 == "# Global Engineering Harness" { next }
    $0 == import { next }
    { print }
  ' "$CLAUDE_DIR/CLAUDE.md" > "$tmp"
  mv "$tmp" "$CLAUDE_DIR/CLAUDE.md"
fi
if command -v node >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  [[ -f "$SCRIPT_DIR/tools/remove-settings-hook.mjs" ]] && node "$SCRIPT_DIR/tools/remove-settings-hook.mjs"
fi
echo "Harness files removed. Existing backups were preserved."
