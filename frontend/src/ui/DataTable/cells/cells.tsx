import type { ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { formatDurationMs, formatNumericValue, formatRelative } from '@/lib/format';
import { metricBand, type MetricDirection, type MetricType } from '@/lib/metrics';
import { CopyButton } from '../../CopyButton';
import { Identicon } from '../../Identicon';
import { Popover } from '../../Popover';
import { RunStatusBadge } from '../../RunStatusBadge';
import { Tag } from '../../Tag';
import { middleTruncate } from '../model';
import styles from './cells.module.css';

/* ── ScoreBar ──────────────────────────────────────────────────────────── */

export interface ScoreBarProps {
  /** 0..1 for rates; any number when `max` is given (relative scale). */
  value: number | null | undefined;
  type?: MetricType;
  direction?: MetricDirection | 'higher' | 'lower' | 'none';
  /** Relative scale for non-percent values (latency, tokens): bar = value / max. */
  max?: number;
  /** Displayed text override (defaults to a percent, or a number with `max`). */
  text?: string;
  error?: 'task' | 'metric' | null;
  /** Fixed bar colour (a CSS colour or token) for series that are not score bands, e.g. a model colour. */
  color?: string;
}

function normDirection(d: ScoreBarProps['direction']): MetricDirection {
  if (d === 'higher' || d === 'maximize') return 'maximize';
  if (d === 'lower' || d === 'minimize') return 'minimize';
  return null;
}

/** Track + fill + value. Errors show the warning glyph, never a bar. */
export function ScoreBar({ value, type, direction, max, text, error, color }: ScoreBarProps) {
  if (error) {
    return (
      <span className={styles.scoreBar} data-error={error}>
        <span
          className={styles.errGlyph}
          role="img"
          aria-label={error === 'task' ? 'Task error' : 'Metric error'}
        >
          ⚠
        </span>
        <span className={styles.scoreText}>Error</span>
      </span>
    );
  }
  if (value === null || value === undefined || Number.isNaN(value))
    return (
      <span className={styles.scoreBar} data-empty="">
        <span className={styles.scoreText}>—</span>
      </span>
    );
  const dir = normDirection(direction);
  const band = max === undefined ? metricBand(value, type, dir) : null;
  const ratio = max === undefined ? value : max > 0 ? value / max : 0;
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const label = text ?? (max === undefined ? `${Math.round(value * 100)}%` : formatNumericValue(value));
  return (
    <span
      className={styles.scoreBar}
      data-band={band ?? undefined}
      style={color ? ({ '--bar': color } as React.CSSProperties) : undefined}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ inlineSize: `${pct}%` }} />
      </span>
      <span className={styles.scoreText}>{label}</span>
    </span>
  );
}

/* ── DeltaCell ─────────────────────────────────────────────────────────── */

export interface DeltaCellProps {
  value: number | null | undefined;
  direction?: MetricDirection | 'higher' | 'lower' | 'none';
  /** Treat changes within this magnitude as unchanged. */
  noise?: number;
  /** Formatter for the magnitude (default points: value * 100). */
  format?: (abs: number) => string;
}

export function DeltaCell({ value, direction, noise = 0, format }: DeltaCellProps) {
  if (value === null || value === undefined || Number.isNaN(value))
    return <span className={styles.deltaEmpty}>—</span>;
  const dir = normDirection(direction);
  const flat = Math.abs(value) <= noise;
  const up = value > 0;
  const good = flat || !dir ? null : dir === 'maximize' ? up : !up;
  const mag = format ? format(Math.abs(value)) : `${(Math.abs(value) * 100).toFixed(1)}`;
  return (
    <span
      className={styles.delta}
      data-verdict={flat ? 'flat' : good === null ? 'neutral' : good ? 'good' : 'bad'}
    >
      <span aria-hidden="true">{flat ? '–' : up ? '▲' : '▼'}</span>
      <span>
        {flat ? '' : up ? '+' : '-'}
        {mag}
      </span>
    </span>
  );
}

/* ── TwoLine ───────────────────────────────────────────────────────────── */

export function TwoLine({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className={styles.twoLine}>
      <span className={styles.primary}>{primary}</span>
      {secondary ? <span className={styles.secondary}>{secondary}</span> : null}
    </span>
  );
}

/* ── IdCell ────────────────────────────────────────────────────────────── */

export function IdCell({ value, keep = 8, copy = true }: { value: string; keep?: number; copy?: boolean }) {
  const short = middleTruncate(value, keep);
  return (
    <span className={styles.id}>
      <span className={styles.idText} title={short === value ? undefined : value}>
        {short}
      </span>
      {copy ? <CopyButton text={value} label={`Copy ${value}`} className={styles.idCopy} /> : null}
    </span>
  );
}

/* ── RelativeTime ──────────────────────────────────────────────────────── */

export function RelativeTime({ iso, now }: { iso: string | null | undefined; now?: Date }) {
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  return (
    <time dateTime={iso} title={d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}>
      {formatRelative(iso, now)}
    </time>
  );
}

/* ── TagsCell ──────────────────────────────────────────────────────────── */

export function TagsCell({
  tags,
  max = 2,
  label = 'tags',
}: {
  tags: readonly string[] | null | undefined;
  max?: number;
  label?: string;
}) {
  const list = tags ?? [];
  if (list.length === 0) return <span>—</span>;
  const shown = list.slice(0, max);
  const rest = list.slice(max);
  return (
    <span className={styles.tags}>
      {shown.map((t) => (
        <Tag key={t} kind="data">
          {t}
        </Tag>
      ))}
      {rest.length ? (
        <Popover
          label={`More ${label}`}
          trigger={
            <AriaButton className={styles.more} aria-label={`${rest.length} more ${label}`}>
              +{rest.length}
            </AriaButton>
          }
        >
          <span className={styles.tagPop}>
            {rest.map((t) => (
              <Tag key={t} kind="data">
                {t}
              </Tag>
            ))}
          </span>
        </Popover>
      ) : null}
    </span>
  );
}

/* ── UserCell ──────────────────────────────────────────────────────────── */

export function UserCell({ name, seed }: { name: string | null | undefined; seed?: string }) {
  if (!name) return <span>—</span>;
  return (
    <span className={styles.user}>
      <Identicon seed={seed ?? name} cell={4} gap={1} />
      <span className={styles.userName}>{name}</span>
    </span>
  );
}

/* ── ProgressCell ──────────────────────────────────────────────────────── */

export function ProgressCell({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <span className={styles.progress}>
      <span
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="Progress"
      >
        <span className={styles.fill} style={{ inlineSize: `${pct}%` }} data-plain="" />
      </span>
      <span className={styles.scoreText}>
        {done}/{total}
      </span>
    </span>
  );
}

/* ── StatusCell / NumberCell / DurationCell ────────────────────────────── */

export function StatusCell({ status }: { status: string | null | undefined }) {
  if (!status) return <span>—</span>;
  return <RunStatusBadge status={status} />;
}

export function NumberCell({ value, decimals = 1 }: { value: number | null | undefined; decimals?: number }) {
  return <span className={styles.num}>{formatNumericValue(value, decimals)}</span>;
}

export function DurationCell({ ms }: { ms: number | null | undefined }) {
  return <span className={styles.num}>{formatDurationMs(ms)}</span>;
}
