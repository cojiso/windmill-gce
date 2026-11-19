#!/bin/bash
# Nightly update, run by cron (windmill.cron). The data disk snapshot is taken an hour earlier, so a bad update can be rolled back to that night.
#
# Images are not pulled again here. Every tag in docker-compose.yml names an exact version, so its content should never change; if it does, someone re-pushed it. `up -d` only downloads a tag that is not on the VM yet (pull_policy: missing), so a re-pushed tag is never picked up, and a new one only arrives after Renovate waited 5 days.
#
# Postgres is included: a minor version needs nothing but a restart. A new major is stopped by check-pg-major.sh, since it needs a dump and restore by hand.

set -euo pipefail
CONFIGS="$(cd "$(dirname "$0")" && pwd)"
source "$CONFIGS/report.sh"
report_on_error update /var/log/windmill-update.log

cd "$CONFIGS/.."
# Picks up the image bumps Renovate merged. .env is gitignored, so this never conflicts. --ff-only refuses to merge if someone edited files on the VM.
git pull --ff-only --quiet

cd "$CONFIGS"
# Let the cron and logrotate files follow the repository too.
install -m 644 windmill.cron /etc/cron.d/windmill
install -m 644 windmill.logrotate /etc/logrotate.d/windmill

# Stops here if the Postgres tag moved to a new major (see check-pg-major.sh).
./check-pg-major.sh

# A plain up -d only recreates what changed.
docker compose up -d --remove-orphans

# Replaces "changeme" if an empty database brought it back, and raises an alert when it does.
./init-admin.sh

# -a is required: without it, images left behind by a tag bump are not dangling and pile up.
docker image prune -af
docker container prune -f
