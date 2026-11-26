import { PerformanceDownload } from '../PerformanceDownload';
/** Performance run page, Log tab: the events in words, or every line of the log. */
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  isPerformanceRunActive,
  performanceLogTextUrl,
  usePerformanceRunEvents,
  type PerformanceLogLevel,
  type PerformanceRunRead,
} from '@/api/performance';
import {
  Card,
  CardTitle,
  ClearFiltersButton,
  EmptyState,
  ErrorState,
  Icon,
  MultiSelect,
  SearchField,
  SegmentedControl,
  Skeleton,
  Switch,
  Timeline,
} from '@/ui';
import { clock, count } from '../../lib/format';
import { LogViewer } from './LogViewer';
import { useSettled } from './hooks';
import { useLogTail } from './logTail';
import styles from './run.module.css';

export type LogMode = 'events' | 'all';

const LEVELS: { key: PerformanceLogLevel; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'warning', label: 'Warning' },
  { key: 'error', label: 'Error' },
];

/** The tone is only on lines that matter: a passed level, a warning, an error. */
const EVENT_TONE = { info: undefined, warning: 'warning', error: 'danger' } as const;

export function LogTab({
  slug,
  runId,
  read,
  initialMode = 'all',
  description = 'Events are what the runner reported in words. All lines is the runner’s own log as it wrote it, one line per answer.',
}: {
  slug: string;
  runId: string;
  read: Pick<PerformanceRunRead, 'effective_status'>;
  description?: string;
  initialMode?: LogMode;
}) {
  const active = isPerformanceRunActive(read.effective_status);
  const [mode, setMode] = useState<LogMode>(initialMode);
  const [levels, setLevels] = useState<Set<Key>>(() => new Set());
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const q = useSettled(search.trim(), 250);
  const level = LEVELS.map((item) => item.key).filter((key) => levels.has(key));
  const tail = useLogTail(slug, runId, { level, q }, { active, enabled: mode === 'all' });
  const events = usePerformanceRunEvents(slug, runId, { active, enabled: mode === 'events' });
  const needle = q.toLowerCase();
  const shownEvents = [...(events.data?.events ?? [])]
    .reverse()
    .filter(
      (event) =>
        (!level.length || level.includes(event.level)) &&
        (!needle || event.message.toLowerCase().includes(needle)),
    );
  const narrowed = level.length > 0 || Boolean(q);
  // Filtered to nothing names the filters; searched to nothing names the search (§3.7).
  const noMatch = (things: string) =>
    level.length ? `No ${things} match these filters` : `No ${things} match “${q}”`;
  return (
    <Card
      as="section"
      aria-label="Log"
      data-performance-block="log-card"
      header={<CardTitle title="Log" description={description} />}
    >
      <div className={styles.stack}>
        {/* One toolbar row (§3.4): the search first, then the switch and the filter, the one Clear, Download at the end. */}
        <div
          className={styles.toolbar}
          role="group"
          aria-label="Log controls"
          data-performance-block="log-toolbar"
        >
          <SearchField
            label="Search the log"
            placeholder="Search the log"
            width="var(--search-width)"
            shortcut="/"
            value={search}
            onChange={setSearch}
          />
          <SegmentedControl
            label="Lines to show"
            value={mode}
            onChange={(value) => setMode(value as LogMode)}
            options={[
              { value: 'events', label: 'Events' },
              { value: 'all', label: 'All lines' },
            ]}
          />
          <MultiSelect
            label="Level"
            triggerVariant="bar"
            emptyMeansAll
            items={LEVELS}
            value={levels}
            onChange={setLevels}
          />
          <Switch isSelected={follow && mode === 'all'} isDisabled={mode !== 'all'} onChange={setFollow}>
            Follow
          </Switch>
          <ClearFiltersButton
            count={(level.length ? 1 : 0) + (search.trim() ? 1 : 0)}
            onClear={() => {
              setLevels(new Set());
              setSearch('');
            }}
            testId="performance-log-clear"
          />
          <span className={styles.toolbarEnd}>
            <PerformanceDownload
              href={performanceLogTextUrl(slug, runId)}
              download
              variant="accent"
              icon={<Icon name="download" size={12} />}
            >
              Download
            </PerformanceDownload>
          </span>
        </div>
        {mode === 'events' ? (
          events.isError && !events.data ? (
            <ErrorState
              compact
              error={events.error}
              title="Couldn’t load the events"
              onRetry={() => void events.refetch()}
            />
          ) : !events.data ? (
            <Skeleton kind="lines" rows={6} label="Loading the events" />
          ) : shownEvents.length ? (
            <Timeline
              aria-label="Events of this run"
              timeWidth={72}
              items={shownEvents.map((event) => ({
                key: String(event.id),
                time: clock(event.at),
                dateTime: event.at,
                tone: event.code === 'level_passed' ? 'success' : EVENT_TONE[event.level],
                title: event.message,
              }))}
            />
          ) : (
            <EmptyState
              compact
              title={narrowed ? noMatch('events') : 'No events yet'}
              body={
                narrowed
                  ? undefined
                  : 'The runner reports an event when the run starts, at each level and at the end.'
              }
            />
          )
        ) : tail.isError && !tail.data ? (
          <ErrorState
            compact
            error={tail.error}
            title="Couldn’t load the log"
            onRetry={() => void tail.refetch()}
          />
        ) : !tail.data ? (
          <Skeleton kind="lines" rows={10} label="Loading the log" />
        ) : tail.data.lines.length ? (
          <div className={styles.stack}>
            <LogViewer lines={tail.data.lines} follow={follow} onFollowChange={setFollow} />
            <p className={styles.note} data-performance-block="log-note">
              The last {count(tail.data.lines.length)} of {count(tail.data.total)} lines
              {narrowed ? ' that match' : ''}.
              {active ? ' New lines are added at the end while the run goes on.' : ''}
              {tail.data.dropped ? ` ${count(tail.data.dropped)} lines could not be stored.` : ''}
            </p>
          </div>
        ) : (
          <EmptyState
            compact
            title={narrowed ? noMatch('lines') : 'No log lines yet'}
            body={narrowed ? undefined : 'Lines show here as soon as the runner sends them.'}
          />
        )}
      </div>
    </Card>
  );
}
