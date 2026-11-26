import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { PerformanceHome, PerformanceRunRow, PerformanceRunsPage } from '@/api/performance';
import {
  performanceHomeFirstRun,
  performanceHomeIdle,
  performanceHomeNoRunner,
  performanceHomeOffline,
  performanceHomeRunning,
} from '@/features/dev/performanceFixtures';
import { PerformanceHomePage } from '../PerformanceHomePage';
import { latestResult } from '../components/home/model';
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

// Home in each of its states, from the sample of the design (run 24 runs on Preprod, breaks at 50 users).
const runsPage = (rows: PerformanceRunRow[]): PerformanceRunsPage => ({
  rows,
  total: rows.length,
  page: 1,
  page_size: 25,
});

/** The runs a narrowed read asks for, by the filters of its address; the capacity block reads the same route. */
function runsOf(home: PerformanceHome) {
  return (url: URL) => {
    const tests = url.searchParams.getAll('test_type');
    const verdicts = url.searchParams.getAll('verdict');
    const target = url.searchParams.get('target');
    return runsPage(
      home.runs.rows.filter(
        (run) =>
          (!tests.length || tests.includes(run.test_type)) &&
          (!verdicts.length || (run.verdict !== null && verdicts.includes(run.verdict))) &&
          (!target || run.target.id === target),
      ),
    );
  };
}

function open(
  home: PerformanceHome | (() => Response),
  options: { role?: Role; path?: string; write?: Parameters<typeof setup>[1]['server']['write'] } = {},
) {
  const data = typeof home === 'function' ? null : home;
  return setup(<PerformanceHomePage slug="demo" />, {
    role: options.role,
    path: options.path,
    server: {
      reads: {
        '': typeof home === 'function' ? home : () => home,
        '/runs': data ? runsOf(data) : () => runsPage([]),
      },
      write: options.write,
    },
  });
}

const newRun = () => screen.getByRole('link', { name: 'New run' });

it('shows the runner, the run in progress, the capacity of its target and every run', async () => {
  const view = open(performanceHomeRunning);
  expect(await screen.findByRole('heading', { name: 'Run 24' })).toBeInTheDocument();
  expect(document.title).toContain('Performance');
  expect(screen.getByRole('heading', { level: 1, name: 'Performance' })).toBeInTheDocument();
  expect(newRun()).toHaveAttribute('href', '/projects/demo/performance/new');
  expect(newRun()).not.toHaveAttribute('aria-disabled');

  const line = block('runner-line')!;
  inOrder(line.textContent ?? '', [
    'Runner',
    'Connected',
    'Doing',
    'Running run 24',
    'Last report',
    'Runs in',
    'Version',
    'Targets',
    'Runner',
  ]);
  const links = within(line).getAllByRole('link');
  expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Targets', '/projects/demo/performance/targets'],
    ['Runner', '/projects/demo/performance/runner'],
  ]);

  const card = block('active-run')!;
  expect(within(card).getByRole('link', { name: 'Run 24' })).toHaveAttribute(
    'href',
    '/projects/demo/performance/runs/run-0024',
  );
  // The title opens the run: no Open button beside it (Q07 B).
  expect(within(card).queryByRole('link', { name: 'Open run' })).toBeNull();
  expect(within(card).getByRole('button', { name: 'Stop run' })).toBeEnabled();
  inOrder(card.textContent ?? '', [
    'Breakpoint on Preprod',
    'Level now',
    '30',
    'of 60 users',
    'next level in 3m 30s',
    'p95 so far',
    '87.5s',
    'of 180s',
    '49% of the time limit',
    'Answered',
    '99.6%',
    '447 of 449 questions',
    'Time left',
    '28m 30s',
    '21m 30s in',
  ]);
  expect(within(card).getByText('Measuring now')).toBeInTheDocument();

  const capacity = block('capacity')!;
  expect(within(capacity).getByRole('radio', { name: 'Preprod' })).toBeChecked();
  await waitFor(() => expect(capacity).toHaveTextContent('Recommended maximum'));
  inOrder(capacity.textContent ?? '', [
    'Safe load',
    'Breaks at',
    'Recommended maximum',
    'p95 at the safe load',
    'Measured',
  ]);
  expect(document.querySelector('[data-performance-plot="Capacity over time"]')).not.toBeNull();

  const table = within(block('runs')!).getByRole('grid', { name: 'Runs' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim())
      .filter(Boolean),
  ).toEqual([
    'Run',
    'Started',
    'Test',
    'Target',
    'Questions',
    'Result',
    'Safe load',
    'Breaks at',
    'p95',
    'Length',
    'By',
  ]);
  const live = document.querySelector('[data-performance-run="24"]')!;
  expect(live).toHaveTextContent('level 30 of 60');
  // The first page of the history comes with the Home read: no separate runs read for it.
  expect(reads(view.fetch, '/runs').filter((query) => !query.has('verdict'))).toHaveLength(0);
});

