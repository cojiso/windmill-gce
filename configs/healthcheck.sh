#!/bin/bash
# Runs every 5 minutes (windmill.cron). Reports when a container of the active profiles is not running, or Postgres is not healthy, twice in a row (about 10 minutes). Waiting for the second time keeps the nightly recreate from being reported.
# While something stays down it reports every 5 minutes. The alert in pulumi/monitoring.ts limits notifications to one an hour.

set -euo pipefail
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
source "$CONFIGS/report.sh"

READY=/run/windmill-ready
FAILS=/run/windmill-health-fails

# setup-vm.sh creates this when it finishes. Nothing is checked right after boot.
[ -f "$READY" ] || exit 0

cd "$CONFIGS"
status=""
for svc in $(docker compose config --services); do
  if [ "$svc" = db ]; then
    health=$(docker compose ps db --format '{{.Health}}' 2>/dev/null || true)
    [ "$health" = healthy ] || status="$status db=${health:-missing}"
  else
    state=$(docker compose ps "$svc" --format '{{.State}}' 2>/dev/null || true)
    [ "$state" = running ] || status="$status $svc=${state:-missing}"
  fi
done

if [ -z "$status" ]; then
  rm -f "$FAILS"
  exit 0
fi

n=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$FAILS"
echo "$(date -Iseconds)$status (failure $n)"
if [ "$n" -ge 2 ]; then
  report_failure "healthcheck failed:$status"
fi
