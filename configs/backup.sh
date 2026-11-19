#!/bin/bash
# Nightly database dump, run by cron (windmill.cron).
#
# pg_dumpall, not pg_dump: Windmill keeps more than the windmill database in the cluster (data tables, DuckLake, forks) and grants to cluster-level roles. A dump of the windmill database alone silently loses both.
# With BACKUP_BUCKET set, the dump goes to GCS, where a lifecycle rule deletes old ones. The VM's service account can add files there but not delete them, so a compromised VM cannot wipe the backups.
# Without it, dumps stay in $DATA_DIR/backups for 7 days. They then live on the same disk as the database, so this is a convenience, not a backup.

set -euo pipefail
# The dump contains every secret stored in Windmill.
umask 077
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
source "$CONFIGS/report.sh"
report_on_error backup /var/log/windmill-backup.log

cd "$CONFIGS"
set -a
# shellcheck disable=SC1091
source .env
set +a

install -d -m 700 "$DATA_DIR/backups"
FILE="$DATA_DIR/backups/windmill-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T db sh -c 'pg_dumpall -U "$POSTGRES_USER"' | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

if [ -n "${BACKUP_BUCKET:-}" ]; then
  gcloud storage cp --quiet "$FILE" "gs://$BACKUP_BUCKET/db/"
  rm -f "$FILE"
else
  find "$DATA_DIR/backups" -name 'windmill-*.sql.gz' -mtime +7 -delete
fi
