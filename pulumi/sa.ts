import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { appName, projectId } from './config';

/** The VM's service account: writes logs and metrics. Its access to the backup bucket is granted in storage.ts. */
export const vmSa = new gcp.serviceaccount.Account(`${appName}-vm-sa`, {
  accountId: `${appName}-vm`,
  displayName: `${appName} VM`,
});

export const vmRoles = ['roles/logging.logWriter', 'roles/monitoring.metricWriter'].map(
  (role) =>
    new gcp.projects.IAMMember(`${appName}-${role.split('/')[1]}`, {
      project: projectId,
      role,
      member: pulumi.interpolate`serviceAccount:${vmSa.email}`,
    }),
);