it('shows the result tag alone for a finished run, and the step first for a run that ended otherwise', async () => {
  open(performanceHomeIdle);
  const row = (number: number) => document.querySelector<HTMLElement>(`[data-performance-run="${number}"]`)!;
  // The loading frame already draws the table: wait for its rows.
  await waitFor(() => expect(row(22)).not.toBeNull());
  expect(block('active-run')).toBeNull();
  expect(row(22)).toHaveTextContent('Breaks at 50 users');
  expect(row(22).querySelector('[data-performance-status]')).toBeNull();
  // Run 17 was stopped and still has a result: its step, then the tag.
  expect(row(17).querySelector('[data-performance-status]')).not.toBeNull();
  expect(row(17)).toHaveTextContent(/Stopped.*No break up to/);
  expect(block('runner-line')).toHaveTextContent('Idle, ready for a run');
});

it('opens with no runner: one empty state with the way to the Runner page, and New run locked', async () => {
  open(performanceHomeNoRunner);
  expect(await screen.findByRole('heading', { name: 'No runner is connected yet' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open the Runner page' })).toHaveAttribute(
    'href',
    '/projects/demo/performance/runner',
  );
  expect(newRun()).toHaveAttribute('aria-disabled', 'true');
  expect(newRun()).toHaveAccessibleDescription('No runner is connected yet');
  for (const name of ['runner-line', 'active-run', 'capacity', 'runs', 'first-run'])
    expect(block(name), name).toBeNull();
});

it('keeps the history while the runner is silent, and locks every way to a new run', async () => {
  open(performanceHomeOffline);
  const notice = await screen.findByTestId('performance-runner-notice');
  expect(notice).toHaveTextContent(/^Not connected\./);
  expect(notice).toHaveTextContent('has not reported for 6m 12s');
  expect(notice).toHaveTextContent('A run in progress is ended and cannot continue.');
  expect(newRun()).toHaveAccessibleDescription('The runner is not connected');
  const again = within(block('capacity')!).getByRole('link', { name: 'Run on this target' });
  expect(again).toHaveAttribute('aria-disabled', 'true');
  expect(again).toHaveAccessibleDescription('The runner is not connected');
  expect(block('runner-line')).toHaveTextContent('Not connected');
  expect(block('runner-line')).toHaveTextContent('Unknown');
  expect(screen.getByRole('grid', { name: 'Runs' })).toBeInTheDocument();
});

it('says the runner is not connected from the moment it stops counting as connected, before a run would end', async () => {
  const runner = { ...performanceHomeIdle.runner!, fresh: false, stale: false, seconds_since_heartbeat: 45 };
  open({ ...performanceHomeIdle, runner });
  const notice = await screen.findByTestId('performance-runner-notice');
  expect(notice).toHaveTextContent(/^Not connected\./);
  expect(notice).toHaveTextContent('has not reported for 45s');
  expect(notice).not.toHaveTextContent('is ended');
  expect(newRun()).toHaveAccessibleDescription('The runner is not connected');
});

it('opens a project with no run yet on the three steps, without the capacity block or the table', async () => {
  open(performanceHomeFirstRun);
  const card = await screen.findByRole('region', { name: 'First run' });
  expect(within(card).getByRole('heading', { name: 'No runs yet' })).toBeInTheDocument();
  expect(within(card).getAllByRole('listitem')).toHaveLength(3);
  // The header's New run is the one action: the card does not repeat it.
  expect(within(card).queryByRole('link')).toBeNull();
  expect(newRun()).not.toHaveAttribute('aria-disabled');
  expect(block('capacity')).toBeNull();
  expect(block('runs')).toBeNull();
});

it('reads a narrowed list from the address and says what it was filtered from', async () => {
  const view = open(performanceHomeIdle, {
    path: '/projects/demo/performance?test=breakpoint&target=target-preprod',
  });
  await waitFor(() => expect(document.querySelectorAll('[data-performance-run]').length).toBeGreaterThan(0));
  const narrowed = reads(view.fetch, '/runs').filter((query) => !query.has('verdict'));
  expect(narrowed).toHaveLength(1);
  expect(Object.fromEntries(narrowed[0]!)).toEqual({
    page: '1',
    page_size: '25',
    target: 'target-preprod',
    test_type: 'breakpoint',
  });
  const numbers = [...document.querySelectorAll('[data-performance-run]')].map((row) =>
    row.getAttribute('data-performance-run'),
  );
  expect(numbers).toEqual(['22', '21', '20', '18', '16']);
  expect(screen.getByText('Filtered from 11 runs')).toBeInTheDocument();
  // The one clear of the bar counts both filters; the list says it keeps itself up to date.
  expect(screen.getByRole('button', { name: 'Clear 2 filters' })).toBeInTheDocument();
  expect(within(block('runs')!).getByText('Updates automatically')).toBeInTheDocument();
});

it('reads the capacity target from the address (?capacity=)', async () => {
  open(performanceHomeRunning, { path: '/projects/demo/performance?capacity=target-production' });
  expect(await screen.findByRole('radio', { name: 'Production' })).toBeChecked();
  expect(within(block('capacity')!).getByRole('radio', { name: 'Preprod' })).not.toBeChecked();
});

it('stops the run in progress with the reason that was typed', async () => {
  const view = open(performanceHomeRunning, {
    write: () => response({ run: { id: 'run-0024', status: 'stopping' } }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Stop run' }));
  const dialog = await screen.findByRole('dialog', { name: 'Stop this run?' });
  expect(dialog).toHaveTextContent('Run 24 is 21m 30s in and is measuring 30 users.');
  expect(dialog).toHaveTextContent('10 and 20 users passed');
  await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Wrong dataset');
  await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(view.fetch)).toEqual([['POST', '/runs/run-0024/stop', { reason: 'Wrong dataset' }]]);
});

it('keeps a refused stop in the dialog, in the words of the answer, and reads the page again', async () => {
  const view = open(performanceHomeRunning, {
    write: () => refusal(409, 'run_not_active', 'Run 24 has already ended. Nothing was stopped.'),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Stop run' }));
  const dialog = await screen.findByRole('dialog', { name: 'Stop this run?' });
  const before = reads(view.fetch, '').length;
  await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Run 24 has already ended. Nothing was stopped.',
  );
  expect(writes(view.fetch)).toEqual([['POST', '/runs/run-0024/stop', {}]]);
  await waitFor(() => expect(reads(view.fetch, '').length).toBeGreaterThan(before));
});

it('shows a viewer the run in progress with Stop locked, and says why', async () => {
  open({ ...performanceHomeRunning, can: { start: false, manage: false } }, { role: 'viewer' });
  const card = await screen.findByRole('region', { name: 'Run in progress' });
  const stop = within(card).getByRole('button', { name: 'Stop run' });
  expect(stop).toBeDisabled();
  expect(stop).toHaveAccessibleDescription('Viewers cannot stop a run');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(newRun()).toHaveAccessibleDescription('Viewers cannot change this project.');
});

it('shows a member who may not start the run in progress with Stop', async () => {
  open({ ...performanceHomeRunning, can: { start: false, manage: false } }, { role: 'member' });
  expect(await screen.findByRole('button', { name: 'Stop run' })).toBeEnabled();
});

it('says plainly that the area is switched off, without an error or Retry', async () => {
  open(switchedOff);
  expect(await screen.findByText('Performance tests are switched off')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
  expect(screen.queryByRole('link', { name: 'New run' })).toBeNull();
});

it('offers Retry when the read fails for another reason', async () => {
  open(() => refusal(500, 'internal_error', 'Something went wrong.'));
  expect(await screen.findByText('Couldn’t load the performance tests')).toBeInTheDocument();
  expect(screen.queryByText('Performance tests are switched off')).toBeNull();
});

it('searches the runs from the address: the search box comes first and counts in × Clear n', async () => {
  const view = open(performanceHomeIdle, { path: '/projects/demo/performance?q=preprod' });
  await waitFor(() =>
    expect(reads(view.fetch, '/runs').some((query) => query.get('q') === 'preprod')).toBe(true),
  );
  const runs = block('runs')!;
  const search = within(runs).getByRole('searchbox', { name: 'Search runs' });
  expect(search).toHaveValue('preprod');
  expect(runs.querySelector('[data-dt-toolbar] input')).toBe(search);
  expect(within(runs).getByRole('button', { name: 'Clear 1 filter' })).toBeInTheDocument();
});

it('answers "Latest capacity result" from finished Breakpoint runs only, as the safe-load chart does', () => {
  const [newest, older] = performanceHomeIdle.runs.rows.filter(
    (run) => run.verdict === 'breakpoint_found' || run.verdict === 'not_reached',
  );
  // A stopped run ended early: it keeps its verdict, but it is not the capacity answer.
  const stopped = {
    ...newest!,
    id: 'stopped-run',
    number: 99,
    status: 'stopped' as const,
    verdict: 'not_reached' as const,
  };
  expect(latestResult([stopped, newest!, older!])).toBe(newest);
  expect(latestResult([{ ...stopped }])).toBeNull();
  expect(latestResult([{ ...newest!, status: 'finished' }])?.id).toBe(newest!.id);
});
