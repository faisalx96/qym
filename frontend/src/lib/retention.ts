/**
 * Deleted runs retention in words (C178): the place is 'Deleted runs' and the setting is 'Retention'.
 * 0 days means retention is off, so say that instead of '0 days', which reads as 'deleted at once'.
 */
export function retentionLabel(days: number | null | undefined): string {
  return !days ? 'Off (kept until restored)' : `${days} day${days === 1 ? '' : 's'}`;
}
