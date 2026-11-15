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
  /** Override the displayed text (e.g. True/False for booleans, formatted numerics). */
  text?: string;
  /**
   * 'text' (default, inline, with the band's 2px start bar), 'pill' (tinted fill of the band: cards, stat strips,
   * compare averages) or 'plain' (the band-coloured number alone: table cells).
   */
  variant?: 'text' | 'pill' | 'plain';
  /**
   * Where a pass threshold applies (C220): the value is plain green when it passes and plain red when it fails, in
   * place of its band. The title names the verdict, so colour is not the only cue.
   */
  verdict?: 'pass' | 'fail' | null;
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
  digits = 1,
  raw,
  text: textOverride,
  variant = 'text',
  verdict,
  className,
}: ScoreValueProps) {
  const dir = normalize(direction);
  const judged = !error && value != null && verdict ? verdict : null;
  const band = error || judged ? null : metricBand(value, type, dir);
  const text = error
    ? 'Error'
    : textOverride !== undefined
      ? textOverride
      : raw
        ? (value ?? '—')
        : formatPercent(value ?? null, digits);
  return (
    <span
      className={[styles.score, className].filter(Boolean).join(' ')}
      data-band={band ?? undefined}
      data-error={error ?? undefined}
      data-variant={variant === 'text' ? undefined : variant}
      data-tone={judged ? (judged === 'pass' ? 'success' : 'danger') : undefined}
      data-verdict={judged ?? undefined}
      title={
        judged
          ? judged === 'pass'
            ? 'Passes the pass threshold'
            : 'Fails the pass threshold'
          : band
            ? `Band ${band} of 5`
            : undefined
      }
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
