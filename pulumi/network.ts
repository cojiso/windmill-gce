import * as gcp from '@pulumi/gcp';
import { appName, exposure, region, sshSourceRanges } from './config';

/** The project's default network. Swap in your own VPC here if you have one. */
export const networkName = 'default';
export const networkTag = `${appName}-vm`;

/** SSH from the IAP range only, unless sshSourceRanges says otherwise. */
export const sshFirewall = new gcp.compute.Firewall(`${appName}-allow-ssh`, {
  network: networkName,
  direction: 'INGRESS',
  sourceRanges: sshSourceRanges,
  targetTags: [networkTag],
  allows: [{ protocol: 'tcp', ports: ['22'] }],
});

/**
 * caddy: a static IP, so the DNS record survives a VM rebuild, and 80/443 open to everyone (Let's Encrypt must reach port 80 or 443 too).
 * tunnel: neither. The VM reaches the internet through Cloud NAT instead.
 */
export const address =
  exposure === 'caddy' ? new gcp.compute.Address(`${appName}-ip`, { region }) : undefined;

export const webFirewall =
  exposure === 'caddy'
    ? new gcp.compute.Firewall(`${appName}-allow-web`, {
        network: networkName,
        direction: 'INGRESS',
        sourceRanges: ['0.0.0.0/0'],
        targetTags: [networkTag],
        allows: [
          { protocol: 'tcp', ports: ['80', '443'] },
          { protocol: 'udp', ports: ['443'] },
        ],
      })
    : undefined;

const router =
  exposure === 'tunnel'
    ? new gcp.compute.Router(`${appName}-router`, { network: networkName, region })
    : undefined;

export const nat = router
  ? new gcp.compute.RouterNat(`${appName}-nat`, {
      router: router.name,
      region,
      natIpAllocateOption: 'AUTO_ONLY',
      sourceSubnetworkIpRangesToNat: 'ALL_SUBNETWORKS_ALL_IP_RANGES',
      logConfig: { enable: true, filter: 'ERRORS_ONLY' },
    })
  : undefined;
