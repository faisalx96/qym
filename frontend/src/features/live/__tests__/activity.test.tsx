import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLiveActivity, type LiveActivity, type LiveActivityRead } from '@/api/liveWorker';
import {
  liveActivityBackfill,
  liveActivityIdle,
  liveActivityLive,
  liveActivityOldWorker,
  liveActivityQueued,
  liveActivityReevaluate,
  liveActivityStale,
  liveTurnDetail,
  liveWorkerRead,
} from '@/features/dev/liveFixtures';
import { ShellSubbarContext } from '@/features/shell/ShellSubbar';
import { ActivityLine, ActivityLineView } from '../components/ActivityLine';
import { DEFAULT_STEPS, activityView, reevaluationProgress, stepLabel } from '../lib/activity';

// The Live activity line: every state restates the worker's last report, and nothing moves between reports.
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The answer as the hook returns it: read at the server's own time, so ages are exact. */
const read = (answer: LiveActivity, later = 0): LiveActivityRead => ({
  ...answer,
  received_at: Date.parse(answer.server_time) - later,
});
const at = (answer: LiveActivity) => Date.parse(answer.server_time);
const view = (answer: LiveActivity, options?: Parameters<typeof activityView>[2]) =>
  activityView(read(answer), at(answer), options)!;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('activity line states', () => {
  it('says the live loop is idle, when it last checked and when it checks next', () => {
    expect(view(liveActivityIdle)).toMatchObject({
      state: 'idle',
      tone: 'neutral',
      shape: 'ring',
      what: 'Live evaluation',
      count: null,
      bar: null,
      detail: 'Idle, nothing to evaluate',
      freshness: 'Last check 8s ago, next in 22s',
    });
    // Past the interval there is no promise of a next check.
    expect(
      view({ ...liveActivityIdle, worker: { ...liveActivityIdle.worker, poll_interval_s: 5 } }).freshness,
    ).toBe('Last check 8s ago');
  });

  it('names the turn and the step while the live loop evaluates', () => {
    expect(view(liveActivityLive)).toMatchObject({
      state: 'live',
      tone: 'info',
      shape: 'orbit',
      what: 'Live evaluation',
      count: 'Turn 1 of 2',
      bar: { done: 0, total: 2 },
      detail: 'Judging',
      freshness: 'Updated 3s ago',
    });
  });

  it('shows a backfill with its day range, the turn, the step and the report age', () => {
    expect(
      view(liveActivityBackfill, { jobParams: { since_day: '2026-11-03', until_day: '2026-11-09' } }),
    ).toMatchObject({
      state: 'job',
      tone: 'info',
      shape: 'orbit',
      what: 'Backfill, Nov 3 – Nov 9',
      count: 'Turn 8 of 20',
      bar: { done: 7, total: 20, label: 'Turns finished' },
      detail: 'Judging',
      freshness: 'Updated 3s ago',
    });
    // The server's params win; without any range the line still names the job.
    const job = {
      ...liveActivityBackfill.job!,
      params: { since_day: '2026-11-01', until_day: '2026-11-01' },
    };
    expect(view({ ...liveActivityBackfill, job }).what).toBe('Backfill, Nov 1');
    expect(view(liveActivityBackfill).what).toBe('Backfill');
    expect(view({ ...liveActivityBackfill, job: { ...job, kind: 'backfill_preview' } })).toMatchObject({
      what: 'Preview, Nov 1',
      count: '20 turns found',
      bar: null,
    });
  });

  it('says a job is queued until the worker reports on it', () => {
    expect(view(liveActivityQueued)).toMatchObject({
      state: 'queued',
      tone: 'neutral',
      shape: 'ring',
      what: 'Backfill',
      count: null,
      detail: 'Queued, waiting for the worker',
    });
  });

  it('counts the steps of a re-evaluation and says "this turn" only on that turn', () => {
    expect(view(liveActivityReevaluate)).toMatchObject({
      state: 'job',
      what: 'Re-evaluating one turn',
      count: 'Step 4 of 5',
      bar: { done: 3, total: 5, label: 'Steps finished' },
      detail: 'Checking the SQL',
    });
    expect(view(liveActivityReevaluate, { turnId: liveTurnDetail.turn.turn_id }).what).toBe(
      'Re-evaluating this turn',
    );
    expect(view(liveActivityReevaluate, { turnId: 'another-turn' }).what).toBe('Re-evaluating one turn');
    // Picked up, no step named yet.
    const starting = {
      ...liveActivityReevaluate,
      activity: {
        ...liveActivityReevaluate.activity!,
        job: { ...liveActivityReevaluate.activity!.job!, step: null, step_index: null },
      },
    };
    expect(view(starting)).toMatchObject({ count: null, bar: null, detail: 'Starting' });
  });

  it('warns that the worker is silent and keeps its last step, with no beat', () => {
    expect(view(liveActivityStale)).toMatchObject({
      state: 'stale',
      tone: 'warning',
      shape: 'pause',
      what: 'Backfill',
      count: 'Turn 8 of 20',
      detail: 'Last step: judging',
      freshness: 'No report from the worker for 2m 5s',
      beat: null,
    });
    expect(
      view({ ...liveActivityIdle, worker: { ...liveActivityIdle.worker, stale: true, last_report_at: null } })
        .freshness,
    ).toBe('No report from the worker yet');
  });

  it('says paused and waiting plainly, with the reason when the worker gave one', () => {
    const paused = { ...liveActivityIdle.worker, state: 'paused' as const };
    expect(view({ ...liveActivityIdle, worker: paused })).toMatchObject({
      state: 'paused',
      shape: 'pause',
      what: 'Evaluation paused',
      detail: null,
    });
    expect(view({ ...liveActivityBackfill, worker: paused }).detail).toBe(
      'The backfill waits until evaluation resumes',
    );
    expect(view({ ...liveActivityIdle, worker: { ...paused, reason: 'توقف مؤقت للصيانة' } }).detail).toBe(
      'توقف مؤقت للصيانة',
    );
    expect(
      view({
        ...liveActivityIdle,
        worker: { ...liveActivityIdle.worker, state: 'waiting', reason: 'verifying version 4' },
      }),
    ).toMatchObject({
      state: 'waiting',
      shape: 'ring',
      what: 'Worker is waiting',
      detail: 'verifying version 4',
    });
  });

  it('falls back to the state and the job counters for a worker that reports no activity', () => {
    expect(view(liveActivityOldWorker)).toMatchObject({
      state: 'job',
      what: 'Backfill',
      // No current turn is known, only what is finished.
      count: '7 of 20 turns done',
      bar: { done: 7, total: 20 },
      detail: null,
    });
    expect(view({ ...liveActivityOldWorker, job: null })).toMatchObject({
      state: 'idle',
      tone: 'info',
      shape: 'orbit',
      detail: 'Running',
      freshness: 'Last check 8s ago, next in 22s',
    });
  });

  it('reads a step the worker jumped over as done, never as stuck', () => {
    // This turn has no chart: the worker reports fetch, then judge, and never names the chart step.
    const jumped = {
      ...liveActivityReevaluate,
      activity: {
        ...liveActivityReevaluate.activity!,
        job: { ...liveActivityReevaluate.activity!.job!, step: 'judge', step_index: 3 },
      },
    };
    const progress = reevaluationProgress(read(jumped), at(jumped), { turnId: liveTurnDetail.turn.turn_id });
    expect(progress.steps.map((step) => [step.key, step.state])).toEqual([
      ['fetch', 'done'],
      ['chart', 'done'],
      ['judge', 'now'],
      ['sql', 'next'],
      ['save', 'next'],
    ]);
    expect(progress.count).toBe('Step 3 of 5');
    expect(view(jumped)).toMatchObject({
      count: 'Step 3 of 5',
      bar: { done: 2, total: 5 },
      detail: 'Judging',
    });
  });

  it('uses the usual order only for a queued job with no report, and the reported order ever after', () => {
    const target = { turnId: liveTurnDetail.turn.turn_id };
    expect(DEFAULT_STEPS).toEqual(['fetch', 'chart', 'judge', 'sql', 'save']);
    expect(reevaluationProgress(undefined, 0, { ...target, queued: true }).steps.map((s) => s.key)).toEqual(
      DEFAULT_STEPS,
    );
    const silent = read({ ...liveActivityQueued, activity: null });
    expect(
      reevaluationProgress(silent, at(liveActivityQueued), { ...target, queued: true }).steps.map(
        (s) => s.state,
      ),
    ).toEqual(['next', 'next', 'next', 'next', 'next']);
    // Running with nothing reported: no order is invented.
    expect(reevaluationProgress(silent, at(liveActivityQueued), target).steps).toEqual([]);
    // The worker's own order wins over the usual one.
    const reordered = read({
      ...liveActivityQueued,
      activity: { steps: ['fetch', 'judge', 'save'], live: null, job: null },
    });
    expect(
      reevaluationProgress(reordered, at(liveActivityQueued), { ...target, queued: true }).steps.map(
        (s) => s.key,
      ),
    ).toEqual(['fetch', 'judge', 'save']);
  });

  it('draws steps in the reported order and tolerates a name it does not know', () => {
    expect(stepLabel('sql')).toBe('Checking the SQL');
    expect(stepLabel('privacy_scan')).toBe('Privacy scan');
    const odd = {
      ...liveActivityBackfill,
      activity: {
        steps: ['fetch', 'privacy_scan', 'save'],
        live: null,
        job: {
          ...liveActivityBackfill.activity!.job!,
          step: 'privacy_scan',
          step_index: null,
          step_count: null,
        },
      },
    };
    expect(view(odd).detail).toBe('Privacy scan');
    expect(
      reevaluationProgress(
        read({
          ...liveActivityReevaluate,
          activity: {
            steps: ['fetch', 'privacy_scan', 'save'],
            live: null,
            job: {
              ...liveActivityReevaluate.activity!.job!,
              step: 'privacy_scan',
              step_index: null,
              step_count: null,
            },
          },
        }),
        at(liveActivityReevaluate),
        { turnId: liveTurnDetail.turn.turn_id },
      ),
    ).toMatchObject({
      count: 'Step 2 of 3',
      steps: [
        { key: 'fetch', label: 'Downloading the trace', state: 'done' },
        { key: 'privacy_scan', label: 'Privacy scan', state: 'now' },
        { key: 'save', label: 'Saving the verdict', state: 'next' },
      ],
    });
  });

  it('reads ages on the server clock, whatever the viewer clock says', () => {
    // The answer arrived 4 seconds ago on a viewer clock that is an hour ahead.
    const skewed = at(liveActivityIdle) + 3_600_000;
    expect(activityView({ ...liveActivityIdle, received_at: skewed - 4000 }, skewed, {})!.freshness).toBe(
      'Last check 12s ago, next in 18s',
    );
  });

  it('returns nothing for a body that does not describe a worker', () => {
    expect(activityView({ received_at: 0 } as unknown as LiveActivityRead, 0)).toBeNull();
  });
});

