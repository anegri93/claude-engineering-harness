#!/usr/bin/env bash
# generated-by: claude-engineering-harness
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

AUTO_INFRA="${HARNESS_AUTO_INFRA:-1}"
AUTO_COMPOSE="${HARNESS_AUTO_COMPOSE:-auto}"
DOCKER_WAIT_SECONDS="${HARNESS_DOCKER_WAIT_SECONDS:-120}"
SUPABASE_WAIT_SECONDS="${HARNESS_SUPABASE_WAIT_SECONDS:-180}"

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_docker() {
  local waited=0
  until docker info >/dev/null 2>&1; do
    if (( waited >= DOCKER_WAIT_SECONDS )); then
      echo "Docker did not become ready within ${DOCKER_WAIT_SECONDS}s." >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

ensure_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "Local verification requires Docker, but the docker CLI was not found." >&2
    return 1
  }

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if ! is_true "$AUTO_INFRA"; then
    echo "Docker is not running and HARNESS_AUTO_INFRA is disabled." >&2
    return 1
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1 && open -Ra Docker >/dev/null 2>&1; then
    echo "==> environment: starting Docker Desktop"
    open -a Docker >/dev/null 2>&1 || true
    wait_for_docker
    return
  fi

  echo "Docker is installed but not running. Start Docker and retry verification." >&2
  return 1
}

supabase_cmd=()
resolve_supabase() {
  if command -v supabase >/dev/null 2>&1; then
    supabase_cmd=(supabase)
    return 0
  fi
  if [[ -x node_modules/.bin/supabase ]]; then
    supabase_cmd=(node_modules/.bin/supabase)
    return 0
  fi
  if command -v npx >/dev/null 2>&1 && [[ -f package.json ]] \
    && node -e "const p=require('./package.json'); const d={...p.dependencies,...p.devDependencies}; process.exit(d.supabase ? 0 : 1)" >/dev/null 2>&1; then
    supabase_cmd=(npx --no-install supabase)
    return 0
  fi
  return 1
}

wait_for_supabase() {
  local waited=0
  until "${supabase_cmd[@]}" status -o json >/dev/null 2>&1; do
    if (( waited >= SUPABASE_WAIT_SECONDS )); then
      echo "Supabase local did not become ready within ${SUPABASE_WAIT_SECONDS}s." >&2
      return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
}

ensure_supabase() {
  [[ -f supabase/config.toml ]] || return 0
  echo "==> environment: Supabase local"
  ensure_docker
  resolve_supabase || {
    echo "Supabase local is configured but the Supabase CLI was not found." >&2
    echo "Install the Supabase CLI or add it to this project's devDependencies." >&2
    return 1
  }

  if "${supabase_cmd[@]}" status -o json >/dev/null 2>&1; then
    echo "    Supabase is already running."
    return 0
  fi

  if ! is_true "$AUTO_INFRA"; then
    echo "Supabase local is not running and HARNESS_AUTO_INFRA is disabled." >&2
    return 1
  fi

  echo "    Supabase is not running; starting the local stack..."
  "${supabase_cmd[@]}" start
  wait_for_supabase
  echo "    Supabase is ready."
}

compose_file=""
for candidate in compose.yml compose.yaml docker-compose.yml docker-compose.yaml; do
  if [[ -f "$candidate" ]]; then compose_file="$candidate"; break; fi
done

project_references_compose() {
  [[ -n "$compose_file" ]] || return 1
  [[ -f .claude/auto-compose ]] && return 0
  [[ "$AUTO_COMPOSE" == "1" || "$AUTO_COMPOSE" == "true" ]] && return 0
  [[ "$AUTO_COMPOSE" == "0" || "$AUTO_COMPOSE" == "false" ]] && return 1

  if [[ -f package.json ]] && grep -Eq 'docker[ -]compose|docker compose' package.json 2>/dev/null; then
    return 0
  fi
  if [[ -d scripts ]] && grep -R -E -q 'docker[ -]compose|docker compose' scripts --exclude-dir=node_modules 2>/dev/null; then
    return 0
  fi
  return 1
}

ensure_compose() {
  project_references_compose || return 0
  echo "==> environment: Docker Compose"
  ensure_docker

  if ! is_true "$AUTO_INFRA"; then
    echo "Compose-backed infrastructure may be required, but HARNESS_AUTO_INFRA is disabled." >&2
    return 1
  fi

  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$compose_file" up -d
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$compose_file" up -d
  else
    echo "A compose file was detected, but Docker Compose is unavailable." >&2
    return 1
  fi
}

# Supabase owns its own Docker Compose lifecycle; avoid independently bringing up
# an unrelated compose file merely because Supabase is present.
if [[ -f supabase/config.toml ]]; then
  ensure_supabase
else
  ensure_compose
fi

exit 0
