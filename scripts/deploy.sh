#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-/etc/bot-platform/bots/vk-content-bot.env}

if [ ! -r "$env_file" ]; then
  echo "Environment file is not readable: $env_file" >&2
  exit 1
fi

compose() {
  docker compose \
    --env-file "$env_file" \
    -f "$repo_dir/compose.yaml" \
    -f "$repo_dir/compose.production.yaml" \
    "$@"
}

compose config --quiet

# The image is public. Use an isolated client configuration so stale or
# unrelated GHCR credentials on the host cannot break the deployment.
docker_config_dir=$(mktemp -d)
trap 'rm -rf "$docker_config_dir"' EXIT HUP INT TERM
docker --config "$docker_config_dir" compose \
  --env-file "$env_file" \
  -f "$repo_dir/compose.yaml" \
  -f "$repo_dir/compose.production.yaml" \
  pull bot

compose up -d --no-build --remove-orphans bot
compose ps
