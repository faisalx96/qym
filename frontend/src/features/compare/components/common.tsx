/** Small pieces shared by the delta line, the analytics panel and the item rows. */
import { Chip, Tag } from '@/ui';
import { formatBand, formatDelta, kindLabel, type BaselineStats, type DeltaKind } from '../lib/baseline';
import type { MetricDirection } from '@/lib/metrics';
import { runColor } from '../CompareContext';
import styles from './common.module.css';

export function RunDot({ index }: { index: number }) {
  return <span className={styles.dot} style={{ background: runColor(index) }} aria-hidden />;
}

const GLYPH = { improved: '▲', regressed: '▼', within_noise: '≈', changed: 'Δ' } as const;
const WORD = {
  improved: 'improved',
  regressed: 'regressed',
  within_noise: 'within noise',
  changed: 'changed',
} as const;

/** Signed delta with glyph and word (colour is never the only signal), plus the 95% band. */
export function DeltaTag({ stats, type, metric }: { stats: BaselineStats; type: string; metric: string }) {
  if (stats.mean === null) return <span className={styles.muted}>{'—'}</span>;
  const verdict = stats.verdict ?? 'within_noise';
  const tone = verdict === 'improved' ? 'success' : verdict === 'regressed' ? 'danger' : undefined;
  const band = stats.halfWidth !== null ? formatBand(stats.halfWidth, type) : null;
  const title =
    `${metric}: ${formatDelta(stats.mean, type)} vs baseline over ${stats.paired} paired items` +
    (band
      ? ` (95% noise band ${band}${stats.pValue !== null ? `, p=${stats.pValue.toFixed(3)}` : ''})`
      : ' (too few items for a noise band)');
  return (
    <span className={styles.delta}>
      <Tag kind="data" tone={tone} title={title}>
        <span aria-hidden>{GLYPH[verdict]}</span> {formatDelta(stats.mean, type)}
        <span className={styles.srOnly}> ({WORD[verdict]})</span>
      </Tag>
      {band ? (
        <span className={styles.band} title="95% noise band of the paired difference">
          {band}
        </span>
      ) : null}
    </span>
  );
}

/** Items improved / regressed vs the baseline; pressing one filters the item list. */
export function CountButtons({
  stats,
  active,
  onToggle,
  label,
  direction,
}: {
  stats: BaselineStats;
  active: DeltaKind | null;
  onToggle: (kind: DeltaKind) => void;
  label: string;
  direction: MetricDirection;
}) {
  const up = kindLabel('improved', direction);
  const down = kindLabel('regressed', direction);
  return (
    <span className={styles.counts}>
      <Chip
        isSelected={active === 'improved'}
        onChange={() => onToggle('improved')}
        count={stats.counts.improved}
        aria-label={`${stats.counts.improved} items ${up} vs baseline on ${label}; filter items`}
      >
        {'↑'}
      </Chip>
      <Chip
        isSelected={active === 'regressed'}
        onChange={() => onToggle('regressed')}
        count={stats.counts.regressed}
        aria-label={`${stats.counts.regressed} items ${down} vs baseline on ${label}; filter items`}
      >
        {'↓'}
      </Chip>
    </span>
  );
}

/** Forest mark: zero tick, 95% band and point on a +/-50 pt axis. */
export function Forest({ stats }: { stats: BaselineStats }) {
  if (stats.mean === null) return null;
  const pos = (x: number) => Math.max(0, Math.min(100, 50 + x * 100));
  const half = stats.halfWidth ?? 0;
  const lo = pos(stats.mean - half);
  const hi = pos(stats.mean + half);
  return (
    <span className={styles.forest} data-verdict={stats.verdict ?? 'within_noise'} aria-hidden>
      <span className={styles.forestZero} />
      <span className={styles.forestBand} style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
      <span className={styles.forestPoint} style={{ left: `${pos(stats.mean)}%` }} />
    </span>
  );
}
