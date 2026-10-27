/**
 * Skeletons of the report sections while the rows are on their way (staged loading, perf round 6): each one is
 * sized from the run summary so the section keeps its height when the content arrives (CLS under 0.02). The Overview
 * skeleton reuses the Overview's own grid classes, so its columns and rows are those of the real cards.
 */
import { metricTypeFromSpec } from '@/lib/metrics';
import { ReportSection, Skeleton } from '@/ui';
import { useRunPage } from '../RunContext';
import panels from './panels/Panels.module.css';
import items from './ItemsSection.module.css';
import styles from './StageSkeletons.module.css';

/** Measured card heights at 1440, 1000 and 700 px (score card, box-plot card). */
const SCORE_CARD_H = 278;
const NUMERIC_CARD_H = 210;

function Cards({ count, height }: { count: number; height: number }) {
  if (count <= 0) return null;
  return (
    <div className={panels.chartGrid} data-count={count}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.block} style={{ height }} />
      ))}
    </div>
  );
}

export function OverviewSkeleton() {
  const { payload } = useRunPage();
  const names = payload.run.metric_names ?? payload.snapshot.metric_names ?? [];
  const specs = payload.run.metric_specs ?? payload.snapshot.metric_specs ?? {};
  const numeric = names.filter((n) => metricTypeFromSpec(specs[n]) === 'numeric').length;
  // box-plot cards share a second grid with the per-item tokens card (trace stats) when the run has them
  const boxes = numeric + (payload.run.trace_stats?.avg_tokens != null ? 1 : 0);
  return (
    <div className={panels.overviewStack} role="status" aria-label="Loading overview" aria-busy="true">
      <Cards count={names.length - numeric} height={SCORE_CARD_H} />
      <Cards count={boxes} height={NUMERIC_CARD_H} />
    </div>
  );
}

/** A section body that is one block of a known height (the card or table that will replace it). */
export function BlockSkeleton({ height, label }: { height: number; label: string }) {
  return <Skeleton kind="chart" height={height} label={label} />;
}

/** The Errors body is one short line when the run has none, a table of buckets otherwise. */
export function ErrorsSkeleton() {
  const { payload } = useRunPage();
  const failed = (payload.run.error_count ?? 0) > 0;
  return <BlockSkeleton height={failed ? 308 : 20} label="Loading errors" />;
}

/** The Items section's frame while its rows (or its chunk) are on the way: header, the filter bar's row, the first rows. */
export function ItemsSkeleton() {
  const { payload } = useRunPage();
  const total = payload.snapshot.rows_total ?? 0;
  return (
    <ReportSection
      id="run-items"
      title="Items"
      description="Every input, outcome and metric. Filters apply to the table and to every section above."
    >
      <div className={items.section}>
        <Skeleton kind="chart" height={56} label="Loading filters" />
        <Skeleton kind="chart" height={Math.max(1, Math.min(total, 12)) * 52 + 40} label="Loading items" />
      </div>
    </ReportSection>
  );
}
