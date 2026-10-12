import { collectErrors } from './rowErrors';
import type { Row } from '../types';

/** Total error occurrences (the Errors tab badge): task + metric + trace + analysis buckets. */
export function errorBucketCount(rows: Row[], repeatAggregate: boolean): number {
  let n = 0;
  collectErrors(rows, repeatAggregate).forEach((b) => (n += b.count));
  return n;
}
