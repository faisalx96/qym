import { formatPercent, metricBand, type MetricDirection, type MetricType } from '@/lib/metrics';
import styles from './ScoreValue.module.css';

export interface ScoreValueProps {
  value: number | null | undefined;
  type?: MetricType;
  direction?: MetricDirection | 'higher' | 'lower' | 'none';
  /** 'task' = ⚠ --error, 'metric' = ⚠ --metric-error. */
  error?: 'task' | 'metric' | null;
  retries?: number;
  ci?: [number, number] | null;
  digits?: number;
  /** Show raw number instead of a percent. */
  raw?: boolean;
  className?: string;
}

function normalize(direction: ScoreValueProps['direction']): MetricDirection {
  if (direction === 'higher' || direction === 'maximize') return 'maximize';
  if (direction === 'lower' || direction === 'minimize') return 'minimize';
  return null;
}

/**
 * Score with its band colour plus a non-colour cue (data-band + 2px left bar,
 * brief 02 §7.1), ⚠/↻ glyphs for errors/retries, muted CI.
 */
export function ScoreValue({
  value,
  type,
  direction,
  error,
  retries,
  ci,
  digits = 0,
  raw,
  className,
}: ScoreValueProps) {
  const dir = normalize(direction);
  const band = error ? null : metricBand(value, type, dir);
  const text = error ? 'Error' : raw ? (value ?? '—') : formatPercent(value ?? null, digits);
  return (
    <span
      className={[styles.score, className].filter(Boolean).join(' ')}
      data-band={band ?? undefined}
      data-error={error ?? undefined}
      title={band ? `Band ${band} of 5` : undefined}
    >
      {error ? (
        <span
          className={styles.glyph}
          data-error={error}
          aria-label={error === 'task' ? 'Task error' : 'Metric error'}
          role="img"
        >
          ⚠
        </span>
      ) : null}
      <span className={styles.value}>{String(text)}</span>
      {retries ? (
        <span className={styles.retries} title={`${retries} retries`}>
          ↻{retries}
        </span>
      ) : null}
      {ci && !error ? (
        <span className={styles.ci}>
          {formatPercent(ci[0], digits)}–{formatPercent(ci[1], digits)}
        </span>
      ) : null}
    </span>
  );
}
