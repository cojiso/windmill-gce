# shellcheck shell=bash
# Sourced by the scripts on the VM. A failure is written as an ERROR entry to Cloud Logging (log name windmill-jobs), where the alert in pulumi/monitoring.ts picks it up.
# Without gcloud (not on GCE), it goes to the system journal instead.

report_failure() {
  # A failed write must not hide the original failure, so its own errors are ignored.
  if command -v gcloud >/dev/null 2>&1; then
    gcloud logging write windmill-jobs "$1 ($(hostname))" --severity=ERROR --quiet >/dev/null 2>&1 || true
  else
    logger -t windmill-jobs -p user.err "$1" || true
  fi
}

# Reports when a script stops under set -e. $1 is the job name, $2 where the details are.
# Fail with `false`, not `exit 1`: exit does not fire the ERR trap.
report_on_error() {
  # Expanded now on purpose: the trap must remember this job's name.
  # shellcheck disable=SC2064
  trap "report_failure '$1 failed: see $2'" ERR
}
