/** "{metric} by pass" (round 3 P7): one box row per completed pass on a shared axis; a row opens that pass. */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardTitle, Tag } from '@/ui';
import { boxAxis, type BoxAxis } from '../../lib/boxAxis';
import { curveAxis } from '../../lib/curveAxis';
import { boxFormatter, boxTickFormatter, type BoxKind } from '../../lib/boxFormat';
import { boxStats, type BoxStats } from '../../lib/boxStats';
import { axisPosition } from '../../lib/boxAxis';
import { useRunPage } from '../../RunContext';
import type { PassSummary } from '../../types';
import { BoxKey, BoxTrack } from '../charts/BoxPlot';
import { boxTone } from '../../lib/boxTone';
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
  const { items, basePath, api } = useRunPage();
  const direction = api.ctx.model.metricDirections[metric] ?? null;
  const type = api.ctx.model.metricTypes[metric];
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
  // cv4 Y7: a score axis fits the whiskers of the passes with a margin (curveAxis, as the attempts curve), so the
  // boxes do not sit in one half of a fixed 0 to 100% axis; a dot beyond it rests on the edge.
  const axis = useMemo<BoxAxis>(() => {
    if (kind !== 'percent') return boxAxis(all, { values: [] });
    const fit = curveAxis(
      perPass.flatMap((p) => (p.stats.n ? [p.stats.p5, p.stats.p95] : [])),
      { fullAt: 0.9 },
    );
    return { ...fit, clipped: false, beyond: 0 };
  }, [all, kind, perPass]);
  if (passes.length < 2 || !hasPassScores(rows, metric) || perPass.every((p) => !p.stats.n)) return null;
  const fmt = boxFormatter(kind);
  const tick = boxTickFormatter(kind);
  const x = (v: number) => axisPosition(v, axis.domain);
  const each = Math.max(...perPass.map((p) => p.stats.n));
  return (
    <Card as="section" aria-label={`${metric} by pass`} className={styles.passDist}>
      {/* cv4 X16: the card header recipe of C2-3 (CardTitle in the body, no rule under it) */}
      <CardTitle
        as="h4"
        className={styles.passHead}
        title={`${metric} by pass`}
        aside={
          <Tag kind="count">
            {passes.length} passes · {each} items each
          </Tag>
        }
      />
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
            {stats.n ? (
              <BoxTrack stats={stats} x={x} tone={boxTone(stats.median, type, direction)} />
            ) : (
              <span />
            )}
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
      <BoxKey />
    </Card>
  );
}
