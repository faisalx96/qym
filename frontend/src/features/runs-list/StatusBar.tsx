/** Runs footer content: freshness note, "Last updated" and the shortcuts button (shown in DataTable.Footer). */
import { Button, Kbd, Text } from '@/ui';
import { formatClock } from '@/lib/format';
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
  onHelp,
}: {
  updatedAt: Date | null;
  freshness: Freshness | undefined;
  failed?: boolean;
  onHelp: () => void;
}) {
  const note = freshnessCopy(freshness);
  return (
    <>
      <Text
        variant="sm"
        tone="muted"
        as="span"
        className={styles.updated}
        role={note || failed ? 'status' : undefined}
      >
        {note ?? (
          <>
            Last updated <span className={styles.mono}>{updatedAt ? formatClock(updatedAt) : '—'}</span>
            {failed ? ' · refresh failed' : ''}
          </>
        )}
      </Text>
      <Button variant="ghost" onPress={onHelp} aria-label="Keyboard shortcuts">
        <Kbd>?</Kbd> Shortcuts
      </Button>
    </>
  );
}
