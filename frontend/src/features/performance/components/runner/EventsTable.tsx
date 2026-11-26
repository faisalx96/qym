/** Runner page: the runner's problems and notes, newest first, with the Level filter and the pager. */
import { useMemo } from 'react';
import type { Key } from 'react-aria-components';
import { Link } from 'react-router-dom';
import type { PerformanceActiveRun, PerformanceEvent, PerformanceLogLevel } from '@/api/performance';
import { performanceRunPath } from '@/app/routes';
import { formatTableDate } from '@/lib/dates';
import {
  ClearFiltersButton,
  DataTable,
  EmptyState,
  MultiSelect,
  SearchField,
  SectionHeader,
  StateTag,
  Text,
  type Column,
  type StateTagTone,
} from '@/ui';
import { count } from '../../lib/format';
import {
  isPlaceholder,
  placeholderRows,
  loadingRowCount,
  tagShape,
  withPlaceholders,
  type Placeholder,
} from '../home/placeholders';
import { useSearchText } from '../home/useSearchText';
import styles from './runner.module.css';

/** Entries of one page (the API's default). */
export const EVENTS_PAGE_SIZE = 10;

const LEVEL: Record<PerformanceLogLevel, [StateTagTone, string]> = {
  info: ['neutral', 'Note'],
  warning: ['warning', 'Warning'],
  error: ['danger', 'Error'],
};

function columns(slug: string, active: PerformanceActiveRun | null): Column<PerformanceEvent>[] {
  return [
    {
      id: 'at',
      header: 'When',
      width: 132,
      priority: 1,
      cardTitle: true,
      cell: (r) => <span className={styles.figures}>{formatTableDate(r.at)}</span>,
    },
    {
      id: 'level',
      header: 'Level',
      width: 96,
      priority: 1,
      cell: (r) => <StateTag tone={LEVEL[r.level][0]}>{LEVEL[r.level][1]}</StateTag>,
    },
    {
      id: 'message',
      header: 'What happened',
      minWidth: 280,
      flex: true,
      wrap: true,
      primary: true,
      priority: 1,
      cell: (r) => r.message,
    },
    {
      id: 'source',
      header: 'Reported by',
      width: 110,
      priority: 2,
      cell: (r) => (r.source === 'runner' ? 'The runner' : 'qym'),
    },
    {
      id: 'run',
      header: 'Run',
      width: 96,
      priority: 2,
      cell: (r) =>
        r.run_id ? (
          <Link to={performanceRunPath(slug, r.run_id)} data-link="name">
            {/* An entry names its run by id only; the number is known for the run in progress. */}
            {active?.id === r.run_id ? `Run ${active.number}` : 'Open run'}
          </Link>
        ) : (
          <span className={styles.muted}>–</span>
        ),
    },
  ];
}

export interface EventsTableProps {
  slug: string;
  events: PerformanceEvent[] | undefined;
  total: number;
  page: number;
  onPage: (page: number) => void;
  levels: Set<Key>;
  onLevels: (keys: Set<Key>) => void;
  /** How many entries the list holds with no filter, while a level narrows it ("Filtered from N entries"). */
  wholeTotal?: number;
  /** The search in the address (`?q=`), how to change it, and the bar's one clear. */
  search: string;
  onSearch: (text: string) => void;
  onClear: () => void;
  /** How many entries the loading page will hold, when the page already knows (placeholder rows, §7). */
  expected?: number;
  active: PerformanceActiveRun | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function EventsTable({
  slug,
  events,
  total,
  page,
  onPage,
  levels,
  onLevels,
  wholeTotal,
  search,
  onSearch,
  onClear,
  expected,
  active,
  loading,
  refreshing,
  error,
  onRetry,
}: EventsTableProps) {
  const cols = useMemo(
    () => withPlaceholders(columns(slug, active), { shapes: { level: tagShape() } }),
    [slug, active],
  );
  // While the entries are on their way the table draws placeholder rows through its own columns (§7).
  const shown: (PerformanceEvent | Placeholder)[] =
    events ?? (loading ? placeholderRows(loadingRowCount(expected, EVENTS_PAGE_SIZE)) : []);
  const [text, setText] = useSearchText(search, onSearch);
  const filtered = levels.size > 0;
  const narrowed = filtered || search !== '';
  return (
    <section className={styles.stack} aria-label="Problems and notes" data-performance-block="runner-events">
      <SectionHeader
        title="Problems and notes"
        description="What the runner and this project noted about runs, newest first."
      />
      <DataTable
        aria-label="Problems and notes"
        columns={cols}
        rows={shown}
        rowKey={(r) => r.id}
        rowState={(r) => (!isPlaceholder(r) && r.level === 'error' ? 'error' : undefined)}
        rowProps={(r) =>
          isPlaceholder(r) ? { 'data-performance-placeholder': '', 'aria-hidden': 'true' } : {}
        }
        isFiltered={narrowed}
        empty={<EmptyState compact title="No problems or notes yet" />}
        filteredEmpty={
          <EmptyState
            compact
            title={filtered ? 'No entries match these filters' : `No entries match “${search}”`}
          />
        }
        refreshing={refreshing}
        error={error}
        onRetry={onRetry}
        errorTitle="Couldn’t load the problems and notes"
        responsive="cards"
        minWidth={760}
      >
        <DataTable.Toolbar
          // The standard list search first (§3.4): 260px, "/" focuses it.
          search={
            <SearchField
              label="Search problems and notes"
              placeholder="Search problems and notes"
              value={text}
              onChange={setText}
              width="var(--search-width)"
              shortcut="/"
            />
          }
          filters={
            <>
              <MultiSelect
                label="Level"
                triggerVariant="bar"
                emptyMeansAll
                items={[
                  { key: 'info', label: 'Note' },
                  { key: 'warning', label: 'Warning' },
                  { key: 'error', label: 'Error' },
                ]}
                value={levels}
                onChange={onLevels}
              />
              <ClearFiltersButton count={(filtered ? 1 : 0) + (search ? 1 : 0)} onClear={onClear} />
            </>
          }
          trailing={
            // The runner read is polled every 15 seconds, and the list with it.
            <Text variant="sm" tone="muted">
              Updates automatically
            </Text>
          }
        />
        <DataTable.Footer
          filterNote={
            narrowed && wholeTotal !== undefined ? `Filtered from ${count(wholeTotal)} entries` : undefined
          }
          pagination={{ total, page, pageSize: EVENTS_PAGE_SIZE, noun: 'entries', onPageChange: onPage }}
        />
      </DataTable>
    </section>
  );
}
