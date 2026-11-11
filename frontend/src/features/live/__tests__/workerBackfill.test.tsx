import { act, screen } from '@testing-library/react';
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
    params: { ...liveWorkerRead.jobs[0]!.params, since_day: '2026-01-01', until_day: '2026-01-02' },
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
  });
  setRead({
    ...liveWorkerRead,
    jobs: [{ ...job, status: 'done', progress: { found: 22, skipped_existing: 2 } }],
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
  expect(await screen.findByText('22 chats, 2 already evaluated, 20 to evaluate')).toBeVisible();
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
