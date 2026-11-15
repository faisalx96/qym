/** Runs footer content: freshness note, "Last updated" and the shortcuts button (shown in DataTable.Footer). */
import { Button, Kbd, Text } from '@/ui';
import { formatAgo } from '@/lib/dates';
import type { Freshness } from '@/api/dashboardTypes';
import styles from './StatusBar.module.css';

export function freshnessCopy(f: Freshness | undefined): string | null {
  if (!f) return null;
  if (f.failed_partitions > 0) return 'Some summaries need attention · showing available results';
  if (f.updating) {
    const n = Number(f.unpublished_runs || 0);
    return n > 0 ? `${n} runs preparing · totals cover ready runs` : 'Updating summaries…';
  }
  return null;
}

export function FooterTrailing({
  updatedAt,
  freshness,
  failed,
  loading,
  onHelp,
}: {
  updatedAt: Date | null;
  freshness: Freshness | undefined;
  failed?: boolean;
  loading?: boolean;
  /** Absent in card mode (C224): no Shortcuts button. */
  onHelp?: () => void;
}) {
  const note = freshnessCopy(freshness);
  return (
    <>
      <Text
        variant="sm"
        tone="muted"
        as="span"
        className={styles.updated}
        role={note || failed || loading ? 'status' : undefined}
      >
        {note ??
          (loading ? (
            'Loading runs…'
          ) : (
            <>
              Last updated {updatedAt ? formatAgo(updatedAt) : '—'}
              {failed ? ' · refresh failed · showing runs from an earlier refresh' : ''}
            </>
          ))}
      </Text>
      {onHelp ? (
        <Button variant="neutral" onPress={onHelp} aria-label="Keyboard shortcuts">
          <Kbd>?</Kbd> Shortcuts
        </Button>
      ) : null}
    </>
  );
}
