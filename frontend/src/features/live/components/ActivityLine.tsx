import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveActivity, type LiveActivityRead, type LiveJob, type LiveWorkerRead } from '@/api/liveWorker';
import { ShellSubbar } from '@/features/shell/ShellSubbar';
import { textDirAttrs } from '@/lib/text';
import { StatusMark, useFlashOnChange } from '@/ui';
import { activityView } from '../lib/activity';
import styles from '../activity.module.css';

/**
 * One clock for every "8s ago" on the page: it ticks once a second while the tab is visible, and the line and the
 * re-evaluation steps read the same instant, so their ages never disagree.
 */
const clock = {
  now: Date.now(),
  timer: undefined as number | undefined,
  listeners: new Set<() => void>(),
  tick() {
    clock.now = Date.now();
    clock.listeners.forEach((listener) => listener());
  },
  run() {
    window.clearInterval(clock.timer);
    clock.timer = undefined;
    if (clock.listeners.size && !document.hidden) clock.timer = window.setInterval(clock.tick, 1000);
  },
  onVisibility() {
    if (!document.hidden) clock.tick();
    clock.run();
  },
  subscribe(listener: () => void) {
    if (!clock.listeners.size) {
      clock.now = Date.now();
      document.addEventListener('visibilitychange', clock.onVisibility);
    }
    clock.listeners.add(listener);
    clock.run();
    return () => {
      clock.listeners.delete(listener);
      if (!clock.listeners.size) document.removeEventListener('visibilitychange', clock.onVisibility);
      clock.run();
    };
  },
};

/** The shared clock; only the age texts read it. */
export function useNow(): number {
  return useSyncExternalStore(clock.subscribe, () => clock.now);
}

/**
 * What the worker reports it is doing, on every Live page, in the shell's strip under the topbar. `turnId` is the
 * turn the page shows, so a re-evaluation of it reads "this turn".
 */
export function ActivityLine({ slug, source, turnId }: { slug: string; source: string; turnId?: string }) {
  const client = useQueryClient();
  const query = useLiveActivity(slug, source);
  const job = query.data?.job;
  // Follow the clock, so the range appears as soon as the worker page's read is in the cache.
  useNow();
  // The activity answer names the job without its day range; the worker page's own read has it when it is loaded.
  const jobParams =
    job && !job.params
      ? client
          .getQueriesData<Partial<LiveWorkerRead>>({ queryKey: ['project', slug, 'live', 'worker', source] })
          .flatMap(([, read]) => (Array.isArray(read?.jobs) ? read.jobs : []))
          .find((item) => item.id === job.id)?.params
      : undefined;
  return (
    <ShellSubbar>
      <ActivityLineView
        read={query.data}
        failed={query.isError && !query.data}
        turnId={turnId}
        jobParams={jobParams}
      />
    </ShellSubbar>
  );
}

/** No data hooks: the line for one answer of the activity endpoint (the app, tests and the gallery). */
export function ActivityLineView({
  read,
  failed = false,
  turnId,
  jobParams,
}: {
  read: LiveActivityRead | undefined;
  failed?: boolean;
  turnId?: string;
  jobParams?: Partial<LiveJob['params']>;
}) {
  const now = useNow();
  const view = read ? activityView(read, now, { turnId, jobParams }) : null;
  // One flash per report that arrives; a silent worker never flashes.
  const flash = useFlashOnChange(view?.beat ?? null, Boolean(view?.beat));
  if (!view) {
    return (
      <section
        className={styles.line}
        aria-label="Worker activity"
        aria-busy={failed ? undefined : true}
        data-live-block="activity-line"
        data-state={failed || read ? 'unknown' : 'loading'}
      >
        {failed || read ? <span>Worker activity is not available</span> : null}
      </section>
    );
  }
  const percent = view.bar && view.bar.total > 0 ? Math.min(100, (view.bar.done / view.bar.total) * 100) : 0;
  return (
    <section
      className={styles.line}
      aria-label="Worker activity"
      data-live-block="activity-line"
      data-state={view.state}
      data-tone={view.tone}
    >
      <span className={styles.what} data-changed={flash ? '' : undefined}>
        <StatusMark tone={view.tone} shape={view.shape} label={view.what} wrap />
      </span>
      {view.count ? (
        <span className={styles.count} data-activity-count>
          <span>{view.count}</span>
          {view.bar ? (
            <span
              className={styles.track}
              role="progressbar"
              aria-label={view.bar.label}
              aria-valuemin={0}
              aria-valuemax={view.bar.total}
              aria-valuenow={view.bar.done}
            >
              <span className={styles.fill} style={{ inlineSize: `${percent}%` }} />
            </span>
          ) : null}
        </span>
      ) : null}
      {view.detail ? (
        <span className={styles.detail} data-activity-detail {...textDirAttrs(view.detail)}>
          {view.detail}
        </span>
      ) : null}
      {view.freshness ? (
        <span className={styles.fresh} data-activity-freshness>
          {view.freshness}
        </span>
      ) : null}
      {/* Announced when the state changes, never on a tick of the clock. */}
      <span className={styles.hidden} role="status">
        {view.announce}
      </span>
    </section>
  );
}
