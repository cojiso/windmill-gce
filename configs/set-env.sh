#!/bin/bash
# Sets one value in .env on the data disk, then runs setup-vm.sh so it takes effect. Run it as root.
#
#   sudo set-env.sh KEY          asks for the value without showing it, for secrets such as CLOUDFLARE_TUNNEL_TOKEN
#   sudo set-env.sh KEY VALUE    for values that are not secret, such as COMPOSE_PROFILES
#
# Asking keeps a secret out of the shell history on both ends. Over gcloud compute ssh, pass -t so there is a terminal to ask on.

set -euo pipefail
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
# configs/.env is a link to the real file on the data disk; setup-vm.sh makes it.
ENV_FILE="$(readlink -f "$CONFIGS/.env" || true)"

key="${1:-}"
if ! [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  echo "usage: $0 KEY [VALUE]"
  exit 1
fi
if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "$CONFIGS/.env does not exist yet. Run setup-vm.sh once first."
  exit 1
fi

if [ $# -ge 2 ]; then
  value="$2"
elif [ -t 0 ]; then
  read -rsp "$key: " value
  echo
else
  read -r value
fi
if [ -z "$value" ]; then
  echo "empty value, nothing changed"
  exit 1
fi

# Replace the line if the key is there, append it otherwise. awk takes the value from the environment, so no character in it needs escaping.
tmp="$(mktemp "$ENV_FILE.XXXXXX")"
K="$key" V="$value" awk '
  index($0, ENVIRON["K"] "=") == 1 { print ENVIRON["K"] "=" ENVIRON["V"]; done = 1; next }
  { print }
  END { if (!done) print ENVIRON["K"] "=" ENVIRON["V"] }
' "$ENV_FILE" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
echo "set $key in $ENV_FILE"

"$CONFIGS/setup-vm.sh"
