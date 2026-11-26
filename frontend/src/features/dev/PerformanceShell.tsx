/** Performance mocks: the app shell around a composed page, and the small pieces every page shares. */
import type { ReactNode } from 'react';
import { Icon, Tag, Text, type IconName } from '@/ui';
import styles from './PerformanceMocks.module.css';

export const noop = () => undefined;

const NAV: [IconName, string][] = [
  ['home', 'Dashboard'],
  ['clock', 'Live'],
  ['zap', 'Performance'],
  ['chart', 'Charts'],
  ['list', 'Runs'],
  ['folder', 'Models'],
  ['flask', 'Experiments'],
  ['sparkles', 'Auto-analysis'],
  ['review', 'Reviews'],
  ['database', 'Datasets'],
  ['settings', 'Project settings'],
];

/** The shell: sidebar with Performance directly after Live, and the path in the top bar. */
export function PerformanceShell({
  variant,
  crumbs = [],
  children,
}: {
  variant: string;
  /** The path after "Performance": ['New run'], ['Run 24'], ['Runner']. */
  crumbs?: string[];
  children: ReactNode;
}) {
  const path = ['Demo', 'Performance', ...crumbs];
  return (
    <div className={styles.shell} data-performance-mock={variant}>
      <aside className={styles.sidebar} aria-label="Project navigation">
        <div className={styles.brand}>qym</div>
        <nav className={styles.nav}>
          <span className={styles.navItem}>
            <Icon name="folder" size={14} />
            <span>Projects</span>
          </span>
          <span className={styles.navItem}>
            <Icon name="book" size={14} />
            <span>Docs</span>
          </span>
          <Text variant="sm" tone="muted" className={styles.project}>
            Demo
          </Text>
          {NAV.map(([icon, label]) => (
            <span
              key={label}
              className={styles.navItem}
              data-active={label === 'Performance' ? '' : undefined}
              aria-current={label === 'Performance' ? 'page' : undefined}
            >
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </span>
          ))}
        </nav>
        <div className={styles.user}>
          <Tag kind="data">DU</Tag>
          <span>Dev User</span>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.topbar} data-performance-block="path">
          <Icon name="sidebar" size={14} />
          {path.map((part, index) => (
            <span key={part} className={styles.row}>
              {index ? <Icon name="chevron-right" size={12} /> : null}
              <span className={index === path.length - 1 ? styles.crumbNow : undefined}>{part}</span>
            </span>
          ))}
        </div>
        <main className={styles.content} data-performance-block="content">
          {children}
        </main>
      </div>
    </div>
  );
}

// ---------- words, numbers and marks ----------
// The real pages' own (`features/performance`), under the names the mocks have always used.

export {
  TEST_NAME,
  KINDS,
  KIND_NAME,
  KIND_SERIES,
  secs,
  span,
  count,
  pct,
  P95_HINT,
  clock,
  plus,
  seconds,
} from '@/features/performance/lib/format';
export { verdictWords, type VerdictFacts } from '@/features/performance/lib/status';
export {
  Quantity,
  Legend,
  KindTag,
  RunStatus,
  Verdict,
} from '@/features/performance/components/shared';
