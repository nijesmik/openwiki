#!/usr/bin/env bash
# Reproduces writeLastUpdateMetadata() in src/agent/utils.ts: records a
# successful init/update run so future update runs can diff from this git head.
#
# Usage: last-update.sh <init|update> [model-id]
set -eu

command="${1:?usage: last-update.sh <init|update> [model-id]}"
model="${2:-claude-code}"
metadata_file="openwiki/.last-update.json"

updated_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
git_head="$(git rev-parse HEAD 2>/dev/null || true)"

mkdir -p openwiki

if [ -n "$git_head" ]; then
  cat > "$metadata_file" <<EOF
{
  "updatedAt": "$updated_at",
  "command": "$command",
  "gitHead": "$git_head",
  "model": "$model"
}
EOF
else
  cat > "$metadata_file" <<EOF
{
  "updatedAt": "$updated_at",
  "command": "$command",
  "model": "$model"
}
EOF
fi

echo "Wrote $metadata_file"
