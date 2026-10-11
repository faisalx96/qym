import { useTopbarStatsState } from '../TopbarStats';
import styles from './TopbarStatsBar.module.css';

/** KPI chips published by the page via useTopbarStats. */
export function TopbarStatsBar() {
  const state = useTopbarStatsState();
  if (!state || state.stats.length === 0) return null;
  return (
    <div className={styles.stats} role="group" aria-label={state.scopeTitle ?? 'Page statistics'} data-topbar-stats>
      {state.scope ? <span className={styles.scope}>{state.scope}</span> : null}
      {state.stats.map((s, i) => (
        <div key={i} className={styles.stat} title={s.title}>
          <span className={styles.value} data-color={s.color}>
            {s.value}
          </span>
          <span className={styles.label}>{s.label}</span>
          {s.secondary ? <span className={styles.secondary}>{s.secondary}</span> : null}
        </div>
      ))}
    </div>
  );
}
