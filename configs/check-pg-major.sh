#!/bin/bash
# Refuses to go on when docker-compose.yml names a Postgres major that has no data yet while an older one does. setup-vm.sh and update.sh run it before docker compose up.
#
# From 18 on, the postgres image keeps each major in its own directory (/var/lib/postgresql/18/docker). Bumping the tag to the next major does not fail: Postgres creates a new, empty cluster next to the old one, and Windmill starts on it as a fresh install, default admin password included. Moving to a new major is a dump and restore done by hand: https://www.windmill.dev/docs/advanced/self_host#upgrade-postgresql-to-18

set -euo pipefail
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${DATA_DIR:-}" ] && [ -f "$CONFIGS/.env" ]; then
  DATA_DIR="$(sed -n 's/^DATA_DIR=//p' "$CONFIGS/.env")"
fi
DATA_DIR="${DATA_DIR:-/mnt/data}"

major="$(grep -oE 'image: postgres:[0-9]+' "$CONFIGS/docker-compose.yml" | grep -oE '[0-9]+$')"
if [ -z "$major" ]; then
  echo "no postgres image found in docker-compose.yml"
  exit 1
fi

# A fresh install has no cluster at all, and the current major already has its own: both are fine.
if [ -f "$DATA_DIR/postgres/$major/docker/PG_VERSION" ]; then
  exit 0
fi
existing=""
for f in "$DATA_DIR"/postgres/*/docker/PG_VERSION; do
  if [ -f "$f" ]; then
    existing="$existing $(cat "$f")"
  fi
done
if [ -z "$existing" ]; then
  exit 0
fi

echo "docker-compose.yml asks for Postgres $major, but the data is in Postgres$existing. Starting would open an empty database. Follow the major upgrade guide, or put the tag back."
exit 1
