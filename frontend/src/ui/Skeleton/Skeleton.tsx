import styles from './Skeleton.module.css';

export interface SkeletonProps {
  kind?: 'value' | 'lines' | 'chart' | 'cards' | 'table' | 'list' | 'rows';
  width?: number | string;
  height?: number | string;
  rows?: number;
  /** `rows` kind: height of each block row in px (shaped like the real list). */
  rowHeight?: number;
  count?: number;
  label?: string;
  className?: string;
}

/** Shimmer bones. Pair with useDelayedPending so nothing flashes under 300 ms. */
export function Skeleton({
  kind = 'lines',
  width,
  height,
  rows = 3,
  rowHeight = 40,
  count = 3,
  label = 'Loading',
  className,
}: SkeletonProps) {
  const style = { width, height };
  const cls = [styles.skeleton, className].filter(Boolean).join(' ');
  const common = {
    role: 'status' as const,
    'aria-label': label,
    'aria-busy': true,
    className: cls,
    'data-kind': kind,
  };
  if (kind === 'value') return <span {...common} style={style} />;
  if (kind === 'chart') return <div {...common} style={{ width, height: height ?? 160 }} />;
  if (kind === 'cards') {
    return (
      <div {...common}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={styles.card} />
        ))}
      </div>
    );
  }
  if (kind === 'rows') {
    return (
      <div {...common} style={style}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={styles.blockRow} style={{ height: rowHeight }} />
        ))}
      </div>
    );
  }
  if (kind === 'table') {
    return (
      <div {...common}>
        <div className={styles.row} data-head />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={styles.row} />
        ))}
      </div>
    );
  }
  return (
    <div {...common} style={style}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.bone} style={{ width: i === rows - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
