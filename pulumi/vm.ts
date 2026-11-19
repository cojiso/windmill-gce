import * as gcp from '@pulumi/gcp';
import {
  appName,
  bootDiskGb,
  dataDiskGb,
  domain,
  exposure,
  machineType,
  repoBranch,
  repoUrl,
  zone,
} from './config';
import { address, nat, networkName, networkTag } from './network';
import { vmSa } from './sa';
import { startupScript } from './startup-script';
import { backupBucket } from './storage';

const dataDeviceName = `${appName}-data`;

/** Everything that matters lives here: Postgres, .env, certificates. Separate from the VM, so the VM can be rebuilt at will. */
export const dataDisk = new gcp.compute.Disk(
  `${appName}-data`,
  { type: 'pd-balanced', zone, size: dataDiskGb },
  { protect: true },
);

export const instance = new gcp.compute.Instance(
  `${appName}-vm`,
  {
    machineType,
    zone,
    tags: [networkTag],
    bootDisk: {
      initializeParams: {
        // Debian rather than Ubuntu: no snapd, whose old revisions pile up on the boot disk.
        image: 'debian-cloud/debian-13',
        size: bootDiskGb,
        type: 'pd-balanced',
      },
    },
    attachedDisks: [{ source: dataDisk.id, deviceName: dataDeviceName }],
    networkInterfaces: [
      {
        network: networkName,
        // caddy: the static IP. tunnel: no public IP; outbound traffic goes through Cloud NAT.
        accessConfigs: address ? [{ natIp: address.address }] : [],
      },
    ],
    serviceAccount: { email: vmSa.email, scopes: ['cloud-platform'] },
    // Passed as metadata, not as metadataStartupScript: changing metadata updates the VM in place, while changing metadataStartupScript rebuilds it.
    // The wm-* values only seed .env on the first boot. Later changes go into .env on the VM.
    metadata: {
      'enable-oslogin': 'TRUE',
      // Lets the startup script publish the deploy key for a private repository.
      'enable-guest-attributes': 'TRUE',
      'startup-script': startupScript(dataDeviceName),
      'wm-repo-url': repoUrl,
      'wm-repo-branch': repoBranch,
      'wm-domain': domain,
      'wm-profiles': exposure,
      'wm-backup-bucket': backupBucket.name,
    },
    allowStoppingForUpdate: true,
  },
  {
    dependsOn: nat ? [dataDisk, nat] : [dataDisk],
    // The data disk can only be attached to one VM, so the old VM has to go first.
    deleteBeforeReplace: true,
  },
);
