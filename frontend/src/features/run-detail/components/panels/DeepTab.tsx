/**
 * Deep analysis (brief 04 J3). Round 10: "Between metrics", the correlation matrix beside the relationship scatter
 * (the first qym's pair, its teal-and-purple scale, X and Y in the scatter's head and the legend on its own row); and,
 * for a repeat run, "Across passes", the page metric's score spread in each pass (moved here from Repeat).
 */
import { useMemo, useRef, useState } from 'react';
import { usePassesQuery } from '@/api/runs';
import { Select, Subsection } from '@/ui';
import { useRunPage } from '../../RunContext';
import { PassDistribution } from './PassDistribution';
import { rowPassesFor, rowScoreFor } from '../../lib/filterRules';
import { correlationMatrix, strongestPair } from '../../lib/overviewModel';
import { Scatter, ScatterLegend, useMeasuredWidth } from '../charts/Charts';
import { ChartCard } from '../charts/ChartCard';
import { MATRIX_NUMBER_MIN, matrixCellSide } from '../charts/chartLabels';
import chart from '../charts/Charts.module.css';
import styles from './Panels.module.css';

/**
 * A heatmap of strength only (C167, owner note "we still need some sort of heatmap"): one `--chart-1` ramp by |r| on a
 * fixed 0 to 1 scale. Strength is neither good nor bad, and teal and purple are not data; the sign is in the number.
 */
const RAMP_MIN = 4;
const RAMP_MAX = 48;
export function correlationTone(r: number | null): string | undefined {
  if (r === null) return undefined;
  const a = Math.min(1, Math.abs(r));
  return `color-mix(in srgb, var(--chart-1) ${Math.round(RAMP_MIN + a * (RAMP_MAX - RAMP_MIN))}%, var(--bg-elevated))`;
}

/** +0.20, −0.15 (a true minus), 0.00. */
export function signedR(r: number): string {
  const v = r.toFixed(2);
  if (Number(v) === 0) return '0.00';
  return r > 0 ? `+${v}` : `\u2212${v.slice(1)}`;
}

export function DeepTab() {
  const { items, api, model, setItem, runId } = useDeep();
  const repeat = model.isRepeat && !model.viewPass;
  const passes = usePassesQuery(runId, repeat);
  const donePasses = (passes.data?.passes ?? []).filter((p) => p.status !== 'pending' && !p.queued);
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const matrix = useMemo(() => correlationMatrix(api.ctx, rows), [api.ctx, rows]);
  const [pair, setPair] = useState<[number, number] | null>(null);
  const relationRef = useRef<HTMLDivElement>(null);
  const names = matrix.metrics;
  const [xi, yi] = pair ?? strongestPair(matrix) ?? [0, 0];
  // The dots carry the same pass / fail tone as the quality-versus-latency scatter: the analysis metric decides.
  const metric = api.selectedMetric;
  const outcomes = useMemo(() => {
    const out = new Map<string, 'pass' | 'fail' | null>();
    const idx = metric ? model.metricNames.indexOf(metric) : -1;
    if (idx < 0 || !metric) return out;
    for (const { row } of items) {
      const passed = rowPassesFor(api.ctx, metric, rowScoreFor(api.ctx, row, idx, metric));
      out.set(row.item_id, passed === null ? null : passed ? 'pass' : 'fail');
    }
    return out;
  }, [items, metric, model.metricNames, api.ctx]);
  const points = useMemo(
    () =>
      matrix.points
        .filter((p) => p.scores[xi] != null && p.scores[yi] != null)
        .map((p) => ({
          id: p.itemId,
          x: p.scores[xi] as number,
          y: p.scores[yi] as number,
          outcome: outcomes.get(p.itemId) ?? null,
        })),
    [matrix, xi, yi, outcomes],
  );
  const r = matrix.r[xi]?.[yi];
  const opts = names.map((n, i) => ({ key: String(i), label: n }));
  const unitScale = [xi, yi].every((i) => model.metricTypes[names[i] ?? ''] !== 'numeric');
  const spread =
    repeat && metric && !model.metricIsBoolean[metric] && donePasses.length > 1 ? (
      <PassDistribution
        metric={metric}
        passes={donePasses}
        kind={model.metricTypes[metric] === 'numeric' ? 'numeric' : 'percent'}
      />
    ) : null;
  return (
    <div className={styles.deepRoot}>
      {names.length < 2 ? (
        <p className={styles.note}>Correlation needs at least two metrics.</p>
      ) : (
        <Subsection
          title="Between metrics"
          description="How the metric results relate across the same items."
        >
          <div className={styles.deepPair}>
            <ChartCard
              title="Metric correlation"
              slot={false}
              intro={
                <p className={styles.note}>
                  Pearson r across matched item scores. Select a cell to plot the pair.
                </p>
              }
            >
              <CorrelationMatrix
                names={names}
                r={matrix.r}
                selected={[xi, yi]}
                onPick={(j, i) => {
                  setPair([j, i]);
                  requestAnimationFrame(() =>
                    relationRef.current?.scrollIntoView({
                      block: 'nearest',
                      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
                    }),
                  );
                }}
              />
            </ChartCard>
            <div ref={relationRef} className={styles.deepCell}>
              <ChartCard
                title="Metric relationship"
                slot={false}
                controls={
                  <span className={styles.controls}>
                    <span className={styles.axisPick} aria-hidden="true">
                      X
                    </span>
                    <Select
                      label="X"
                      hideLabel
                      items={opts}
                      value={String(xi)}
                      onChange={(k) => k !== null && setPair([Number(k), yi])}
                      width="15ch"
                    />
                    <span className={styles.axisPick} aria-hidden="true">
                      Y
                    </span>
                    <Select
                      label="Y"
                      hideLabel
                      items={opts}
                      value={String(yi)}
                      onChange={(k) => k !== null && setPair([xi, Number(k)])}
                      width="15ch"
                    />
                    <span className={styles.rValue}>
                      r <b>{r === null || r === undefined ? '—' : signedR(r)}</b>
                    </span>
                  </span>
                }
                intro={
                  <div className={styles.relationIntro}>
                    <p className={styles.note}>
                      {names[xi]} versus {names[yi]}, one dot per item.
                    </p>
                    <ScatterLegend points={points} />
                  </div>
                }
              >
                <Scatter
                  fit
                  points={points}
                  xLabel={names[xi] ?? ''}
                  yLabel={names[yi] ?? ''}
                  onPick={setItem}
                  fmt={
                    unitScale
                      ? (v) => `${Math.round(v * 100)}%`
                      : (v) =>
                          Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)
                  }
                />
              </ChartCard>
            </div>
          </div>
        </Subsection>
      )}
      {spread ? (
        <Subsection
          title="Across passes"
          description={`How the ${metric} scores spread in each pass. Select a pass to open it.`}
        >
          {spread}
        </Subsection>
      ) : null}
    </div>
  );
}

