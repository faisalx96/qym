/** Runner page: is the runner connected, what it does, and the facts it reported about itself. */
import type { PerformanceRunnerRead, PerformanceRunnerStatus } from '@/api/performance';
import { formatTableDate } from '@/lib/dates';
import { Card, CardTitle, KeyValueGrid, Skeleton, StatStrip, StateTag, type StatStripItem } from '@/ui';
import { count, span } from '../../lib/format';
import { lastReport } from '../home/RunnerLine';
import styles from './runner.module.css';

/** What the runner is busy with, as far as the last read knows. */
function doing(read: PerformanceRunnerRead, runner: PerformanceRunnerStatus): string {
  if (!runner.fresh) return 'Unknown';
  const active = read.active_run;
  if (runner.reported_state === 'idle' || (runner.reported_state === null && !active))
    return 'Idle, ready for a run';
  if (!active) return 'Running a run';
  if (runner.reported_state === 'preflight') return `Getting run ${active.number} ready`;
  if (runner.reported_state === 'stopping') return `Stopping run ${active.number}`;
  if (runner.reported_state === 'finishing') return `Finishing run ${active.number}`;
  return `Running run ${active.number}`;
}

const STATE_LABELS = ['Runner', 'Doing', 'Last report', 'Problems in the last hour'] as const;
const FACT_LABELS = [
  'Name',
  'Runs in',
  'Host',
  'Runner version',
  'Test suite version',
  'Connected since',
  'Counts as connected',
  'A run is ended',
  'A queued run waits',
  'A late result is taken',
] as const;

/** A phrase in a stat value is sans with tabular figures; only a bare id or value stays mono (§1). */
const words = (text: string) => <span className={styles.words}>{text}</span>;

/** The status while the page loads: the same card, strip and facts with skeleton values (§7). */
export function StatusFrame() {
  const pending = (label: string) => <Skeleton kind="value" label={`Loading: ${label}`} />;
  return (
    <Card
      as="section"
      aria-label="Status"
      header={<CardTitle title="Status" />}
      data-performance-block="runner-status"
    >
      <div className={styles.stack}>
        <StatStrip
          variant="compact"
          pairs
          aria-label="Runner status"
          items={STATE_LABELS.map((label) => ({
            key: label,
            label,
            // The state is a tag; the other values are one line of the value's own type.
            value: (
              <Skeleton
                kind="value"
                height={label === 'Runner' ? 'var(--badge-height)' : '1lh'}
                label={`Loading: ${label}`}
              />
            ),
          }))}
        />
        <div className={styles.rule}>
          <KeyValueGrid
            columns={4}
            aria-label="About the runner"
            items={FACT_LABELS.map((label) => ({ key: label, label, value: pending(label) }))}
          />
        </div>
      </div>
    </Card>
  );
}

export function StatusCard({
  read,
  runner,
}: {
  read: PerformanceRunnerRead;
  runner: PerformanceRunnerStatus;
}) {
  const limits = read.settings;
  const problems = runner.errors_last_hour;
  // The runner's state line is a compact StatStrip, as the Live worker's (D4): Problems turns orange above 0 (Q13).
  const state: StatStripItem[] = [
    {
      key: 'runner',
      label: 'Runner',
      value: (
        <StateTag tone={runner.fresh ? 'success' : 'danger'}>
          {runner.fresh ? 'Connected' : 'Not connected'}
        </StateTag>
      ),
    },
    { key: 'doing', label: 'Doing', value: words(doing(read, runner)) },
    { key: 'last', label: 'Last report', value: words(lastReport(runner)) },
    {
      key: 'problems',
      label: 'Problems in the last hour',
      value: count(problems),
      tone: problems > 0 ? 'warning' : undefined,
    },
  ];
  return (
    <Card
      as="section"
      aria-label="Status"
      header={<CardTitle title="Status" />}
      data-performance-block="runner-status"
    >
      <div className={styles.stack}>
        <StatStrip variant="compact" pairs aria-label="Runner status" items={state} />
        <div className={styles.rule}>
          <KeyValueGrid
            columns={4}
            aria-label="About the runner"
            items={[
              // A runner's name is a name, not an id: sans (§1).
              { key: 'name', label: 'Name', value: runner.name },
              { key: 'location', label: 'Runs in', value: runner.info.location ?? '–' },
              { key: 'host', label: 'Host', value: runner.info.host ?? '–', mono: true },
              {
                key: 'version',
                label: 'Runner version',
                value: runner.info.runner_version ?? '–',
                mono: true,
              },
              {
                key: 'suite',
                label: 'Test suite version',
                value: runner.info.suite_commit ?? '–',
                mono: true,
              },
              {
                key: 'since',
                label: 'Connected since',
                value: runner.registered_at ? formatTableDate(runner.registered_at) : '–',
              },
              {
                key: 'fresh',
                label: 'Counts as connected',
                value: `while it reported within ${span(limits.fresh_within_s)}`,
              },
              {
                key: 'stale',
                label: 'A run is ended',
                value: `after ${span(limits.stale_after_s)} of silence`,
              },
              {
                key: 'queue',
                label: 'A queued run waits',
                value: `up to ${span(limits.queue_timeout_s)}`,
              },
              {
                key: 'late',
                label: 'A late result is taken',
                value: `up to ${span(limits.late_window_s)} after the end`,
              },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}
