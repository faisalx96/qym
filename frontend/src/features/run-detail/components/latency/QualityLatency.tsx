/**
 * Quality vs latency card (legacy renderQuality / renderScatter): one dot per item for the page metric, the pass
 * threshold line, the median latency line, the fast-and-passing and slow-and-failing zones, the slowest 5% hatched,
 * task errors as open red rings. The metric is the page metric from the sticky nav; the card has no picker.
 */
import { useId } from 'react';
import { Card, ChartTooltipHost, Text, useMarkTip } from '@/ui';
import { passThresholdLabel, type MetricDirection } from '@/lib/metrics';
import { durText, niceStep, quantile, tickLabel, type LatencyItem } from '../../lib/latencyModel';
import { useRunPage } from '../../RunContext';
import { useMeasuredWidth } from '../charts/Charts';
import { TipBody } from './Tip';
import styles from './Response.module.css';

const HEIGHT = 250;
const M = { l: 44, r: 10, t: 10, b: 28 };

export interface QualityMetric {
  name: string;
  direction: Exclude<MetricDirection, null>;
  /** Pass threshold on the 0..1 scale (a boolean metric passes at 0.5 on the plot). */
  threshold: number;
  isBoolean: boolean;
}

function Dot({
  item,
  metric,
  cx,
  cy,
  passes,
  out,
  onOpen,
}: {
  item: LatencyItem;
  metric: string;
  cx: number;
  cy: number;
  passes: boolean;
  out: boolean;
  onOpen: (id: string) => void;
}) {
  const v = item.score ?? 0;
  const { handlers } = useMarkTip(
    <TipBody
      title={item.itemId}
      rows={[
        ['Latency', durText(item.latency)],
        [metric, `${(v * 100).toFixed(1)}%`],
        ['Status', item.error ? <span className={styles.tipBad}>task error</span> : 'completed'],
      ]}
      hint="Click to open the item"
    />,
  );
  return (
    <circle
      className={styles.dot}
      data-outcome={item.error ? 'error' : passes ? 'pass' : 'fail'}
      data-out={out ? '' : undefined}
      cx={cx}
      cy={cy}
      r={4}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
      onClick={() => onOpen(item.itemId)}
    />
  );
}

