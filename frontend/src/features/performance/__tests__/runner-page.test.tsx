import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { PerformanceRunnerEvents, PerformanceRunnerRead } from '@/api/performance';
import {
  performanceRunnerEvents,
  performanceRunnerEventsSilent,
  performanceRunnerRead,
  performanceRunnerReadSilent,
} from '@/features/dev/performanceFixtures';
import { RunnerPage } from '../RunnerPage';
import {
  block,
  inOrder,
  reads,
  refusal,
  response,
  setup,
  switchedOff,
  writes,
  type Role,
} from './areaHarness';

// The Runner page: status, the key that receives the tokens, how to connect one, its problems and notes.
function open(
  read: PerformanceRunnerRead | (() => Response),
  options: {
    role?: Role;
    path?: string;
    events?: PerformanceRunnerEvents;
    write?: Parameters<typeof setup>[1]['server']['write'];
  } = {},
) {
  return setup(<RunnerPage slug="demo" />, {
    role: options.role,
    path: options.path ?? '/projects/demo/performance/runner',
    server: {
      reads: {
        '/runner': typeof read === 'function' ? read : () => read,
        '/runner/events': () => options.events ?? performanceRunnerEvents,
      },
      write: options.write,
    },
  });
}

const keySelect = () => within(block('runner-key')!).getByRole('button', { name: /API key/ });
const save = () => within(block('runner-key')!).getByRole('button', { name: 'Save' });

it('shows a connected runner: four stats, ten facts, the key it uses, how to connect, its notes', async () => {
  open(performanceRunnerRead);
  // The loading frame draws the same card with skeleton values: wait for the read.
  await screen.findByText('Idle, ready for a run');
  const status = screen.getByRole('region', { name: 'Status' });
  expect(document.title).toContain('Runner · Performance');
  inOrder(status.textContent ?? '', [
    'Runner',
    'Connected',
    'Doing',
    'Idle, ready for a run',
    'Last report',
    '8s ago',
    'Problems in the last hour',
    '0',
  ]);
  expect(
    within(status)
      .getAllByRole('term')
      .map((term) => term.textContent),
  ).toEqual([
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
  ]);
  expect(status).toHaveTextContent('after 2m of silence');
  expect(screen.queryByTestId('performance-runner-notice')).toBeNull();

  expect(keySelect()).toHaveTextContent('Performance runner · qym_7f3a');
  expect(within(block('runner-key')!).getByText('The runner uses this key')).toBeInTheDocument();
  expect(save()).toBeDisabled();
  expect(save()).toHaveAccessibleDescription('No changes to save');

  const connect = block('runner-connect')!;
  expect(connect).toHaveTextContent(performanceRunnerRead.connect.project_id);
  expect(connect).toHaveTextContent(performanceRunnerRead.connect.runner_path);
  expect(within(connect).getByRole('button', { name: 'Copy the project id' })).toBeInTheDocument();
  expect(within(connect).getByRole('button', { name: 'Copy the address path' })).toBeInTheDocument();

  const table = await within(block('runner-events')!).findByRole('grid', { name: 'Problems and notes' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim())
      .filter(Boolean),
  ).toEqual(['When', 'Level', 'What happened', 'Reported by', 'Run']);
});

it('says a silent runner is not reporting, and does not guess what it does', async () => {
  const view = open(performanceRunnerReadSilent, { events: performanceRunnerEventsSilent });
  const notice = await screen.findByTestId('performance-runner-notice');
  expect(notice).toHaveTextContent(/^Not reporting\./);
  expect(notice).toHaveTextContent('has not reported for 6m 12s');
  expect(notice).toHaveTextContent('ended after 2m of silence');
  const status = screen.getByRole('region', { name: 'Status' });
  expect(status).toHaveTextContent('Not connected');
  expect(status).toHaveTextContent('Unknown');
  expect(
    await screen.findByText('Run 24 was ended: the runner had not reported for 120s.'),
  ).toBeInTheDocument();
  expect(Object.fromEntries(reads(view.fetch, '/runner/events')[0]!)).toEqual({ limit: '10', page: '1' });
});

it('says a runner is not reporting as soon as it stops counting as connected, before a run would end', async () => {
  open({
    ...performanceRunnerRead,
    runner: { ...performanceRunnerRead.runner!, fresh: false, stale: false, seconds_since_heartbeat: 45 },
  });
  const notice = await screen.findByTestId('performance-runner-notice');
  expect(notice).toHaveTextContent(/^Not reporting\./);
  expect(notice).toHaveTextContent('has not reported for 45s');
  expect(notice).toHaveTextContent('If the silence reaches 2m, a run in progress is ended');
  expect(notice).not.toHaveTextContent('is ended after 2m of silence');
  expect(screen.getByRole('region', { name: 'Status' })).toHaveTextContent('Not connected');
});

