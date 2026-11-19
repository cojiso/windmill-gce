import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import { appName } from './config';

/**
 * The Google APIs the rest of the stack needs. Every other resource waits for these (see the end of this file), so the first pulumi up works on a fresh project.
 * Storage is listed for completeness: it is on by default, and the state bucket already needed it before Pulumi ran.
 */
const apiNames = [
  'compute.googleapis.com',
  'iam.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'storage.googleapis.com',
];

export const apis = apiNames.map(
  (service) =>
    new gcp.projects.Service(`${appName}-${service.split('.')[0]}`, {
      service,
      // pulumi destroy must not turn an API off: other things in the project may use it.
      disableOnDestroy: false,
      disableDependentServices: false,
    }),
);

// Every resource registered after this module loads waits for the APIs. index.ts imports it first, before the modules that create resources.
// The older in-process transformation on purpose: with registerResourceTransform (@pulumi/pulumi 3.274), the dependsOn it returns is silently dropped.
pulumi.runtime.registerStackTransformation((args) =>
  args.type === 'gcp:projects/service:Service'
    ? undefined
    : { props: args.props, opts: pulumi.mergeOptions(args.opts, { dependsOn: apis }) },
);
