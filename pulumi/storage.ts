import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { appName, backupRetentionDays, projectId, region } from './config';
import { vmSa } from './sa';

/** Nightly dumps from configs/backup.sh. Bucket names are global, so the project ID is part of it. */
export const backupBucket = new gcp.storage.Bucket(
  `${appName}-backup`,
  {
    name: `${projectId}-${appName}-backup`,
    location: region,
    storageClass: 'NEARLINE',
    uniformBucketLevelAccess: true,
    publicAccessPrevention: 'enforced',
    lifecycleRules: [{ condition: { age: backupRetentionDays }, action: { type: 'Delete' } }],
  },
  { protect: true },
);

/**
 * Create and read, but no delete: someone who takes over Windmill cannot wipe the existing backups. The lifecycle rule removes old ones.
 * Uploading with `gcloud storage cp` needs get and list besides create; delete is only needed to overwrite, and backup.sh always writes a new name.
 */
export const backupWriters = ['roles/storage.objectCreator', 'roles/storage.objectViewer'].map(
  (role) =>
    new gcp.storage.BucketIAMMember(`${appName}-backup-${role.split('.')[1]}`, {
      bucket: backupBucket.name,
      role,
      member: pulumi.interpolate`serviceAccount:${vmSa.email}`,
    }),
);
