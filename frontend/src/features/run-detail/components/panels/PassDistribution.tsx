/** "{metric} by pass" (round 3 P7): one box row per completed pass on a shared axis; a row opens that pass. */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tag } from '@/ui';
import { boxAxis } from '../../lib/boxAxis';
import { boxFormatter, boxTickFormatter, type BoxKind } from '../../lib/boxFormat';
import { boxStats, type BoxStats } from '../../lib/boxStats';
import { axisPosition } from '../../lib/boxAxis';
import { useRunPage } from '../../RunContext';
import type { PassSummary } from '../../types';
import { BoxLegend, BoxTrack } from '../charts/BoxPlot';
import styles from './Repeat.module.css';

/** The per-pass values of one metric over the filtered items (`row.pass_scores[metric][pass - 1]`). */
export function passValues(
  rows: Array<{ pass_scores?: Record<string, Array<unknown>> | null }>,
  metric: string,
  pass: number,
): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = row.pass_scores?.[metric]?.[pass - 1];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** True when at least one row carries per-pass scores for the metric (a compact payload that lacks them hides the card). */
export function hasPassScores(
  rows: Array<{ pass_scores?: Record<string, Array<unknown>> | null }>,
  metric: string,
): boolean {
  return rows.some((r) => Array.isArray(r.pass_scores?.[metric]));
}

export function PassDistribution({
  metric,
  passes,
  kind,
}: {
  metric: string;
  passes: PassSummary[];
  kind: BoxKind;
}) {
  const { items, basePath } = useRunPage();
  const navigate = useNavigate();
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const perPass = useMemo(
    () =>
      passes.map((p) => ({ pass: p.pass_number, stats: boxStats(passValues(rows, metric, p.pass_number)) })),
    [passes, rows, metric],
  );
  const all = useMemo(
    () => boxStats(perPass.flatMap((p) => passValues(rows, metric, p.pass))),
    [perPass, rows, metric],
  );
  const axis = useMemo(
    () => boxAxis(all, kind === 'percent' ? { fixed: [0, 1], maxTicks: 5 } : { values: [] }),
    [all, kind],
  );
  if (passes.length < 2 || !hasPassScores(rows, metric) || perPass.every((p) => !p.stats.n)) return null;
  const fmt = boxFormatter(kind);
  const tick = boxTickFormatter(kind);
  const x = (v: number) => axisPosition(v, axis.domain);
  const each = Math.max(...perPass.map((p) => p.stats.n));
  return (
    <Card
      as="section"
      aria-label={`${metric} by pass`}
      className={styles.passDist}
      header={
        <div className={styles.passHead}>
          <span className={styles.title}>{metric} by pass</span>
          <Tag kind="count">
            {passes.length} passes · {each} items each
          </Tag>
        </div>
      }
    >
      <div className={styles.passRows} role="group" aria-label={`${metric} distribution by pass`}>
        {perPass.map(({ pass, stats }: { pass: number; stats: BoxStats }) => (
          <button
            key={pass}
            type="button"
            className={styles.passRow}
            data-pass={pass}
            aria-label={`Pass ${pass}: median ${fmt(stats.median)}, mean ${fmt(stats.mean)}, middle half ${fmt(stats.p25)} to ${fmt(stats.p75)}, open this pass`}
            onClick={() => navigate(`${basePath}?pass=${pass}`)}
          >
            <span className={styles.passTag}>
              <Tag kind="count">Pass {pass}</Tag>
            </span>
            {stats.n ? <BoxTrack stats={stats} x={x} /> : <span />}
            <span
              className={styles.passMed}
              aria-hidden="true"
              data-text={stats.n ? fmt(stats.median) : '—'}
            />
          </button>
        ))}
        <div className={styles.passAxis} aria-hidden="true">
          {axis.ticks.map((t) => (
            <span key={t} style={{ '--x': x(t) } as React.CSSProperties}>
              {tick(t)}
            </span>
          ))}
        </div>
      </div>
      <BoxLegend />
    </Card>
  );
}
