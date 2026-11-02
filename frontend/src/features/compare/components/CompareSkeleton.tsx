/** Loading frame (C-state-1): the loaded page's sections at their loaded heights, so nothing moves when the data arrives. */
import { ReportSection, Skeleton } from '@/ui';
import { sectionDomId } from './sectionIds';
import runStyles from './RunCards.module.css';
import styles from './CompareSkeleton.module.css';

export function CompareSkeleton({ runs }: { runs: number }) {
  return (
    <div
      className={styles.frame}
      data-testid="compare-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Loading comparison"
    >
      <div className={styles.nav} aria-hidden />
      <div data-part="report">
        <ReportSection
          id={sectionDomId('runs')}
          part="section-runs"
          title="Runs"
          description="Configuration and status of the compared runs. Remove a run with the cross; at least two stay."
        >
          <div className={runStyles.cards} data-part="run-grid">
            {Array.from({ length: Math.max(2, runs) }, (_, i) => (
              <Skeleton key={i} kind="chart" height="var(--r8-run-h, 242.3px)" label="Loading run" />
            ))}
          </div>
        </ReportSection>
        <ReportSection
          id={sectionDomId('averages')}
          part="section-averages"
          title="Per-run averages"
          description="Each run against the baseline: the change, its 95% noise band, and how many items improved or regressed. Press a count to filter the items."
        >
          <Skeleton kind="chart" height="var(--r8-avg-h, 283px)" label="Loading averages" />
        </ReportSection>
        <ReportSection
          id={sectionDomId('overview')}
          part="section-overview"
          title="Comparison overview"
          description="Pass rates, winners and how many runs got each item right."
        >
          <Skeleton kind="chart" height="var(--r8-ov-h, 321.7px)" label="Loading overview" />
        </ReportSection>
        <ReportSection
          id={sectionDomId('items')}
          part="section-items"
          title="Item-by-item comparison"
          description="Filter and inspect aligned inputs, outputs, scores and review metadata."
        >
          <Skeleton kind="rows" rows={20} rowHeight={54} label="Loading items" className={styles.rows} />
        </ReportSection>
      </div>
    </div>
  );
}
