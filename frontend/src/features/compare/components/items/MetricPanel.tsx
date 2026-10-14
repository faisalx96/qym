/** One run's details for the metric opened on the item: the same data the old per-card expansion showed. */
import { RunTag } from '../RunTag';
import { MetaList } from './OutputCard';
import { useItemsUi } from './ItemsUi';
import styles from './ItemDetail.module.css';
import type { Row } from '@/features/run-detail/types';

export function MetricPanelCell({
  metric,
  row,
  runIndex,
  name,
}: {
  metric: string;
  row: Row;
  runIndex: number;
  name: string;
}) {
  const ui = useItemsUi();
  const meta = (row.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
  return (
    <section
      className={styles.panelCell}
      data-testid="metric-panel-cell"
      aria-label={`${metric} details of ${name}`}
    >
      <header className={styles.panelHead}>
        <span className={styles.panelMetric}>{metric}</span>
        <RunTag index={runIndex} name={name} compact bare />
      </header>
      <MetaList meta={meta} hidden={ui.hiddenFields} />
    </section>
  );
}
