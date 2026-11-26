/** Performance home: the runner in one line (is it connected, what it does), with the way to its page. */
import type { PerformanceHome, PerformanceRunnerStatus } from '@/api/performance';
import { performancePath } from '@/app/routes';
import { formatAgoSeconds } from '@/lib/dates';
import { Skeleton, StatStrip, StateTag, TextLink, type StatStripItem } from '@/ui';
import styles from './home.module.css';

/** What the runner is busy with, as far as the last read knows. */
type RunnerHome = {
  active_run: Pick<NonNullable<PerformanceHome['active_run']>, 'id' | 'number' | 'status'> | null;
  runs: { total: number };
};
function doing(home: RunnerHome, runner: PerformanceRunnerStatus): string {
  if (!runner.fresh) return 'Unknown';
  const active = home.active_run;
  if (active?.status === 'queued') return `Run ${active.number} is queued`;
  if (active?.status === 'stopping') return `Stopping run ${active.number}`;
  if (active) return `Running run ${active.number}`;
  return home.runs.total ? 'Idle, ready for a run' : 'Idle, ready for the first run';
}

/** The age of the last report, from the seconds the API counted (no clock of this browser is compared). */
export function lastReport(runner: PerformanceRunnerStatus): string {
  return runner.seconds_since_heartbeat === null
    ? '–'
    : formatAgoSeconds(Date.now() - runner.seconds_since_heartbeat * 1000);
}

const LABELS = ['Runner', 'Doing', 'Last report', 'Runs in', 'Version'] as const;

/** A phrase or a date in a stat value is sans with tabular figures; only a bare id or value stays mono (§1). */
function words(text: string) {
  return <span className={styles.words}>{text}</span>;
}

export function RunnerLine({
  slug,
  home,
  runner,
}: {
  slug: string;
  /** Both undefined while the page loads: the same line with skeleton values. */
  home?: RunnerHome;
  runner?: PerformanceRunnerStatus;
}) {
  const items: StatStripItem[] =
    home && runner
      ? [
          {
            key: 'Runner',
            label: 'Runner',
            value: (
              <StateTag tone={runner.fresh ? 'success' : 'danger'}>
                {runner.fresh ? 'Connected' : 'Not connected'}
              </StateTag>
            ),
          },
          { key: 'Doing', label: 'Doing', value: words(doing(home, runner)) },
          { key: 'Last report', label: 'Last report', value: words(lastReport(runner)) },
          { key: 'Runs in', label: 'Runs in', value: words(runner.info.location ?? '–') },
          { key: 'Version', label: 'Version', value: runner.info.runner_version ?? '–' },
        ]
      : LABELS.map((label) => ({
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
        }));
  return (
    <div className={styles.runnerLine} data-performance-block="runner-line">
      <StatStrip variant="compact" pairs aria-label="Runner" items={items} />
      <span className={styles.row}>
        <TextLink to={performancePath(slug, 'targets')}>Targets</TextLink>
        <TextLink to={performancePath(slug, 'runner')}>Runner</TextLink>
      </span>
    </div>
  );
}
