#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${CLAUDE_DIR}/harness-backups/${STAMP}"
mkdir -p "$CLAUDE_DIR" "$BACKUP_DIR"

graft_version() {
  local raw
  raw="$(graft --version 2>/dev/null || graft version 2>/dev/null || true)"
  printf '%s' "$raw" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?' | head -n 1
}

version_gt() {
  local a="$1" b="$2"
  [[ -n "$a" && -n "$b" ]] || return 1
  node -e '
    const a=process.argv[1].split(/[.-]/).slice(0,3).map(Number);
    const b=process.argv[2].split(/[.-]/).slice(0,3).map(Number);
    for(let i=0;i<3;i++){ if((a[i]||0)>(b[i]||0)) process.exit(0); if((a[i]||0)<(b[i]||0)) process.exit(1); }
    process.exit(1);
  ' "$a" "$b"
}

ensure_graft() {
  command -v npm >/dev/null 2>&1 || {
    if command -v graft >/dev/null 2>&1; then
      echo "Graft installed, but npm is unavailable so the harness cannot check for updates: $(graft_version || echo unknown)"
      return 0
    fi
    echo "ERROR: Graft is required, but npm was not found." >&2
    exit 127
  }

  local installed="" latest=""
  if command -v graft >/dev/null 2>&1; then
    installed="$(graft_version || true)"
  fi
  latest="$(npm view @nanonets/graft version --silent 2>/dev/null || true)"

  if [[ -z "$installed" ]]; then
    echo "Installing latest Graft repository-context layer..."
    npm install -g @nanonets/graft@latest
  elif [[ -n "$latest" ]] && version_gt "$latest" "$installed"; then
    echo "Updating Graft: ${installed} -> ${latest}"
    npm install -g @nanonets/graft@latest
  elif [[ -n "$latest" ]] && version_gt "$installed" "$latest"; then
    echo "Installed Graft ${installed} is newer than npm latest ${latest}; keeping installed version."
  elif [[ -n "$latest" ]]; then
    echo "Graft is current: ${installed}"
  else
    echo "Could not query the npm registry for the latest Graft version; keeping installed version ${installed}."
  fi

  command -v graft >/dev/null 2>&1 || { echo "ERROR: graft command is not in PATH." >&2; exit 127; }
}
ensure_graft

backup_if_exists() {
  local path="$1"
  if [[ -e "$path" ]]; then
    local relative="${path#"${CLAUDE_DIR}"/}"
    mkdir -p "$BACKUP_DIR/$(dirname "$relative")"
    cp -R "$path" "$BACKUP_DIR/$relative"
  fi
}
install_file() {
  local src="$1" dst="$2"
  backup_if_exists "$dst"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  # Derive the executable bit from the source rather than a second list of which files are
  # scripts, which is one more thing that goes stale when a file is added.
  if [[ -x "$src" ]]; then
    chmod +x "$dst"
  fi
}

# Every payload directory is walked rather than listed. A hardcoded list fails silently in
# the passing direction: a file added to src/ is committed, reviewed and documented, and
# simply never reaches the user, with no error anywhere. tests/payload.test.mjs proves a
# newly added file in each of these directories installs and uninstalls.

# `harness-` under rules/, agents/ and skills/ is this harness's namespace inside a directory
# the user also owns, so it can be pruned before reinstalling. Without the prune, a rule that
# is renamed or dropped upstream keeps loading into every session forever. Nothing outside
# the namespace is touched. The two unprefixed names are what the harness shipped before the
# namespace existed; they are removed so an upgrade does not leave a second, stale reviewer.
rm -f "$CLAUDE_DIR"/rules/harness-*.md \
      "$CLAUDE_DIR"/agents/harness-*.md \
      "$CLAUDE_DIR/agents/engineering-code-reviewer.md"
rm -rf "$CLAUDE_DIR"/skills/harness-* "$CLAUDE_DIR/skills/engineering-review"

