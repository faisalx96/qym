/** Pinned runs status bar: sentence / selection actions, pager, freshness + Last updated, shortcuts hint. */
import type { ReactNode } from 'react';
import { Button, Kbd, Pagination, Text } from '@/ui';
import { formatClock } from '@/lib/format';
import type { Freshness } from '@/api/dashboardTypes';
import { PAGE_SIZE } from './urlState';
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

export function StatusBar({
  left,
  total,
  page,
  onPage,
  updatedAt,
  freshness,
  failed,
  selecting,
  onHelp,
}: {
  left: ReactNode;
  total: number;
  page: number;
  onPage: (p: number) => void;
  updatedAt: Date | null;
  freshness: Freshness | undefined;
  failed?: boolean;
  /** Selection actions are in the left cell: the bar stacks sooner so nothing overlaps. */
  selecting?: boolean;
  onHelp: () => void;
}) {
  const note = freshnessCopy(freshness);
  return (
    <footer
      className={styles.bar}
      data-pinned=""
      data-selecting={selecting ? '' : undefined}
      aria-label="Runs status"
      data-testid="status-bar"
    >
      <div className={styles.left}>{left}</div>
      <div className={styles.center}>
        <Pagination total={total} page={page} pageSize={PAGE_SIZE} noun="runs" onPageChange={onPage} />
      </div>
      <div className={styles.right}>
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
      </div>
    </footer>
  );
}