describe('activity line', () => {
  it('renders one labelled line with the mark, the reported bar and no live region for the ticking text', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(liveActivityBackfill.server_time));
    render(<ActivityLineView read={read(liveActivityBackfill)} />);
    const line = screen.getByRole('region', { name: 'Worker activity' });
    expect(line).toHaveAttribute('data-state', 'job');
    expect(within(line).getByText('Backfill').closest('[data-shape]')).toHaveAttribute('data-shape', 'orbit');
    expect(within(line).getByText('Turn 8 of 20')).toBeVisible();
    const bar = within(line).getByRole('progressbar', { name: 'Turns finished' });
    expect(bar).toHaveAttribute('aria-valuenow', '7');
    expect(bar).toHaveAttribute('aria-valuemax', '20');
    expect((bar.firstElementChild as HTMLElement).style.inlineSize).toBe('35%');
    expect(within(line).getByText('Judging')).toBeVisible();
    const fresh = within(line).getByText('Updated 3s ago');
    // The age is plain text: only the state sentence is announced, and it carries no number that ticks.
    expect(fresh.closest('[role="status"]')).toBeNull();
    expect(within(line).getByRole('status')).toHaveTextContent('Backfill. Running.');
  });

  it('shows the silent worker in the warning tone', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(liveActivityStale.server_time));
    render(<ActivityLineView read={read(liveActivityStale)} />);
    const line = screen.getByRole('region', { name: 'Worker activity' });
    expect(line).toHaveAttribute('data-state', 'stale');
    expect(line).toHaveAttribute('data-tone', 'warning');
    expect(within(line).getByText('No report from the worker for 2m 5s')).toBeVisible();
    expect(within(line).getByText('Last step: judging')).toBeVisible();
    expect(within(line).getByRole('status')).toHaveTextContent('The worker is not reporting.');
  });

  it('flashes the mark once when a new report arrives and never without one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(liveActivityBackfill.server_time));
    const first = read(liveActivityBackfill);
    const { container, rerender } = render(<ActivityLineView read={first} />);
    const mark = () => container.querySelector('[data-shape]')!.parentElement!;
    expect(mark()).not.toHaveAttribute('data-changed');
    // The same report read again: nothing happens.
    rerender(<ActivityLineView read={{ ...first }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mark()).not.toHaveAttribute('data-changed');
    rerender(
      <ActivityLineView
        read={{ ...first, worker: { ...first.worker, last_report_at: '2026-11-03T14:20:07Z' } }}
      />,
    );
    await waitFor(() => expect(mark()).toHaveAttribute('data-changed'));
    await waitFor(() => expect(mark()).not.toHaveAttribute('data-changed'), { timeout: 2000 });
  });

  it('keeps the frame while loading and says so when the activity cannot be read', () => {
    const { rerender } = render(<ActivityLineView read={undefined} />);
    const line = screen.getByRole('region', { name: 'Worker activity' });
    expect(line).toHaveAttribute('aria-busy', 'true');
    expect(line).toBeEmptyDOMElement();
    rerender(<ActivityLineView read={undefined} failed />);
    expect(screen.getByText('Worker activity is not available')).toBeVisible();
  });

  it('reads the activity for the source, takes the day range from the loaded worker page and fills the shell strip', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(liveActivityBackfill.server_time));
    const fetch = vi.fn<(input: string) => Promise<Response>>(async () => response(liveActivityBackfill));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    client.setQueryData(['project', 'demo', 'live', 'worker', 'worker', 20], liveWorkerRead);
    const slot = document.createElement('div');
    document.body.append(slot);
    const { container } = render(
      <QueryClientProvider client={client}>
        <ShellSubbarContext.Provider value={slot}>
          <ActivityLine slug="demo" source="worker" />
        </ShellSubbarContext.Provider>
      </QueryClientProvider>,
    );
    const line = await within(slot).findByRole('region', { name: 'Worker activity' });
    await within(line).findByText('Backfill, Nov 1 – Nov 2');
    // In the shell the line lives in the strip under the topbar, not in the page.
    expect(container).toBeEmptyDOMElement();
    const url = new URL(fetch.mock.calls[0]![0], 'http://localhost');
    expect(url.pathname).toBe('/api/projects/demo/live/worker/activity');
    expect(url.searchParams.get('source')).toBe('worker');
    slot.remove();
  });

  it('polls every five seconds and not at all while the tab is hidden', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<(input: string) => Promise<Response>>(async () => response(liveActivityIdle));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.push(client);
    const { unmount } = renderHook(() => useLiveActivity('demo', 'worker'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4998);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
    unmount();
  });
});
