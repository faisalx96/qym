/** Category cards (legacy view): a card per metadata value, a row per run with a run-coloured bar and a tick at the baseline average. */
import type { CSSProperties } from 'react';
import { formatLatency, formatMetricValue, metricBand } from '@/lib/metrics';
import { runSeries, useCompare } from '../../CompareContext';
import { formatBand, formatDelta } from '../../lib/baseline';
import { categoryDelta, type CategoryGroup } from '../../lib/breakdown';
import { columnName } from '../../lib/columnName';
import { RunTag, useRunMark } from '../RunTag';
import styles from './CategoryCards.module.css';

function RunRow({
  index,
  name,
  title,
  score,
  latency,
  isBase,
  type,
  direction,
  max,
  marker,
  change,
  changeTitle,
  tone,
}: {
  index: number;
  name: string;
  title: string;
  score: number | null;
  latency: number | null;
  isBase: boolean;
  type: string;
  direction: 'maximize' | 'minimize' | null;
  max: number | undefined;
  marker: number | null;
  change: string;
  changeTitle?: string;
  tone: 'base' | 'up' | 'down' | 'flat';
}) {
  const mark = useRunMark(index);
  const scale = max ?? 1;
  const pct = (v: number | null) => `${Math.max(0, Math.min(100, ((v ?? 0) / scale) * 100))}%`;
  return (
    <li
      className={styles.row}
      data-testid="category-run"
      data-part="category-run-row"
      style={{ '--run': `var(--chart-${runSeries(index)})` } as CSSProperties}
      {...mark}
    >
      <RunTag index={index} name={name} title={title} baseline={false} compact bare />
      <span className={styles.num} data-band={metricBand(score, type as 'score', direction) ?? undefined}>
        {score === null ? '—' : formatMetricValue(score, type, 0)}
      </span>
      <span className={styles.muted}>{latency === null ? '' : formatLatency(latency)}</span>
      <span className={styles.change} data-tone={tone} title={changeTitle}>
        {isBase ? 'Baseline' : change}
      </span>
      <span className={styles.track} data-part="category-track" aria-hidden>
        <span className={styles.fill} style={{ inlineSize: pct(score) }} />
        {!isBase && marker !== null ? <span className={styles.tick} data-part="category-tick" style={{ insetInlineStart: pct(marker) }} /> : null}
      </span>
    </li>
  );
}

const LEVEL: Record<string, string> = {
  easy: 'var(--score-4)',
  medium: 'var(--score-3)',
  hard: 'var(--score-1)',
};

export function CategoryCards({
  keyName,
  groups,
  active,
  onPick,
}: {
  keyName: string;
  groups: CategoryGroup[];
  /** Position of the key among the shown keys (unused: the rail colour follows the value). */
  rank?: number;
  active: (value: string) => boolean;
  onPick: (value: string) => void;
}) {
  const { model, columns, baseline, ctx, metric } = useCompare();
  const type = model.types[metric] ?? 'score';
  const baseIdx = columns.indexOf(baseline);
  const numeric = type === 'numeric';
  let max = 0;
  if (numeric)
    for (const g of groups)
      for (const cell of g.cells) if (cell.score !== null) max = Math.max(max, cell.score);
  return (
    <ul className={styles.cards} aria-label={`By ${keyName}`} data-part="category-grid">
      {groups.map((g) => {
        const base = g.cells[baseIdx];
        const on = active(g.value);
        const press = () => onPick(g.value);
        return (
          <li key={g.value} className={styles.item}>
            <div
              className={styles.card}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              data-part="category-card"
              data-testid="category-card"
              data-value={g.value}
              style={{ '--rail': LEVEL[g.value.toLowerCase()] ?? 'var(--info)' } as CSSProperties}
              onClick={press}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  press();
                }
              }}
            >
              <span className={styles.title}>
                {g.value} <i>{g.itemIds.size}</i>
              </span>
              <span className={styles.cols} aria-hidden="true">
                <span>Run</span>
                <span>Average</span>
                <span>Latency</span>
                <span>Change</span>
              </span>
              <ul className={styles.rows}>
                {columns.map((col, i) => {
                  const cell = g.cells[i]!;
                  const d =
                    i !== baseIdx && base && cell.score !== null && base.score !== null
                      ? categoryDelta(model, col, baseline, ctx, cell, base)
                      : null;
                  const verdict = d?.verdict;
                  return (
                    <RunRow
                      key={col.key}
                      index={col.runIdxs[0] ?? 0}
                      name={columnName(model, col)}
                      title={col.title}
                      score={cell.score}
                      latency={cell.latency}
                      isBase={i === baseIdx}
                      type={type}
                      direction={model.directions[metric] ?? null}
                      max={numeric ? max || 1 : undefined}
                      marker={base?.score ?? null}
                      change={d && d.mean !== null ? formatDelta(d.mean, type) : '—'}
                      changeTitle={
                        d && d.halfWidth !== null ? `95% noise band ${formatBand(d.halfWidth, type)}` : undefined
                      }
                      tone={
                        i === baseIdx
                          ? 'base'
                          : verdict === 'improved'
                            ? 'up'
                            : verdict === 'regressed'
                              ? 'down'
                              : 'flat'
                      }
                    />
                  );
                })}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
