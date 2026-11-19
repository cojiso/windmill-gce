#!/bin/bash
# A fresh Windmill has the superadmin admin@windmill.dev with the password "changeme". With Caddy the login page is on the internet from the first minute, so this replaces that password with a random one whenever it still works.
# The new password is written to $DATA_DIR/config/admin-password (root only). Log in with it, create your own account, then disable or delete admin@windmill.dev.
# setup-vm.sh runs this at every boot and update.sh after every nightly update, because the account lives in Postgres: a database that comes back empty brings "changeme" back with it. When that happens after the first setup, this also raises an alert, since an empty database means the data is gone. Tested against Windmill CE 1.864.

set -euo pipefail
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
source "$CONFIGS/report.sh"
report_on_error init-admin "the startup script output (serial port) or /var/log/windmill-update.log"

if [ -z "${DATA_DIR:-}" ] && [ -f "$CONFIGS/.env" ]; then
  DATA_DIR="$(sed -n 's/^DATA_DIR=//p' "$CONFIGS/.env")"
fi
DATA_DIR="${DATA_DIR:-/mnt/data}"
PASSWORD_FILE="$DATA_DIR/config/admin-password"
API=http://127.0.0.1:8000/api

for _ in $(seq 1 90); do
  curl -sf "$API/version" >/dev/null && break
  sleep 2
done
curl -sf "$API/version" >/dev/null || { echo "Windmill did not answer on $API"; false; }

code=$(curl -s -o /tmp/windmill-login -w '%{http_code}' -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@windmill.dev","password":"changeme"}')
if [ "$code" != 200 ]; then
  rm -f /tmp/windmill-login
  exit 0
fi
token=$(cat /tmp/windmill-login)
rm -f /tmp/windmill-login

# A password file from an earlier run means this is not the first setup: the database was replaced by an empty one.
if [ -f "$PASSWORD_FILE" ]; then
  report_failure "init-admin: the default admin password worked again, so Windmill is running on an empty database. Check $DATA_DIR/postgres before anything else."
  mv "$PASSWORD_FILE" "$PASSWORD_FILE.prev"
fi

password=$(openssl rand -base64 24 | tr -d '/+=')
install -m 600 /dev/null "$PASSWORD_FILE"
echo "$password" > "$PASSWORD_FILE"
curl -sf -X POST "$API/users/setpassword" \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$password\"}" >/dev/null
echo "replaced the default admin password; it is in $PASSWORD_FILE"
