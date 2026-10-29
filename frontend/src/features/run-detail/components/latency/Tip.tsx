/** The tooltip body every Latency and traces mark shares: a title, label/value rows, one hint line. */
import type { CSSProperties, ReactNode } from 'react';
import styles from './Tip.module.css';

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

/** Custom properties for a style prop (`--x`, `--tone`): CSSProperties does not type them. */
export const cssVars = (vars: Record<string, string | number>): CSSProperties => vars as CSSProperties;
