// Must come first: it makes every resource below wait for the Google APIs.
import './services';
import { domain, exposure, projectId, zone } from './config';
import { address } from './network';
import './monitoring';
import './snapshot';
import { backupBucket } from './storage';
import { instance } from './vm';

export const instanceName = instance.name;
export const instanceZone = zone;
export const backupBucketName = backupBucket.name;
/** caddy: point an A record for the domain at this address. */
export const publicIp = address?.address;
export const url = `https://${domain}`;
export const sshCommand = instance.name.apply(
  (name) => `gcloud compute ssh ${name} --zone ${zone} --project ${projectId} --tunnel-through-iap`,
);
export const front = exposure;
/** Private repository: prints the public key to add as a read-only deploy key on GitHub. */
export const deployKeyCommand = instance.name.apply(
  (name) =>
    `gcloud compute instances get-guest-attributes ${name} --zone ${zone} --project ${projectId} --query-path=windmill/deploy-key --format='value(value)'`,
);
