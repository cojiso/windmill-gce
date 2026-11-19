import * as gcp from '@pulumi/gcp';
import { appName, region, snapshotRetentionDays } from './config';
import { dataDisk } from './vm';

/** Daily snapshot of the data disk, taken before the nightly update (configs/windmill.cron), so a bad update can be undone. */
export const snapshotPolicy = new gcp.compute.ResourcePolicy(`${appName}-snapshot`, {
  region,
  snapshotSchedulePolicy: {
    schedule: {
      // UTC. The nightly update runs at 18:00 UTC.
      dailySchedule: { daysInCycle: 1, startTime: '17:00' },
    },
    retentionPolicy: {
      maxRetentionDays: snapshotRetentionDays,
      onSourceDiskDelete: 'KEEP_AUTO_SNAPSHOTS',
    },
    snapshotProperties: { storageLocations: region },
  },
});

export const snapshotAttachment = new gcp.compute.DiskResourcePolicyAttachment(
  `${appName}-snapshot`,
  {
    name: snapshotPolicy.name,
    disk: dataDisk.name,
    zone: dataDisk.zone,
  },
);