function CorrelationMatrix({
  names,
  r,
  selected,
  onPick,
}: {
  names: string[];
  r: Array<Array<number | null>>;
  selected: [number, number];
  onPick: (x: number, y: number) => void;
}) {
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>(600);
  const side = matrixCellSide(W, names.length);
  const label = 120;
  // round 5 R4-1: the grid fills the card body; cells are as wide as their column (at least 20px) and `side` high
  const colWidth = (W - label - 2 * names.length) / names.length;
  const minWidth = label + names.length * 22;
  return (
    <div ref={boxRef} className={chart.matrixBox} data-testid="correlation-matrix">
      <div
        className={styles.matrix}
        style={{
          gridTemplateColumns: `${label}px repeat(${names.length}, minmax(20px, 1fr))`,
          width: '100%',
          minWidth,
        }}
        role="grid"
        aria-label="Pearson correlation matrix"
      >
        <div role="row" style={{ display: 'contents' }}>
          <span role="presentation" />
          {names.map((n) => (
            <span key={n} role="columnheader" className={chart.matrixColHead} title={n}>
              <span className={chart.matrixColText}>{n}</span>
            </span>
          ))}
        </div>
        {names.map((rowName, i) => (
          <div key={rowName} role="row" style={{ display: 'contents' }}>
            <span role="rowheader" className={styles.matrixHead} title={rowName}>
              {rowName}
            </span>
            {names.map((colName, j) => {
              const v = r[i]?.[j] ?? null;
              if (i === j)
                return (
                  <span role="gridcell" key={colName} aria-label={`${rowName} versus itself`}>
                    <span
                      className={styles.matrixSelf}
                      style={{ height: side }}
                      data-testid="matrix-diagonal"
                    />
                  </span>
                );
              return (
                <span role="gridcell" key={colName}>
                  <button
                    type="button"
                    className={chart.matrixCell}
                    style={{ width: '100%', height: side, background: correlationTone(v) }}
                    data-empty={v === null ? '' : undefined}
                    aria-label={`${rowName} versus ${colName}: ${v === null ? 'not enough data' : signedR(v)}`}
                    aria-pressed={i === selected[0] && j === selected[1]}
                    onClick={() => onPick(j, i)}
                  >
                    {v === null ? '–' : colWidth >= MATRIX_NUMBER_MIN ? signedR(v) : null}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className={styles.rampKey} data-testid="correlation-key">
        <span>|r|</span>
        <span className={styles.rampScale}>
          <span
            className={styles.rampBar}
            style={{ background: `linear-gradient(to right, ${correlationTone(0)}, ${correlationTone(1)})` }}
            aria-hidden="true"
          />
          <span className={styles.rampTicks} aria-hidden="true">
            <span>0</span>
            <span>0.5</span>
            <span>1</span>
          </span>
        </span>
        <span>More colour, stronger correlation. The sign is in the number.</span>
      </div>
    </div>
  );
}

function useDeep() {
  const page = useRunPage();
  return { ...page, setItem: (id: string) => page.api.setItemParam(id) };
}