for harness_file in "$SOURCE_DIR"/src/harness/*; do
  [[ -f "$harness_file" ]] || continue
  install_file "$harness_file" "$CLAUDE_DIR/harness/$(basename "$harness_file")"
done

for rule in "$SOURCE_DIR"/src/rules/*.md; do
  [[ -f "$rule" ]] || continue
  install_file "$rule" "$CLAUDE_DIR/rules/$(basename "$rule")"
done

for agent in "$SOURCE_DIR"/src/agents/*.md; do
  [[ -f "$agent" ]] || continue
  install_file "$agent" "$CLAUDE_DIR/agents/$(basename "$agent")"
done

# A skill is a directory: SKILL.md plus whatever references it ships.
for skill in "$SOURCE_DIR"/src/skills/*/; do
  [[ -d "$skill" ]] || continue
  skill_name="$(basename "$skill")"
  backup_if_exists "$CLAUDE_DIR/skills/$skill_name"
  mkdir -p "$CLAUDE_DIR/skills/$skill_name"
  cp -R "$skill." "$CLAUDE_DIR/skills/$skill_name/"
done

for hook in "$SOURCE_DIR"/src/hooks/*.sh; do
  [[ -f "$hook" ]] || continue
  install_file "$hook" "$CLAUDE_DIR/hooks/$(basename "$hook")"
done

mkdir -p "$CLAUDE_DIR/harness/project-template"
cp -R "$SOURCE_DIR/project-template/." "$CLAUDE_DIR/harness/project-template/"

# harness-tools/ is removed wholesale by uninstall, so everything under tools/ can be shipped
# without a per-file removal obligation.
mkdir -p "$CLAUDE_DIR/harness-tools"
for tool in "$SOURCE_DIR"/tools/*; do
  [[ -f "$tool" ]] || continue
  install_file "$tool" "$CLAUDE_DIR/harness-tools/$(basename "$tool")"
done

GLOBAL_CLAUDE="$CLAUDE_DIR/CLAUDE.md"
IMPORT_LINE='@~/.claude/harness/engineering.md'
backup_if_exists "$GLOBAL_CLAUDE"
if [[ ! -f "$GLOBAL_CLAUDE" ]]; then
  printf '# Personal Claude Code Instructions\n\n%s\n' "$IMPORT_LINE" > "$GLOBAL_CLAUDE"
elif ! grep -Fqx "$IMPORT_LINE" "$GLOBAL_CLAUDE"; then
  printf '\n# Global Engineering Harness\n%s\n' "$IMPORT_LINE" >> "$GLOBAL_CLAUDE"
fi

backup_if_exists "$CLAUDE_DIR/settings.json"
if command -v node >/dev/null 2>&1; then
  node "$SOURCE_DIR/tools/merge-settings.mjs"
else
  echo "ERROR: Node.js is required to merge Claude Code settings." >&2
  exit 127
fi

echo
echo "Claude Engineering Harness v6 installed."
echo "Backup: $BACKUP_DIR"
echo "Restart Claude Code so hooks, skills, agents, model settings, and Graft wiring are reloaded."
# Read back from HARNESS_DEFAULTS rather than restated here, so this cannot report a model
# the installer did not actually apply.
# shellcheck disable=SC2016  # the ${} below are JS template literals: shell expansion here is exactly what must not happen
node -e '
  import("file://" + process.argv[1]).then(({ HARNESS_DEFAULTS }) => {
    console.log(`Default Claude model: ${HARNESS_DEFAULTS.model}`)
    console.log(`Default effort: ${HARNESS_DEFAULTS.effortLevel}`)
  })
' "$SOURCE_DIR/tools/settings-io.mjs"
echo "For a project: cd into the repo and run ~/.claude/harness-tools/init-project.sh"
echo "v6 adds automatic local-environment preflight before verification and keeps Graft updated to the latest available release. The living baseline remains automatic after verified edits."
