/** The chart tooltip body (moved from the run Latency section, C-35): a title, label/value rows, one hint line. */
import type { ReactNode } from 'react';
import styles from './TipBody.module.css';

export function TipBody({
  title,
  rows = [],
  hint,
}: {
  title: ReactNode;
  rows?: Array<[ReactNode, ReactNode]>;
  hint?: ReactNode;
}) {
  return (
    <div className={styles.tip}>
      <div className={styles.title}>{title}</div>
      {rows.length ? (
        <div className={styles.grid}>
          {rows.map(([k, v], i) => (
            <div key={i} className={styles.pair}>
              <span className={styles.key}>{k}</span>
              <span className={styles.value}>{v}</span>
            </div>
          ))}
        </div>
      ) : null}
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}
