/**
 * Performance mocks: Home. The mock is the real page (`features/performance/PerformanceHomePage`) inside the
 * gallery shell, reading from a query client of its own that is filled from the fixtures: nothing is fetched.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  performanceKeys,
  type PerformanceHome,
  type PerformanceRunRead,
  type PerformanceRunRow,
  type PerformanceRunsPage,
} from '@/api/performance';
import { PerformanceHomePage as RealHomePage } from '@/features/performance/PerformanceHomePage';
import { RUNS_PAGE_SIZE, capacityFilters } from '@/features/performance/components/home/model';
import { useSearchParamsState } from '@/lib/url-state';
import { Icon, Tag, Text, type IconName } from '@/ui';
import styles from './PerformanceMocks.module.css';

const SLUG = 'demo';

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

/**
 * The gallery shell around a real page: the sidebar and the path of `PerformanceShell`, without its content
 * box. A real page brings the app's own frame (20px at every width), as it does under the app shell.
 */
export function RealPageShell({
  variant,
  crumbs = [],
  children,
}: {
  variant: string;
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
        {children}
      </div>
    </div>
  );
}

/** A query client that never asks the network: every read a mock shows is put in by hand. */
export function fixtureClient(fill: (client: QueryClient) => void): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: false,
      },
    },
  });
  fill(client);
  return client;
}

const page = (rows: PerformanceRunRow[], size: number): PerformanceRunsPage => ({
  rows,
  total: rows.length,
  page: 1,
  page_size: size,
});

const NARROW = { tests: ['breakpoint' as const], target: 'target-preprod' };

function homeClient(home: PerformanceHome, run: PerformanceRunRead | undefined): QueryClient {
  return fixtureClient((client) => {
    // The run in progress carries its plan and its levels, as the API sends them.
    const active =
      home.active_run && run
        ? { ...home.active_run, stages: run.config.plan.stages, levels: run.progress?.levels ?? [] }
        : home.active_run;
    client.setQueryData(performanceKeys.home(SLUG), { ...home, active_run: active, received_at: Date.now() });
    // What the capacity block asks for each target: its Breakpoint runs that have a verdict.
    for (const target of home.targets) {
      const filters = capacityFilters(target.id);
      const rows = home.runs.rows.filter(
        (row) =>
          row.target.id === target.id &&
          row.test_type === 'breakpoint' &&
          row.verdict !== null &&
          filters.verdict!.includes(row.verdict),
      );
      client.setQueryData(performanceKeys.runs(SLUG, filters), page(rows, filters.page_size!));
    }
    // The narrowed view of the "history" mock: Breakpoint runs on Preprod.
    client.setQueryData(
      performanceKeys.runs(SLUG, {
        page: 1,
        page_size: RUNS_PAGE_SIZE,
        test_type: NARROW.tests,
        target: NARROW.target,
      }),
      page(
        home.runs.rows.filter((row) => row.test_type === 'breakpoint' && row.target.id === NARROW.target),
        RUNS_PAGE_SIZE,
      ),
    );
  });
}

/** Puts the filters of the "history" mock into the address, where the real page keeps them. */
function Narrowed({ children }: { children: ReactNode }) {
  const { replaceUrlQuery } = useSearchParamsState();
  useEffect(() => {
    replaceUrlQuery({ test: NARROW.tests, target: NARROW.target });
  }, [replaceUrlQuery]);
  return children;
}

export function PerformanceHomePage({
  variant,
  home,
  run,
  filtered = false,
}: {
  variant: string;
  home: PerformanceHome;
  /** The read of the run in progress: its plan and levels fill the active run of the Home read. */
  run?: PerformanceRunRead;
  /** Show the table narrowed to Breakpoint runs on Preprod. */
  filtered?: boolean;
}) {
  const [client] = useState(() => homeClient(home, run));
  const real = <RealHomePage slug={SLUG} />;
  return (
    <RealPageShell variant={variant}>
      <QueryClientProvider client={client}>
        {filtered ? <Narrowed>{real}</Narrowed> : real}
      </QueryClientProvider>
    </RealPageShell>
  );
}
