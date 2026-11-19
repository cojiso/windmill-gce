#!/bin/bash
# PreToolUse hook for Bash: blocks the wmill commands that can wipe a workspace without a person looking.
# Permission rules in settings.json match command prefixes; this looks at the whole command string, so it also catches wmill behind bash -c, after a pipe, or in a chain.
#
#   wmill init                   can re-bind the directory and wipe the remote workspace
#   wmill ... --yes / -y         skips the list of changes that sync push shows before applying
#   ... | wmill                  feeds the answer to that confirmation
#
# Exit code 2 blocks the call and shows the message to Claude.

input="$(cat)"
w='(^|[^[:alnum:]_.-])wmill([[:space:]]|$|["'\''])'

if ! printf '%s' "$input" | grep -Eq "$w"; then
  exit 0
fi

reason=""
if printf '%s' "$input" | grep -Eq "(^|[^[:alnum:]_.-])wmill[[:space:]]+init([[:space:]]|$|[\"'])"; then
  reason="wmill init is not allowed here: run in the wrong directory it wipes the remote workspace."
elif printf '%s' "$input" | grep -Eq "${w}[^|;&]*[[:space:]](--yes|-y)([[:space:]=]|$|[\"'])"; then
  reason="wmill with --yes is not allowed: run it without --yes and let a person read the changes first."
elif printf '%s' "$input" | grep -Eq "\|[[:space:]]*([^[:space:]|]*/)?wmill([[:space:]]|$)"; then
  reason="Piping into wmill is not allowed: it answers the confirmation that sync push asks before applying."
fi

if [ -n "$reason" ]; then
  echo "$reason See workspace/AGENTS.md." >&2
  exit 2
fi
exit 0
