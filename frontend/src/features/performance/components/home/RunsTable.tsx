/** Performance home: every run of the project, newest first, with the Test and Target filters and the pager. */
import { useMemo } from 'react';
import type { Key } from 'react-aria-components';
import {
  type PerformanceActiveRun,
  type PerformanceRunRow,
  type PerformanceTargetSummary,
} from '@/api/performance';
import { performanceRunPath } from '@/app/routes';
import { formatTableDate } from '@/lib/dates';
import {
  ClearFiltersButton,
  DataTable,
  DatasetTag,
  EmptyState,
  MultiSelect,
  SearchField,
  Section,
  Select,
  Text,
  UserName,
  type Column,
} from '@/ui';
import { P95_HINT, TEST_NAME, count, secs, span } from '../../lib/format';
import { RunStatus, TargetEnvironment, Verdict } from '../shared';
import { RUNS_PAGE_SIZE } from './model';
import { useSearchText } from './useSearchText';
import {
  isPlaceholder,
  placeholderRows,
  loadingRowCount,
  tagShape,
  withPlaceholders,
  type Placeholder,
} from './placeholders';
import styles from './home.module.css';

/** The key of the Target filter that narrows nothing. */
export const ALL_TARGETS = 'all';

function TargetName({ target }: { target: PerformanceRunRow['target'] }) {
  return (
    <span className={styles.row}>
      <span>{target.name}</span>
      {/* The area's one environment mark (as Live marks a source's environment, cv5 M2). */}
      <TargetEnvironment production={target.is_production} />
    </span>
  );
}

/** How far the run is, then what the test found: a finished run shows its result alone. */
function Result({ run, active }: { run: PerformanceRunRow; active: PerformanceActiveRun | null }) {
  const live = active?.id === run.id ? active : null;
  const level =
    live && live.level !== null
      ? `level ${live.level}${run.max_users === null ? '' : ` of ${run.max_users}`}`
      : null;
  return (
    <span className={styles.inline}>
      {run.status === 'finished' && run.verdict ? null : <RunStatus status={run.status} />}
      <Verdict run={run} />
      {level ? <span className={styles.muted}>{level}</span> : null}
    </span>
  );
}

function columns(active: PerformanceActiveRun | null): Column<PerformanceRunRow>[] {
  return [
    {
      id: 'number',
      header: 'Run',
      width: 64,
      mono: true,
      primary: true,
      cardTitle: true,
      priority: 1,
      cell: (r) => r.number,
    },
    {
      id: 'started',
      header: 'Started',
      width: 124,
      priority: 1,
      cell: (r) => <span className={styles.figures}>{formatTableDate(r.started_at ?? r.requested_at)}</span>,
    },
    { id: 'test', header: 'Test', width: 92, priority: 2, cell: (r) => TEST_NAME[r.test_type] },
    {
      id: 'target',
      header: 'Target',
      minWidth: 112,
      priority: 2,
      cell: (r) => <TargetName target={r.target} />,
    },
    {
      id: 'questions',
      header: 'Questions',
      // Room for the longest dataset tag of the sample with its version (the table still fits its box at 1440).
      minWidth: 192,
      wrap: true,
      flex: true,
      priority: 3,
      cell: (r) => <DatasetTag name={r.dataset.name} version={r.dataset.version} />,
    },
    {
      id: 'result',
      header: 'Result',
      hint: 'How far the run is, and what the test found.',
      // Below the width where the table fits its box, the column keeps the widest mark and tag on one line.
      width: 230,
      wrap: true,
      priority: 1,
      cell: (r) => <Result run={r} active={active} />,
    },
    {
      id: 'safe',
      header: 'Safe load',
      hint: 'The highest level that passed, in users.',
      width: 88,
      align: 'center',
      mono: true,
      priority: 2,
      cell: (r) => count(r.safe_load_users),
    },
    {
      id: 'breaks',
      header: 'Breaks at',
      hint: 'The first level that broke a limit, in users.',
      width: 96,
      align: 'center',
      mono: true,
      priority: 2,
      cell: (r) => count(r.breaking_level_users),
    },
    {
      id: 'p95',
      header: 'p95',
      // Percentiles are written lower case (§3.3); the header keeps its case through the column option (A3).
      headerCase: 'as-written',
      hint: `${P95_HINT} For a Breakpoint run it is measured at the safe load.`,
      width: 88,
      align: 'center',
      mono: true,
      priority: 2,
      cell: (r) => secs(r.p95_at_safe_load_ms ?? r.p95_ms),
    },
    {
      id: 'duration',
      header: 'Length',
      hint: 'How long the run took.',
      width: 96,
      align: 'center',
      priority: 3,
      cell: (r) => <span className={styles.figures}>{span(r.duration_s)}</span>,
    },
    {
      id: 'by',
      header: 'By',
      priority: 3,
      cell: (r) => <UserName id={r.requested_by_user_id} name={r.requested_by} />,
    },
  ];
}

