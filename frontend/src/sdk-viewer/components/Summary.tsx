import { useEffect, useState, type KeyboardEvent } from 'react';
import type { Row, RunInfo, Snapshot } from '../types';
import { formatElapsed, formatLatency, latencySummary } from '../lib/stats';
import { metricCell } from '../lib/metric-cell';
import { parseTime, STATUS_LABEL } from './format';
import s from './Summary.module.css';

function useElapsed(run: RunInfo, finished: boolean, paused: boolean): number | null {
  const start = parseTime(run.started_at);
  const end = parseTime(run.ended_at);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null || finished || paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [start, finished, paused]);
  if (start === null) return null;
  return ((finished && end !== null ? end : now) - start) / 1000;
}

function metricMeans(rows: Row[], names: string[]): Array<{ name: string; mean: number; n: number }> {
  return names.flatMap((name, k) => {
    const nums = rows.map((r) => metricCell(r.metric_values[k]).num).filter((x): x is number => x !== null);
    return nums.length ? [{ name, mean: nums.reduce((a, b) => a + b, 0) / nums.length, n: nums.length }] : [];
  });
}

export interface SummaryProps {
  snapshot: Snapshot;
  run: RunInfo;
  finished: boolean;
  /** the live stream dropped: the clock stops until it is back */
  paused?: boolean;
  visible: Set<number>;
  selected: number | null;
  onOpen: (index: number) => void;
}

/** Progress, latency and the ribbon: one coloured cell per row, doubling as navigation. */
export function Summary({
  snapshot,
  run,
  finished,
  paused = false,
  visible,
  selected,
  onOpen,
}: SummaryProps) {
  const { stats, rows } = snapshot;
  const elapsed = useElapsed(run, finished, paused);
  const latency = latencySummary(rows);
  const means = metricMeans(rows, snapshot.metric_names);
  const done = stats.completed + stats.failed;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cells = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const i = cells.indexOf(document.activeElement as HTMLButtonElement);
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? cells.length - 1
              : -1;
    if (to >= 0) {
      e.preventDefault();
      cells[Math.max(0, Math.min(cells.length - 1, to))]?.focus();
    }
  };

  return (
    <section className={s.box} aria-label="Run progress">
      <div className={s.head}>
        <span className={s.big} role="status">
          {done}
          <span className={s.of}> / {stats.total} finished</span>
        </span>
        <span className={s.legend}>
          <i data-s="completed" /> {stats.completed} done <i data-s="error" /> {stats.failed} failed{' '}
          <i data-s="in_progress" /> {stats.in_progress} running <i data-s="pending" /> {stats.pending}{' '}
          pending
        </span>
        {elapsed !== null ? (
          <span className={s.stat}>
            <span className={s.k}>Elapsed</span> {formatElapsed(elapsed)}
          </span>
        ) : null}
        <span className={s.grow} />
        {means.length ? (
          <dl className={s.stats} aria-label="Mean score per metric">
            {means.map((m) => (
              <div key={m.name} title={`${m.name}: mean of ${m.n} scored rows`}>
                <dt>{m.name}</dt>
                <dd>{Math.round(m.mean * 1000) / 1000}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {latency ? (
          <dl className={s.stats} aria-label="Latency">
            {(
              [
                ['Min', latency.min],
                ['P50', latency.p50],
                ['P90', latency.p90],
                ['P99', latency.p99],
                ['Max', latency.max],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{formatLatency(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div
        className={s.ribbon}
        role="toolbar"
        aria-label="One cell per row. Arrow keys move, Enter opens."
        onKeyDown={onKey}
      >
        {rows.map((r, i) => (
          <button
            key={r.index}
            type="button"
            className={s.tick}
            data-s={r.status}
            data-sel={selected === r.index || undefined}
            data-dim={!visible.has(r.index) || undefined}
            tabIndex={i === 0 ? 0 : -1}
            aria-label={`Row ${r.index + 1}: ${STATUS_LABEL[r.status]}`}
            title={`Row ${r.index + 1}: ${STATUS_LABEL[r.status]}`}
            onClick={() => onOpen(r.index)}
          />
        ))}
      </div>
    </section>
  );
}
