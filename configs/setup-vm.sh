#!/bin/bash
# Brings the VM to its running state. The GCE startup script runs it as root on every boot, and running it again by hand is safe.
#
#   1. Keeps the real .env on the data disk and links configs/.env to it, so it survives a VM rebuild and is covered by the disk snapshots.
#   2. Installs the cron jobs and their log rotation.
#   3. Starts everything with docker compose.
#   4. Replaces the default admin password whenever it still works (init-admin.sh).
#
# On first setup, these variables fill the new .env (the GCE startup script sets them from instance metadata): INIT_WINDMILL_DOMAIN, INIT_COMPOSE_PROFILES, INIT_BACKUP_BUCKET.

set -euo pipefail
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
source "$CONFIGS/report.sh"
report_on_error setup-vm "the startup script output (serial port)"

DATA_DIR="${DATA_DIR:-/mnt/data}"
SECRET_DIR="$DATA_DIR/config"
ENV_FILE="$SECRET_DIR/.env"

# Starting without the data disk would put Postgres on the boot disk and fill it.
if ! mountpoint -q "$DATA_DIR" || ! test -f "$DATA_DIR/.MOUNTED"; then
  echo "$DATA_DIR is not mounted"
  false
fi

# --- .env on the data disk ---
install -d -m 700 "$SECRET_DIR"
if [ ! -f "$ENV_FILE" ]; then
  # Existing Postgres data with no .env means the password is lost somewhere. A new one would lock Windmill out of its own database.
  if [ -n "$(ls -A "$DATA_DIR/postgres" 2>/dev/null)" ]; then
    echo "$ENV_FILE is missing but $DATA_DIR/postgres has data. Put the original .env back, then run this again."
    false
  fi
  install -m 600 "$CONFIGS/.env.example" "$ENV_FILE"
  set_env() { sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; }
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env DATA_DIR "$DATA_DIR"
  [ -n "${INIT_WINDMILL_DOMAIN:-}" ] && set_env WINDMILL_DOMAIN "$INIT_WINDMILL_DOMAIN"
  [ -n "${INIT_COMPOSE_PROFILES:-}" ] && set_env COMPOSE_PROFILES "$INIT_COMPOSE_PROFILES"
  [ -n "${INIT_BACKUP_BUCKET:-}" ] && set_env BACKUP_BUCKET "$INIT_BACKUP_BUCKET"
  echo "created $ENV_FILE from .env.example"
fi
chmod 600 "$ENV_FILE"
ln -sfn "$ENV_FILE" "$CONFIGS/.env"

# Every value that is __CHANGE_ME__ in .env.example must be set in .env. This also catches keys added to .env.example after .env was created.
UNSET=""
# Keys are single words, so splitting on whitespace is fine.
# shellcheck disable=SC2013
for key in $(grep -oE '^[A-Z_]+=__CHANGE_ME__$' "$CONFIGS/.env.example" | cut -d= -f1); do
  if ! grep -qE "^$key=.+" "$ENV_FILE" || grep -qE "^$key=__CHANGE_ME__$" "$ENV_FILE"; then
    UNSET="$UNSET $key"
  fi
done
if grep -qE '^COMPOSE_PROFILES=.*tunnel' "$ENV_FILE" && ! grep -qE '^CLOUDFLARE_TUNNEL_TOKEN=.+' "$ENV_FILE"; then
  UNSET="$UNSET CLOUDFLARE_TUNNEL_TOKEN"
fi
if [ -n "$UNSET" ]; then
  echo "not set in $ENV_FILE:$UNSET. Fill them in, then run this again."
  false
fi

# --- cron and log rotation ---
install -m 644 "$CONFIGS/windmill.cron" /etc/cron.d/windmill
install -m 644 "$CONFIGS/windmill.logrotate" /etc/logrotate.d/windmill

# --- start ---
cd "$CONFIGS"
install -d "$DATA_DIR/windmill/logs" "$DATA_DIR/windmill/cache" "$DATA_DIR/backups"
DATA_DIR="$DATA_DIR" "$CONFIGS/check-pg-major.sh"
# No pull, for the reason in update.sh.
# --remove-orphans also stops services that are no longer in the active profiles, such as Caddy after switching to the tunnel.
docker compose up -d --remove-orphans

"$CONFIGS/init-admin.sh"

# healthcheck.sh stays quiet until this exists. /run is cleared on reboot.
touch /run/windmill-ready