export interface RunsTableProps {
  slug: string;
  /** The rows of the page shown; undefined while the first answer of a narrowed list is on its way. */
  rows: PerformanceRunRow[] | undefined;
  /** How many runs the filters leave. */
  total: number;
  /** How many runs the project has, whatever the filters. */
  allTotal: number;
  page: number;
  onPage: (page: number) => void;
  targets: PerformanceTargetSummary[];
  active: PerformanceActiveRun | null;
  tests: Set<Key>;
  onTests: (keys: Set<Key>) => void;
  /** A target id, or `ALL_TARGETS`. */
  target: string;
  onTarget: (key: string) => void;
  /** The search in the address (`?q=`), and how to change it. */
  search: string;
  onSearch: (text: string) => void;
  loading?: boolean;
  refreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** How many runs the loading view will hold, when the page already knows (placeholder rows, §7). */
  expected?: number;
  /** Clears both filters at once (the one × Clear n of the bar). */
  onClear?: () => void;
}

export function RunsTable({
  slug,
  rows,
  total,
  allTotal,
  page,
  onPage,
  targets,
  active,
  tests,
  onTests,
  target,
  onTarget,
  loading,
  refreshing,
  error,
  onRetry,
  onClear,
  expected,
  search,
  onSearch,
}: RunsTableProps) {
  const [text, setText] = useSearchText(search, onSearch);
  const filtered = tests.size > 0 || target !== ALL_TARGETS;
  const narrowed = filtered || search !== '';
  // The one × Clear n counts the filters, plus one while the search has text (§3.4).
  const set = (tests.size > 0 ? 1 : 0) + (target !== ALL_TARGETS ? 1 : 0) + (search ? 1 : 0);
  const cols = useMemo(
    () =>
      withPlaceholders(columns(active), {
        shapes: { questions: tagShape(), result: tagShape(), by: tagShape() },
      }),
    [active],
  );
  // While the rows are on their way the table draws placeholder rows through its own columns (§7).
  const shown: (PerformanceRunRow | Placeholder)[] =
    rows ?? (loading ? placeholderRows(loadingRowCount(expected, RUNS_PAGE_SIZE)) : []);
  return (
    // The p95 hint lives on its column header (`hint`), so the description stays one short line (C6).
    <Section
      title="Runs"
      description="Every run of this project, newest first."
      aria-label="Runs"
      data-performance-block="runs"
    >
      <DataTable
        aria-label="Runs"
        columns={cols}
        rows={shown}
        rowKey={(r) => r.id}
        rowHref={(r) => (isPlaceholder(r) ? undefined : performanceRunPath(slug, r.id))}
        rowProps={(r) =>
          isPlaceholder(r)
            ? { 'data-performance-placeholder': '', 'aria-hidden': 'true' }
            : { 'data-performance-run': String(r.number) }
        }
        // No live rail: the Result column already shows the running step (§3.4, runs list 17 Nov R6).
        isFiltered={narrowed}
        filteredEmpty={
          <EmptyState
            compact
            title={filtered ? 'No runs match these filters' : `No runs match “${search}”`}
          />
        }
        refreshing={refreshing}
        error={error}
        onRetry={onRetry}
        errorTitle="Couldn’t load the runs"
        responsive="cards"
        minWidth={1160}
      >
        <DataTable.Toolbar
          // The standard list search first (§3.4): 260px, "/" focuses it.
          search={
            <SearchField
              label="Search runs"
              placeholder="Search runs"
              value={text}
              onChange={setText}
              width="var(--search-width)"
              shortcut="/"
            />
          }
          filters={
            <>
              <MultiSelect
                label="Test"
                triggerVariant="bar"
                emptyMeansAll
                items={[
                  { key: 'breakpoint', label: 'Breakpoint' },
                  { key: 'smoke', label: 'Smoke' },
                  { key: 'soak', label: 'Soak' },
                ]}
                value={tests}
                onChange={onTests}
              />
              <Select
                label="Target"
                triggerVariant="bar"
                items={[
                  { key: ALL_TARGETS, label: 'All targets' },
                  ...targets.map((t) => ({ key: t.id, label: t.name })),
                ]}
                value={target}
                onChange={(key) => onTarget(key === null ? ALL_TARGETS : String(key))}
              />
              {onClear ? <ClearFiltersButton count={set} onClear={onClear} /> : null}
            </>
          }
          // The first page comes with Home, which is read again every few seconds; a narrowed list when a run ends.
          trailing={
            <Text variant="sm" tone="muted">
              Updates automatically
            </Text>
          }
        />
        <DataTable.Footer
          filterNote={narrowed ? `Filtered from ${count(allTotal)} runs` : undefined}
          pagination={{ total, page, pageSize: RUNS_PAGE_SIZE, noun: 'runs', onPageChange: onPage }}
        />
      </DataTable>
    </Section>
  );
}
