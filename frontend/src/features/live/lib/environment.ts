import type { StateTagTone } from '@/ui';

/** Names that mean the environment real users reach. */
const PRODUCTION = new Set(['production', 'prod', 'prd', 'live']);

/** Names of an environment before production: a test or staging copy of the product. */
const PRE_PRODUCTION = new Set([
  'staging',
  'stage',
  'stg',
  'preprod',
  'pre-prod',
  'pre-production',
  'preproduction',
  'uat',
  'qa',
  'test',
  'testing',
  'dev',
  'development',
  'sandbox',
  'perf',
]);

/**
 * The tone of a live source's environment (cv5 M2): production is `success` (green), an environment before
 * production is `info` (the calm second tone of the state colour key), any other or no name is neutral.
 */
export function environmentTone(environment: string | null | undefined): StateTagTone {
  const name = (environment ?? '').trim().toLowerCase();
  if (PRODUCTION.has(name)) return 'success';
  if (PRE_PRODUCTION.has(name)) return 'info';
  return 'neutral';
}
