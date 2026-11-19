import * as gcp from '@pulumi/gcp';
import {
  alertEmail,
  appName,
  diskAlertPct,
  memoryAlertPct,
  notificationChannelId,
  projectId,
} from './config';
import { instance } from './vm';

const emailChannel = alertEmail
  ? new gcp.monitoring.NotificationChannel(`${appName}-email`, {
      displayName: `${appName} alerts`,
      type: 'email',
      labels: { email_address: alertEmail },
    })
  : undefined;

const notificationChannels = [
  ...(emailChannel ? [emailChannel.name] : []),
  ...(notificationChannelId ? [notificationChannelId] : []),
];

// gce_instance has no instance_name label, so the numeric ID is used.
const vmFilter = instance.instanceId.apply(
  (id) => `resource.type="gce_instance" AND resource.label.instance_id="${id}"`,
);

const usageAlert = (name: string, metric: string, pct: number) =>
  new gcp.monitoring.AlertPolicy(`${appName}-${name}`, {
    displayName: `${appName} ${name} usage > ${pct}%`,
    combiner: 'OR',
    notificationChannels,
    conditions: [
      {
        displayName: `${name} percent_used > ${pct}`,
        conditionThreshold: {
          filter: vmFilter.apply(
            (f) => `metric.type="${metric}" AND metric.label.state="used" AND ${f}`,
          ),
          comparison: 'COMPARISON_GT',
          thresholdValue: pct,
          duration: '300s',
          aggregations: [{ alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MEAN' }],
        },
      },
    ],
  });

/** From the Ops Agent. Covers both disks. */
export const diskAlert = usageAlert('disk', 'agent.googleapis.com/disk/percent_used', diskAlertPct);
export const memoryAlert = usageAlert('memory', 'agent.googleapis.com/memory/percent_used', memoryAlertPct);

/**
 * A failed update, backup, setup or health check. configs/report.sh writes an ERROR to the log windmill-jobs.
 * Log-match alerts fire on every entry, and the health check writes every 5 minutes while something is down, so notifications are limited to one an hour.
 */
export const jobFailureAlert = new gcp.monitoring.AlertPolicy(`${appName}-job-failure`, {
  displayName: `${appName} job failed`,
  combiner: 'OR',
  notificationChannels,
  conditions: [
    {
      displayName: 'ERROR in windmill-jobs',
      conditionMatchedLog: {
        filter: `logName="projects/${projectId}/logs/windmill-jobs" AND severity>=ERROR`,
      },
    },
  ],
  alertStrategy: {
    notificationRateLimit: { period: '3600s' },
    autoClose: '1800s',
  },
  documentation: {
    mimeType: 'text/markdown',
    content:
      'The message names the job and where its log is. SSH in with `gcloud compute ssh <vm> --tunnel-through-iap` and read `/var/log/windmill-*.log`. For setup-vm, read the serial port output.',
  },
});
