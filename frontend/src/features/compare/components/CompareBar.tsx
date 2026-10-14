/** The sticky bar (44px): jump nav, then metric and baseline selects and the filtered item count. */
import { Button, Icon, Popover, Text } from '@/ui';
import { useMediaQuery } from '@/features/shell';
import { useCompare } from '../CompareContext';
import { ReportNav } from './ReportSections';
import { BaselineSelect, MetricSelect } from './SelectionBar';
import styles from './CompareBar.module.css';

const INLINE_QUERY = '(min-width: 1200px)';

function Controls({ labelled }: { labelled?: boolean }) {
  const { cohorts } = useCompare();
  return (
    <>
      {labelled ? <span className={styles.label}>Metric</span> : null}
      <MetricSelect />
      {cohorts ? null : (
        <>
          <span className={styles.label}>Baseline</span>
          <BaselineSelect />
        </>
      )}
    </>
  );
}

export function CompareBar() {
  const { items, model } = useCompare();
  const inline = useMediaQuery(INLINE_QUERY);
  return (
    <div className={styles.bar} data-compare-sticky="">
      <div className={styles.nav}>
        <ReportNav />
      </div>
      <div className={styles.controls}>
        {inline ? (
          <Controls />
        ) : (
          <Popover
            label="View options"
            placement="bottom end"
            trigger={
              <Button size="sm" variant="neutral" icon={<Icon name="settings" size={14} />}>
                View
              </Button>
            }
          >
            <div className={styles.pop}>
              <Controls labelled />
            </div>
          </Popover>
        )}
        <Text variant="sm" tone="muted" className={styles.count} data-testid="bar-count">
          {items.length} of {model.itemIds.length}
        </Text>
      </div>
    </div>
  );
}
