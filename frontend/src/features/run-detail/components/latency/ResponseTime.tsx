/** "Response time": the latency distribution beside quality against latency (stacked on a narrow column). */
import { useMemo } from 'react';
import { Subsection } from '@/ui';
import { latencySummary, type LatencyItem } from '../../lib/latencyModel';
import { useRunPage } from '../../RunContext';
import { LatencyDistribution } from './LatencyDistribution';
import { QualityLatency, type QualityMetric } from './QualityLatency';
import styles from './Response.module.css';

export function ResponseTime({ items, metric }: { items: LatencyItem[]; metric: string | null }) {
  const { api, model } = useRunPage();
  const L = useMemo(() => latencySummary(items), [items]);
  const quality = useMemo<QualityMetric | null>(() => {
    const direction = metric ? model.metricDirections[metric] : null;
    if (!metric || !direction || model.metricTypes[metric] === 'numeric') return null;
    return {
      name: metric,
      direction,
      threshold: api.ctx.thresholds[metric] ?? 0.8,
      isBoolean: !!model.metricIsBoolean[metric],
    };
  }, [metric, model.metricDirections, model.metricTypes, model.metricIsBoolean, api.ctx.thresholds]);
  const points = useMemo(
    () => (quality ? items.filter((it) => it.latency > 0 && it.score !== null) : []),
    [items, quality],
  );
  if (!L) return null;
  const showQuality = !!quality && points.length > 1;
  return (
    <Subsection
      id="lt-response"
      title="Response time"
      description="End-to-end latency of each item, and what speed costs in quality."
      className={styles.sub}
    >
      <div className={styles.pair} data-single={showQuality ? undefined : ''}>
        <LatencyDistribution items={items} L={L} />
        {showQuality ? <QualityLatency items={points} metric={quality} /> : null}
      </div>
    </Subsection>
  );
}
