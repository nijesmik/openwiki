#!/usr/bin/env bash
# Reproduces the git evidence block built by createGitSummary() in
# src/agent/utils.ts, so the plugin commands can inject the same
# "Git context" / "Git change summary" sections the CLI passed to the agent.
#
# Usage: git-summary.sh <init|update>
set -u

command="${1:-init}"
metadata_file="openwiki/.last-update.json"

run_git() {
  git --no-pager "$@" 2>&1
}

print_section() {
  printf '$ %s\n' "$1"
  if [ -n "$2" ]; then
    printf '%s\n' "$2"
  else
    printf '(no output)\n'
  fi
}

status_output="$(run_git status --short)"
head_output="$(git --no-pager rev-parse HEAD 2>/dev/null || true)"

print_section "git status --short" "$status_output"
echo
print_section "git rev-parse HEAD" "${head_output:-(unknown)}"
echo

last_git_head=""
last_updated_at=""
if [ "$command" = "update" ] && [ -f "$metadata_file" ]; then
  last_git_head="$(sed -n 's/.*"gitHead": *"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
  last_updated_at="$(sed -n 's/.*"updatedAt": *"\([^"]*\)".*/\1/p' "$metadata_file" | head -n 1)"
fi

if [ "$command" = "update" ] && [ -n "$last_git_head" ]; then
  log_output="$(run_git log "${last_git_head}..HEAD" --name-status --oneline)"
  print_section "git log ${last_git_head}..HEAD --name-status --oneline" "$log_output"
elif [ "$command" = "update" ] && [ -n "$last_updated_at" ]; then
  log_output="$(run_git log --since "$last_updated_at" --name-status --oneline)"
  print_section "git log --since ${last_updated_at} --name-status --oneline" "$log_output"
else
  if [ "$command" = "update" ]; then
    echo "No prior OpenWiki update timestamp was found."
    echo
  fi
  log_output="$(run_git log --max-count=20 --name-status --oneline)"
  print_section "git log --max-count=20 --name-status --oneline" "$log_output"
fi
echo

diff_output="$(run_git diff --name-status HEAD)"
print_section "git diff --name-status HEAD" "$diff_output"
