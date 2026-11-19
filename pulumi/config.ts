import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config('gcp');

/** Like require, but also refuses the __CHANGE_ME__ placeholder that Pulumi.prod.yaml ships with. */
const requireSet = (cfg: pulumi.Config, key: string) => {
  const value = cfg.require(key);
  if (value === '__CHANGE_ME__') {
    throw new Error(`set ${cfg.name}:${key} in Pulumi.${pulumi.getStack()}.yaml`);
  }
  return value;
};

export const projectId = requireSet(gcpConfig, 'project');
export const region = gcpConfig.require('region');
export const zone = gcpConfig.require('zone');

/** Prefix for resource names. Change it to run two instances in one project. */
export const appName = config.get('appName') ?? 'windmill';

/** Host name Windmill is served on, without https://. */
export const domain = requireSet(config, 'domain');

/**
 * Your copy of this repository. The VM clones it and pulls it every night.
 * - Public: the HTTPS URL, e.g. https://github.com/you/windmill-gce.git
 * - Private: the SSH URL, e.g. git@github.com:you/windmill-gce.git. The VM then makes a deploy key and waits until you add it on GitHub.
 */
export const repoUrl = requireSet(config, 'repoUrl');
export const repoBranch = config.get('repoBranch') ?? 'main';

/**
 * How the outside world reaches Windmill.
 * - caddy: a static public IP with ports 80/443 open; Caddy gets the certificate.
 * - tunnel: no public IP and no inbound ports; Cloudflare Tunnel connects outwards. Set CLOUDFLARE_TUNNEL_TOKEN in .env on the VM.
 */
export const exposure = config.get('exposure') ?? 'caddy';
if (exposure !== 'caddy' && exposure !== 'tunnel') {
  throw new Error(`exposure must be "caddy" or "tunnel", got "${exposure}"`);
}

/** e2-small (2 GB) is enough for light jobs. Changing it stops and restarts the VM. */
export const machineType = config.get('machineType') ?? 'e2-small';

/** OS and settings only. */
export const bootDiskGb = config.getNumber('bootDiskGb') ?? 10;
/** Docker, Postgres, logs, caches and swap. Can be increased later without downtime: the file system grows at the next boot, or at once with resize2fs (see README). */
export const dataDiskGb = config.getNumber('dataDiskGb') ?? 20;

/** Where SSH may come from. The default is Google's IAP range only, so SSH goes through `gcloud compute ssh --tunnel-through-iap`. */
export const sshSourceRanges = config.getObject<string[]>('sshSourceRanges') ?? ['35.235.240.0/20'];

/** Alerts go to this address. Pulumi creates the email channel; Google sends a confirmation mail first. */
export const alertEmail = config.get('alertEmail');
/** Or reuse an existing channel (Slack, PagerDuty...): projects/<project>/notificationChannels/<id>. */
export const notificationChannelId = config.get('notificationChannelId');

export const diskAlertPct = config.getNumber('diskAlertPct') ?? 85;
export const memoryAlertPct = config.getNumber('memoryAlertPct') ?? 85;

export const snapshotRetentionDays = config.getNumber('snapshotRetentionDays') ?? 7;
export const backupRetentionDays = config.getNumber('backupRetentionDays') ?? 30;