it('says no runner is connected yet and still shows the key and how to connect one', async () => {
  open({ ...performanceRunnerRead, runner: null }, { events: { events: [], total: 0, page: 1, limit: 10 } });
  expect(await screen.findByRole('heading', { name: 'No runner is connected yet' })).toBeInTheDocument();
  expect(block('runner-status')).toBeNull();
  expect(block('runner-key')).not.toBeNull();
  expect(block('runner-connect')).not.toBeNull();
  expect(await screen.findByText('No problems or notes yet')).toBeInTheDocument();
});

it('saves the key a manager chose', async () => {
  const view = open(performanceRunnerRead, {
    write: () => response({ runner_key: { id: 'key-2', name: 'Live worker', prefix: 'qym_b840' } }),
  });
  const user = userEvent.setup();
  await screen.findByRole('region', { name: 'Runner key' });
  await user.click(keySelect());
  await user.click(await screen.findByRole('option', { name: 'Live worker · qym_b840' }));
  // The tag speaks of the saved key: it goes while the choice is not saved.
  expect(screen.queryByText('The runner uses this key')).toBeNull();
  expect(save()).toBeEnabled();
  await user.click(save());
  await waitFor(() => expect(writes(view.fetch)).toEqual([['PUT', '/runner/key', { api_key_id: 'key-2' }]]));
});

it('shows a refused key change in the words of the answer and reads the page again', async () => {
  const view = open(performanceRunnerRead, {
    write: () =>
      refusal(409, 'runner_busy', 'Run 24 is in progress. Change the key when it has ended.', {
        run_id: 'run-0024',
      }),
  });
  const user = userEvent.setup();
  await screen.findByRole('region', { name: 'Runner key' });
  const before = reads(view.fetch, '/runner').length;
  await user.click(keySelect());
  await user.click(await screen.findByRole('option', { name: 'Evaluation service · qym_19c2' }));
  await user.click(save());
  const shown = await screen.findByTestId('performance-runner-key-refusal');
  expect(shown).toHaveTextContent(/^Not saved\./);
  expect(shown).toHaveTextContent('Run 24 is in progress. Change the key when it has ended.');
  await waitFor(() => expect(reads(view.fetch, '/runner').length).toBeGreaterThan(before));
});

it('shows a person who is not a manager the chosen key, with the choice and Save locked and the reason', async () => {
  open({ ...performanceRunnerRead, api_keys: [], can_manage: false }, { role: 'member' });
  await screen.findByText('The runner uses this key');
  const card = screen.getByRole('region', { name: 'Runner key' });
  expect(keySelect()).toHaveTextContent('Performance runner · qym_7f3a');
  expect(keySelect()).toBeDisabled();
  expect(save()).toBeDisabled();
  expect(save()).toHaveAccessibleDescription('Only a project manager can choose the runner key');
  expect(card.querySelector('[data-performance-key="chosen"]')).toHaveTextContent(/^Chosen .+ by /);
});

it('says plainly that the area is switched off, without an error or Retry', async () => {
  open(switchedOff);
  expect(await screen.findByText('Performance tests are switched off')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
  expect(block('runner-key')).toBeNull();
});

it('reads the search and the level from the address, searches first in the bar, and clears both at once', async () => {
  const view = open(performanceRunnerRead, {
    path: '/projects/demo/performance/runner?q=sign-in&level=error',
  });
  await screen.findByText('Idle, ready for a run');
  await waitFor(() =>
    expect(reads(view.fetch, '/runner/events').some((query) => query.get('q') === 'sign-in')).toBe(true),
  );
  const narrowed = reads(view.fetch, '/runner/events').find((query) => query.get('q') === 'sign-in')!;
  expect(narrowed.getAll('level')).toEqual(['error']);
  const events = block('runner-events')!;
  const search = within(events).getByRole('searchbox', { name: 'Search problems and notes' });
  expect(search).toHaveValue('sign-in');
  const bar = events.querySelector('[data-dt-toolbar]')!;
  expect(bar.querySelector('input')).toBe(search);
  expect(within(events).getByRole('button', { name: 'Clear 2 filters' })).toBeInTheDocument();
});