export function QualityLatency({ items, metric }: { items: LatencyItem[]; metric: QualityMetric }) {
  const { api } = useRunPage();
  const hatchId = useId().replace(/:/g, '');
  const [boxRef, w] = useMeasuredWidth<HTMLDivElement>(480);
  const filter = api.view.filters.latency;
  const h = HEIGHT;
  const minimize = metric.direction === 'minimize';
  const T = metric.isBoolean ? 0.5 : metric.threshold;
  const passes = (v: number) => (metric.isBoolean ? v >= 0.5 : minimize ? v <= T : v >= T);
  const qs = items.map((it) => it.score ?? 0);
  const y0 = metric.isBoolean ? 0 : Math.max(0, Math.min(T - 0.05, Math.floor(Math.min(...qs) * 20) / 20));
  const y1 = metric.isBoolean ? 1 : Math.min(1, Math.max(T + 0.05, Math.ceil(Math.max(...qs) * 20) / 20));
  const latMax = Math.max(...items.map((it) => it.latency));
  // About one x label per 64px of plot, seven at most.
  const xStep = niceStep(latMax, Math.max(2, Math.min(7, Math.floor((w - M.l - M.r) / 64))));
  const x1 = Math.max(xStep, Math.ceil(latMax / xStep) * xStep);
  const X = (v: number) => M.l + ((w - M.l - M.r) * v) / x1;
  // A lower-is-better metric plots its best values at the top, so the fast and passing corner is always top left.
  const Y = (v: number) => {
    const f = (v - y0) / (y1 - y0 || 1);
    return M.t + (h - M.t - M.b) * (minimize ? f : 1 - f);
  };
  const top = M.t;
  const bottom = h - M.b;
  const yT = Y(T);
  const sorted = items.map((it) => it.latency).sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const yStep = [0.05, 0.1, 0.2, 0.25, 0.5].find((st) => (y1 - y0) / st <= 7) ?? 0.5;
  const yTicks: number[] = [];
  for (let v = Math.ceil(y0 / yStep - 1e-9) * yStep; v <= y1 + 1e-9; v += yStep) yTicks.push(v);
  const xTicks: number[] = [];
  for (let v = 0; v <= x1 + 1e-9; v += xStep) xTicks.push(v);
  const passLabel = metric.isBoolean
    ? 'Pass = true'
    : `Pass ${passThresholdLabel(metric.threshold, metric.direction)}`;
  return (
    <Card as="section" className={styles.box} aria-label="Quality versus latency">
      <div className={styles.inner}>
        <div className={styles.head}>
          <div className={styles.titles}>
            <Text variant="md" weight={600} as="h4" className={styles.title}>
              Quality vs latency
            </Text>
            <Text variant="sm" tone="muted" as="p" className={styles.desc}>
              One dot per item.
            </Text>
          </div>
          <span className={styles.metricName} title="The page metric (set in the section nav)">
            {metric.name}
          </span>
        </div>
        <ul className={styles.legend} aria-label="Legend">
          <li>
            <i className={styles.swZone} data-zone="good" aria-hidden="true" />
            Fast and passing
          </li>
          <li>
            <i className={styles.swZone} data-zone="bad" aria-hidden="true" />
            Slow and failing
          </li>
          <li>
            <i className={styles.swPass} aria-hidden="true" />
            {passLabel}
          </li>
          <li>
            <i className={styles.swLine} aria-hidden="true" />
            Median latency
          </li>
          <li>
            <i className={styles.swRing} aria-hidden="true" />
            Task error
          </li>
        </ul>
        <ChartTooltipHost>
          <div ref={boxRef} className={styles.scatter}>
            <svg
              width={w}
              height={h}
              viewBox={`0 0 ${w} ${h}`}
              role="img"
              aria-label={`${metric.name} against latency, one dot per item, ${items.length} items`}
            >
              <defs>
                <pattern
                  id={hatchId}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line className={styles.hatch} x1="0" y1="0" x2="0" y2="6" />
                </pattern>
              </defs>
              <rect
                className={styles.zoneGood}
                x={X(0)}
                y={top}
                width={Math.max(0, X(p50) - X(0))}
                height={Math.max(0, yT - top)}
              />
              <rect
                className={styles.zoneBad}
                x={X(p50)}
                y={yT}
                width={Math.max(0, X(x1) - X(p50))}
                height={Math.max(0, bottom - yT)}
              />
              {p95 < x1 ? (
                <rect
                  x={X(p95)}
                  y={top}
                  width={Math.max(0, X(x1) - X(p95))}
                  height={bottom - top}
                  fill={`url(#${hatchId})`}
                />
              ) : null}
              <text className={styles.zoneLabel} data-zone="good" x={X(0) + 8} y={top + 14}>
                FAST · PASSING
              </text>
              <text
                className={styles.zoneLabel}
                data-zone="bad"
                x={X(x1) - 8}
                y={bottom - 8}
                textAnchor="end"
              >
                SLOW · FAILING
              </text>
              {yTicks.map((v) => (
                <g key={v}>
                  <line className={styles.gridLine} x1={M.l} x2={w - M.r} y1={Y(v)} y2={Y(v)} />
                  <text className={styles.tick} x={M.l - 8} y={Y(v) + 4} textAnchor="end">
                    {Math.round(v * 100)}%
                  </text>
                </g>
              ))}
              {xTicks.map((v) => (
                <text key={v} className={styles.tick} x={X(v)} y={h - 8} textAnchor="middle">
                  {tickLabel(v)}
                </text>
              ))}
              <line className={styles.passLine} x1={M.l} x2={w - M.r} y1={yT} y2={yT} />
              <line className={styles.medianLine} x1={X(p50)} x2={X(p50)} y1={top} y2={bottom} />
              {items.map((it) => (
                <Dot
                  key={it.itemId}
                  item={it}
                  metric={metric.name}
                  cx={X(it.latency)}
                  cy={Y(it.score ?? 0)}
                  passes={passes(it.score ?? 0)}
                  out={!!filter && (it.latency < filter.min || it.latency >= filter.max)}
                  onOpen={(id) => api.setItemParam(id)}
                />
              ))}
            </svg>
          </div>
        </ChartTooltipHost>
      </div>
    </Card>
  );
}
