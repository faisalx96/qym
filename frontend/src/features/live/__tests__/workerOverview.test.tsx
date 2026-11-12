import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import {
  liveWorkerRead,
  liveWorkerWaiting,
  liveWorkerPending,
  liveWorkerPaused,
  liveWorkerFailed,
  liveWorkerEvents,
} from '@/features/dev/liveFixtures';
import { formatTableDate } from '@/lib/dates';
import { setup, writes, openField, refetchWorker, source } from './workerHarness';

// Live worker page: status, problems and the settings form state.
vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));

it('renders status, problems, jobs and settings in the specified DOM order', async () => {
  const { container } = setup();
  await screen.findByRole('button', { name: 'Save as v4' });
  expect(
    [
      ...container.querySelectorAll('[data-live-block^="worker-"]:not([data-live-block="worker-history"])'),
    ].map((node) => node.getAttribute('data-live-block')),
  ).toEqual(['worker-status', 'worker-problems', 'worker-jobs', 'worker-settings']);
  expect(screen.getByText('Running v3')).toBeVisible();
  expect(await openField('Models', 'Judge A')).toHaveAttribute('list');
});
it('shows waiting state, key warning and waiting section tags', async () => {
  setup(liveWorkerWaiting);
  expect(await screen.findByText('Waiting')).toBeVisible();
  expect(screen.getByText('no settings version')).toBeVisible();
  expect(screen.getAllByText('Waiting for version 1')).toHaveLength(5);
  expect(screen.getByText('Choose the worker key before saving settings')).toBeVisible();
});
it('shows the status strip values and matching job update from the fixture', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T14:22:00Z'));
  setup();
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(within(status).getByText('Running v3')).toBeVisible();
  expect(within(status).getByText(`since ${formatTableDate('2026-11-03T14:20:00Z')} by Ali`)).toBeVisible();
  expect(within(status).getByText('3m ago')).toBeVisible();
  expect(within(status).getByText('every 60s')).toBeVisible();
  expect(within(status).getByText(formatTableDate('2026-11-03T14:18:00Z'))).toBeVisible();
  expect(within(status).getByText('47 today, 44 evaluated')).toBeVisible();
  const problems = within(status).getByRole('link', { name: '19 problems in the last hour' });
  expect(problems).toHaveAttribute('href', '/projects/demo/live/worker?source=worker#problems');
  expect(within(problems).getByText('19')).not.toHaveAttribute('data-tone');
  expect(within(status).getByText('Backfill · 12 of 22 turns')).toBeVisible();
  expect(within(status).getByText('updated 2m ago')).toBeVisible();
});
it('uses the poll timestamp before the heartbeat and marks a stale worker', async () => {
  setup({
    ...liveWorkerRead,
    stale: true,
    status: { ...liveWorkerRead.status, stale: true, last_poll_at: '2026-11-03T15:19:00+01:00' },
    running: { ...liveWorkerRead.running!, reason: 'verifying version 4', job: null },
  });
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(status).toHaveTextContent(formatTableDate('2026-11-03T15:19:00+01:00'));
  expect(status).toHaveTextContent(/not reporting/i);
  expect(within(status).getByText('verifying version 4')).toBeVisible();
  expect(within(status).getByText('None')).toBeVisible();
});
it('falls back to the heartbeat when the worker has no poll timestamp', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T14:22:00Z'));
  setup({ ...liveWorkerRead, status: { ...liveWorkerRead.status, last_poll_at: null } });
  const status = await screen.findByRole('region', { name: 'Worker status' });
  expect(within(status).getByText('2m ago')).toHaveAttribute(
    'title',
    liveWorkerRead.status.last_heartbeat_at,
  );
});
it('resumes a paused worker through the state endpoint', async () => {
  const { fetch } = setup(liveWorkerPaused);
  const user = userEvent.setup();
  expect(await screen.findByText('Paused v3')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Resume evaluation' }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![0]).toContain('/state?source=');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({ state: 'running' });
});
it('collapses settings with current summaries and disables Save until values or secrets change', async () => {
  setup();
  const user = userEvent.setup();
  const save = await screen.findByRole('button', { name: 'Save as v4' });
  expect(save).toBeDisabled();
  expect(
    screen.getByText('No changes since v3', { selector: '[data-save-footer] > div:first-child > span' }),
  ).toBeVisible();
  const evaluation = screen.getByRole('region', { name: 'Evaluation' });
  const trigger = within(evaluation).getByRole('button');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveTextContent('Chart vision on · Dataiku replay on · 3 lanes · poll 60s · lookback 1h');
  expect(
    screen.getByText(`gateway listed 5 models at ${formatTableDate('2026-11-03T14:20:00Z')}`),
  ).toBeVisible();
  const running = within(screen.getByRole('list', { name: 'Settings history' })).getByText('Running');
  expect(running.closest('[data-kind="state"]')).toHaveAttribute('data-tone', 'info');
  expect(running.closest('[data-worker-version]')).toHaveAttribute('data-worker-version', '3');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'A note alone');
  expect(save).toBeDisabled();
  await user.click(trigger);
  await user.click(within(evaluation).getByRole('switch', { name: 'Chart vision' }));
  expect(trigger).toHaveTextContent('differs from running v3 · Chart vision off');
  expect(save).toBeEnabled();
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await user.click(within(evaluation).getByRole('switch', { name: 'Chart vision' }));
  expect(save).toBeDisabled();
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'replacement');
  expect(save).toBeEnabled();
  expect(within(screen.getByRole('region', { name: 'Langfuse' })).getByRole('button')).not.toHaveTextContent(
    'differs from running',
  );
});
it('keeps a draft matching running collapsed while enabling Save against the latest version', async () => {
  const view = setup();
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Note' }), 'Keep this note');
  await refetchWorker(view, liveWorkerPending);
  const save = await screen.findByRole('button', { name: 'Save as v5' });
  const database = screen.getByRole('region', { name: 'Database' });
  const trigger = within(database).getByRole('button', { name: /^Database / });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).not.toHaveTextContent('differs from running');
  expect(save).toBeEnabled();
});
it('opens a saved section that differs from running while disabling Save for unchanged values', async () => {
  const view = setup(liveWorkerPending);
  const database = await screen.findByRole('region', { name: 'Database' });
  const trigger = within(database).getByRole('button', { name: /^Database / });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).toHaveTextContent('differs from running v3 ·');
  expect(screen.getByRole('button', { name: 'Save as v5' })).toBeDisabled();
  expect(
    screen.getByText('No changes since v4', { selector: '[data-save-footer] > div:first-child > span' }),
  ).toBeVisible();
  await refetchWorker(view, {
    ...liveWorkerPending,
    running: {
      ...liveWorkerPending.running!,
      settings_version_applied: 4,
      running: liveWorkerPending.settings!.values,
    },
  });
  await waitFor(() => expect(trigger).not.toHaveTextContent('differs from running'));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
it('opens failed verification without a difference prefix when values match running', async () => {
  setup({
    ...liveWorkerRead,
    running: {
      ...liveWorkerRead.running!,
      verification: { ...liveWorkerFailed.running!.verification!, version: 3 },
    },
  });
  const database = await screen.findByRole('region', { name: 'Database' });
  const trigger = within(database).getByRole('button', { name: /^Database / });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).not.toHaveTextContent('differs from running');
  expect(trigger).not.toHaveTextContent('changed ·');
  expect(within(database).getByText(/could not translate host name/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save as v4' })).toBeDisabled();
});
it('has no running difference prefix when the worker has no running settings', async () => {
  setup(liveWorkerWaiting);
  const user = userEvent.setup();
  await user.type(await openField('Database', 'Database host'), 'new.example.com');
  expect(
    within(screen.getByRole('region', { name: 'Database' })).getByRole('button', { name: /^Database / }),
  ).not.toHaveTextContent('differs from running');
  expect(screen.getByRole('button', { name: 'Save as v1' })).toBeEnabled();
});
it('shows plain problem labels and opens the section targeted by a Fix link', async () => {
  const route = '/projects/demo/live/worker?source=worker+%26+prod&view=all';
  const view = setup(liveWorkerRead, undefined, [route]);
  await screen.findByRole('button', { name: 'Save as v4' });
  act(() => {
    view.client.setQueryData(['project', 'demo', 'live', 'worker-events', source, {}], {
      events: [
        {
          ...liveWorkerEvents[0]!,
          component: 'control',
          message: '[LIVE] Checks failed',
          details: { checks: { 'gateway.models': { ok: false } } },
        },
      ],
    });
  });
  const problems = document.getElementById('problems')!;
  await userEvent.setup().click(within(problems).getByRole('button', { name: 'Component filter' }));
  for (const label of ['Settings', 'Judges', 'Dataiku', 'Delivery to qym', 'Turns', 'Jobs'])
    expect(screen.getByRole('checkbox', { name: label })).toBeVisible();
  await userEvent.setup().keyboard('{Escape}');
  expect(await within(problems).findByText('Checks failed')).toBeVisible();
  expect(within(problems).getByText('gateway.models')).toBeVisible();
  const link = within(problems).getByRole('link', { name: 'Fix in Models' });
  expect(link).toHaveAttribute('href', `${route}#settings-models`);
  await userEvent.setup().click(link);
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Models' })).getByRole('button', {
        name: /^Models /,
      }),
    ).toHaveAttribute('aria-expanded', 'true'),
  );
  expect(screen.getByLabelText('Judge A')).toBeVisible();
  expect(screen.getByRole('link', { name: '19 problems in the last hour' })).toHaveAttribute(
    'href',
    `${route}#problems`,
  );
});
