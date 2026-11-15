import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { type LiveJob } from '@/api/liveWorker';
import { liveWorkerRead } from '@/features/dev/liveFixtures';
import { setup, writes, openRange, dates, source, response } from './workerHarness';

// Live worker page: the backfill dialog.
vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));

it('opens the date range dialog from the page header', async () => {
  setup();
  const buttons = await screen.findAllByRole('button', { name: 'Backfill a day range' });
  expect(buttons).toHaveLength(1);
  await userEvent.setup().click(buttons[0]!);
  expect(screen.getByRole('dialog', { name: 'Backfill these days?' })).toBeVisible();
});
it.each([
  ['2026-01-01', '2026-02-02', 'At most 31 days per job'],
  ['2099-01-01', '2099-01-01', 'The end day is in the future'],
  ['2026-01-02', '2026-01-01', 'The end day is before the start day'],
  ['', '', 'Choose both days'],
])('validates dates without requests: %s to %s', async (since, until, message) => {
  const { fetch } = setup();
  const user = await openRange();
  dates(since, until);
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(writes(fetch)).toHaveLength(0);
});
it('validates limit without sending a request', async () => {
  const { fetch } = setup();
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  const limit = screen.getByRole('textbox', { name: 'Limit' });
  await user.clear(limit);
  await user.type(limit, '2001');
  await user.tab();
  await user.click(screen.getByRole('button', { name: 'Run backfill' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Limit must be 1 to 2,000');
  expect(writes(fetch)).toHaveLength(0);
});
it('previews and displays the result when the next refetch completes the job', async () => {
  const job: LiveJob = {
    ...liveWorkerRead.jobs[0]!,
    id: 'preview-new',
    kind: 'backfill_preview',
    status: 'queued',
    params: {
      ...liveWorkerRead.jobs[0]!.params,
      since_day: '2026-01-01',
      until_day: '2026-01-02',
      redo: ['failed'],
    },
    progress: {},
  };
  const { fetch, client, setRead } = setup(liveWorkerRead, () => response(job, 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByText('Preview queued')).toBeVisible();
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({
    kind: 'backfill_preview',
    since_day: '2026-01-01',
    until_day: '2026-01-02',
    limit: 200,
    redo: ['failed'],
  });
  setRead({
    ...liveWorkerRead,
    jobs: [{ ...job, status: 'done', progress: { found: 22, skipped_existing: 2 } }],
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  expect(
    await within(screen.getByRole('dialog')).findByText('22 turns, 2 already evaluated, 20 to evaluate'),
  ).toBeVisible();
});
it('queues a backfill, closes the dialog and toasts', async () => {
  const { fetch } = setup(liveWorkerRead, () => response(liveWorkerRead.jobs[0], 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  await user.click(screen.getByRole('button', { name: 'Run backfill' }));
  expect(await screen.findByText('Backfill queued')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body)).kind).toBe('backfill');
});

it.each([false, true])('queues a backfill with redo inconclusive=%s, closes and toasts', async (redo) => {
  const { fetch } = setup(liveWorkerRead, () => response(liveWorkerRead.jobs[0], 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  const checkbox = screen.getByRole('checkbox', { name: 'Also redo turns labelled Inconclusive' });
  expect(checkbox).not.toBeChecked();
  if (redo) await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: 'Run backfill' }));
  expect(await screen.findByText('Backfill queued')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({
    kind: 'backfill',
    since_day: '2026-01-01',
    until_day: '2026-01-02',
    limit: 200,
    redo: redo ? ['failed', 'inconclusive'] : ['failed'],
  });
});
it.each([
  ['Asia/Riyadh', true],
  ['UTC', false],
  [undefined, false],
  ['Invalid/Zone', false],
])('validates the range against the worker source today (%s)', async (zone, allowed) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T22:30:00Z'));
  const { fetch } = setup(
    { ...liveWorkerRead, status: { ...liveWorkerRead.status, day_key_timezone: zone } },
    () => response(liveWorkerRead.jobs[0], 201),
  );
  const user = await openRange();
  dates('2026-11-10', '2026-11-10');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  if (allowed) {
    await waitFor(() => expect(writes(fetch)).toHaveLength(1));
    expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toMatchObject({
      since_day: '2026-11-10',
      until_day: '2026-11-10',
    });
    expect(screen.queryByText('The end day is in the future')).toBeNull();
    dates('2026-11-11', '2026-11-11');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The end day is in the future');
    expect(writes(fetch)).toHaveLength(1);
  } else {
    expect(screen.getByRole('alert')).toHaveTextContent('The end day is in the future');
    expect(writes(fetch)).toHaveLength(0);
  }
});
it('previews the same limit and redo as Run and hides the preview when redo changes', async () => {
  const job: LiveJob = {
    ...liveWorkerRead.jobs[0]!,
    id: 'new-preview',
    kind: 'backfill_preview',
    status: 'done',
    params: {
      ...liveWorkerRead.jobs[0]!.params,
      since_day: '2026-01-01',
      until_day: '2026-01-02',
      limit: 25,
      redo: ['failed'],
    },
    progress: {
      would_evaluate: 20,
      would_redo: 5,
      skipped_existing: 10,
      beyond_limit: 15,
      limit_reached: true,
      remaining: 15,
    },
  };
  const { fetch } = setup(liveWorkerRead, () => response(job, 201));
  const user = await openRange();
  dates('2026-01-01', '2026-01-02');
  const limit = screen.getByRole('textbox', { name: 'Limit' });
  await user.clear(limit);
  await user.type(limit, '25');
  await user.tab();
  expect(
    screen.getByText('The job stops after this many turns. Preview shows how many are waiting.'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  const sentence = '20 to evaluate · 5 to redo · 10 already evaluated · 15 beyond the limit of 25';
  expect(await screen.findByText(sentence)).toBeVisible();
  expect(within(screen.getByRole('dialog')).queryByText(/Stopped at the limit/)).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Also redo turns labelled Inconclusive' }));
  expect(screen.queryByText(sentence)).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Also redo turns labelled Inconclusive' }));
  await user.click(screen.getByRole('button', { name: 'Run backfill' }));
  const [preview, run] = writes(fetch).map(
    ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
  );
  expect(preview).toEqual({
    kind: 'backfill_preview',
    since_day: '2026-01-01',
    until_day: '2026-01-02',
    limit: 25,
    redo: ['failed'],
  });
  expect(run).toEqual({ ...preview, kind: 'backfill' });
});

it.each([undefined, 0, 30])(
  'previews with the run redo and displays legacy listed=%s after refetch',
  async (listed) => {
    const job: LiveJob = {
      ...liveWorkerRead.jobs[0]!,
      id: 'preview-new',
      kind: 'backfill_preview',
      status: 'queued',
      params: {
        ...liveWorkerRead.jobs[0]!.params,
        since_day: '2026-01-01',
        until_day: '2026-01-02',
        redo: ['failed', 'inconclusive'],
      },
      progress: {},
    };
    const { fetch, client, setRead } = setup(liveWorkerRead, () => response(job, 201));
    const user = await openRange();
    dates('2026-01-01', '2026-01-02');
    await user.click(screen.getByRole('checkbox', { name: 'Also redo turns labelled Inconclusive' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Preview queued')).toBeVisible();
    expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({
      kind: 'backfill_preview',
      since_day: '2026-01-01',
      until_day: '2026-01-02',
      limit: 200,
      redo: ['failed', 'inconclusive'],
    });
    setRead({
      ...liveWorkerRead,
      jobs: [{ ...job, status: 'done', progress: { found: 22, skipped_existing: 2, listed } }],
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
    });
    expect(
      await within(screen.getByRole('dialog', { name: 'Backfill these days?' })).findByText(
        `22 turns, 2 already evaluated, 20 to evaluate${listed === undefined ? '' : ` (${listed} traces listed)`}`,
      ),
    ).toBeVisible();
  },
);
