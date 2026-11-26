import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { performanceDownloadUrl } from '@/api/performance';
import {
  performanceRunBreakFound,
  performanceRunFailed,
  performanceRunInterrupted,
  performanceRunPassed,
  performanceRunQueued,
  performanceRunRunning,
  performanceRunStopped,
  performanceRunStopping,
  performanceRunTokenNeeded,
} from '@/features/dev/performanceFixtures';
import { block, refusal, setup } from './runHarness';

// The run page in each of its states, from the sample run of the design (run 24, breaks at 50 users).
const notice = () => screen.queryByTestId('performance-run-notice');
const cells = () => block('numbers')!.textContent ?? '';
const inOrder = (text: string, words: string[]) => {
  let from = 0;
  for (const word of words) {
    const at = text.indexOf(word, from);
    expect(at, `"${word}" after position ${from}`).toBeGreaterThanOrEqual(0);
    from = at + word.length;
  }
};

it('shows a running run: state, where it is, six numbers, and Progress as the open tab', async () => {
  setup(performanceRunRunning);
  expect(await screen.findByRole('heading', { name: 'Run 24' })).toBeInTheDocument();
  expect(screen.getByTestId('crumb')).toHaveTextContent('Run 24');
  expect(document.title).toContain('Run 24 · Performance');
  expect(document.querySelector('[data-performance-status]')).toHaveAttribute(
    'data-performance-status',
    'running',
  );
  expect(notice()).toBeNull();

  const line = screen.getByRole('group', { name: 'Where the run is' });
  inOrder(line.textContent ?? '', [
    'Now',
    'Level 30 of 60: measuring',
    'Coming up',
    'next level in 3m 30s',
    'Elapsed',
    '21m 30s',
    'Time left',
    'up to 28m 30s',
    'In flight',
    '26, the oldest for 1m 41s',
    'Last report',
    '3s ago',
  ]);
  inOrder(cells(), ['Users now', 'Answers', 'OK', 'p95 this level', 'p95 whole run', 'Errors']);
  // One compact-header strip between the header and the tabs (B22); what a number means is its help.
  expect(block('numbers')!.querySelector('[data-variant]')).toHaveAttribute('data-variant', 'compact-header');
  expect(cells()).toContain('Server 2 · Timeout 0 · Sign-in 0 · Rate limit 0');
  expect(block('limits')).toBeNull();

  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Progress',
    'Questions449',
    'Log',
    'Charts',
    'Setup',
  ]);
  expect(screen.getByRole('tab', { name: 'Progress' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Send a new token' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Download report' })).toBeNull();
});

it('shows the level being measured with its share of the hold, and when the next levels start', async () => {
  setup(performanceRunRunning);
  await screen.findByRole('heading', { name: 'Run 24' });
  const row = (level: number) =>
    document.querySelector<HTMLElement>(`[data-performance-level-row="${level}"]`)!;
  expect(document.querySelectorAll('[data-performance-level-row]')).toHaveLength(6);
  expect(row(10)).toHaveTextContent('Passed');
  expect(row(30)).toHaveTextContent('Measuring');
  expect(row(30)).toHaveTextContent('53% of the hold');
  // The Result column already shows the live step: no row is drawn live (no rail) as well.
  expect(document.querySelectorAll('[data-performance-level-row][data-state]')).toHaveLength(0);
  expect(row(40)).toHaveTextContent('Waiting');
  expect(row(40)).toHaveTextContent(/starts at \d\d:\d\d/);
  // The live report has no p99 and no p95 by kind: those cells stay empty until the result.
  expect(within(row(10)).getAllByText('–')).toHaveLength(4);
});

it('says a queued run waits, with what comes next and the planned length', async () => {
  setup(performanceRunQueued);
  expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(/^Queued\./);
  const line = screen.getByRole('group', { name: 'Where the run is' });
  inOrder(line.textContent ?? '', ['Now', 'Waiting for the runner', 'Coming up', 'Planned length']);
  expect(line).not.toHaveTextContent('Last report');
  expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled();
});

it('asks for a token with a notice and a button before Stop', async () => {
  setup(performanceRunTokenNeeded);
  expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(/^Needs a new token\./);
  const header = document.querySelector<HTMLElement>('[data-page-header]')!;
  expect(
    within(header)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Send a new token', 'Stop run']);
  expect(document.querySelector('[data-performance-level-row="30"]')).toHaveTextContent('Not counted');
});

it('does not offer Stop a second time while the run is stopping', async () => {
  setup(performanceRunStopping);
  // The stopper is a person (A8): their UserName, the initial disc then the name.
  expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(
    /Stopping\. A ?Ali asked to stop this run at/,
  );
  expect(within(notice()!).getByText('Ali')).toBeInTheDocument();
  expect(notice()).toHaveTextContent('Reason given: Preprod is needed for a demo.');
  expect(screen.getByRole('button', { name: /Stop run/ })).toBeDisabled();
  expect(screen.getByRole('group', { name: 'Where the run is' })).toHaveTextContent('Stopping');
});

it('shows the result of a Breakpoint run: verdict, capacity numbers, limits, report', async () => {
  const { runId } = setup(performanceRunBreakFound);
  expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(/^Breaks at 50 users\./);
  expect(document.querySelector('[data-performance-verdict]')).toHaveTextContent('Breaks at 50 users');
  expect(block('status-line')).toBeNull();
  inOrder(cells(), [
    'Safe load',
    '40',
    'Breaks at',
    '50',
    'Recommended',
    '32',
    'p95 at safe load',
    '147.6s',
    'Answers measured',
    '913',
    'Run length',
    '39m 59s',
  ]);
  const limits = within(block('limits')!);
  expect(limits.getAllByRole('row')).toHaveLength(3);
  expect(limits.getByText('Broken')).toBeInTheDocument();
  expect(limits.getByText('Kept')).toBeInTheDocument();

  expect(screen.getByRole('link', { name: 'Run again' })).toHaveAttribute(
    'href',
    '/projects/demo/performance/new',
  );
  // The link is the path the API gave, behind the platform's root path.
  const report = screen.getByRole('link', { name: 'Download report' });
  expect(report).toHaveAttribute('href', performanceDownloadUrl(performanceRunBreakFound.report!.url));
  expect(report.getAttribute('href')).toContain(`/api/projects/demo/performance/runs/${runId}/report`);
  expect(screen.queryByRole('button', { name: 'Stop run' })).toBeNull();
  const broke = document.querySelector('[data-performance-level-row="50"]');
  expect(broke).toHaveTextContent('Broke the time limit');
  expect(document.querySelector('[data-performance-level-row="60"]')).toHaveTextContent('Not reached');
});

it('says how much of a hold ran when a stop cut it short, and keeps the judgement of that level', async () => {
  setup(performanceRunStopped);
  const line = await screen.findByTestId('performance-run-notice');
  expect(line).toHaveTextContent(/^Stopped\. A ?Ali stopped this run after 24m 40s\./);
  expect(line).toHaveTextContent('Level 30 ran 96% of its hold.');
  expect(line).toHaveTextContent('Levels 40 to 60 were never reached.');
  const cut = document.querySelector<HTMLElement>('[data-performance-level-row="30"]')!;
  expect(cut).toHaveTextContent('Passed');
  expect(cut).toHaveTextContent('96% of the hold ran');
  // A level that ran its whole hold says nothing about it.
  expect(document.querySelector('[data-performance-level-row="20"]')).not.toHaveTextContent('of the hold');
  expect(line).toHaveTextContent(/A ?Ali stopped this run/);
});

it('shows a failed run with no result: the reason, six empty numbers, no report to download', async () => {
  setup(performanceRunFailed);
  const line = await screen.findByTestId('performance-run-notice');
  expect(line).toHaveTextContent(/^Failed\./);
  expect(line).toHaveTextContent('No load was sent. The log has the details.');
  inOrder(cells(), ['Users now', 'Answers', 'OK', 'p95 this level', 'p95 whole run', 'Errors']);
  expect(within(block('numbers')!).getAllByText('–').length).toBeGreaterThanOrEqual(5);
  const report = screen.getByRole('link', { name: /Download report/ });
  expect(report).toHaveAttribute('aria-disabled', 'true');
  expect(report).not.toHaveAttribute('href');
});

it('shows what an interrupted run reported until the runner went silent', async () => {
  setup(performanceRunInterrupted);
  const line = await screen.findByTestId('performance-run-notice');
  expect(line).toHaveTextContent(/^Interrupted\./);
  expect(line).toHaveTextContent('The runner can still send its result until');
  expect(block('status-line')).toBeNull();
  const cut = document.querySelector('[data-performance-level-row="30"]');
  expect(cut).toHaveTextContent('Not finished');
  expect(cut).toHaveTextContent('53% of the hold ran');
});

it('shows a Smoke result with its own numbers and limits, and no levels', async () => {
  setup(performanceRunPassed);
  expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(/^Passed\./);
  expect(document.querySelector('[data-performance-verdict]')).toHaveTextContent('Passed');
  inOrder(cells(), ['p95', 'Answers', 'Error rate', 'Quality', 'Users', 'Run length']);
  expect(within(block('limits')!).getAllByRole('row')).toHaveLength(5);
  expect(block('levels')).toBeNull();
});

it('says so when the run is not in qym, with the way back', async () => {
  setup(refusal(404, 'run_not_found', 'This run does not exist.'));
  expect(await screen.findByText('This run is not in qym')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Performance/ })).toHaveAttribute(
    'href',
    '/projects/demo/performance',
  );
});

it('says plainly that the area is switched off, with nothing to retry', async () => {
  setup(refusal(404, 'performance_is_switched_off', 'Performance is switched off'));
  expect(await screen.findByText('Performance tests are switched off')).toBeInTheDocument();
  expect(block('content')).toHaveAttribute('data-performance-state', 'switched-off');
  expect(screen.queryByRole('button', { name: /Retry|Try again/ })).toBeNull();
  expect(screen.queryByText('This run is not in qym')).toBeNull();
});

it('keeps the last read on screen under a StaleBanner when a refresh fails', async () => {
  const { client, server } = setup(performanceRunRunning);
  await screen.findByRole('heading', { name: 'Run 24' });
  expect(screen.queryByText(/Showing data from/)).toBeNull();
  server.read = refusal(502, '', 'Bad gateway');
  await act(() => client.refetchQueries({ queryKey: ['project', 'demo', 'performance', 'run'] }));
  // §3.7: a refresh that fails after data was shown says how old the data is; ErrorState is for a first load only.
  expect(await screen.findByText(/Showing data from just now\./)).toBeInTheDocument();
  expect(screen.queryByText('Couldn’t refresh this run')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(screen.getByRole('heading', { name: 'Run 24' })).toBeInTheDocument();
  expect(block('status-line')).toHaveTextContent('26, the oldest for 1m 41s');
});

it('marks a production target as Live marks a production source: the success StateTag (D11)', async () => {
  const header = () => document.querySelector<HTMLElement>('[data-page-header]')!;
  const preprod = setup(performanceRunBreakFound);
  await screen.findByRole('heading', { name: 'Run 24' });
  expect(header().querySelector('[data-performance-environment]')).toBeNull();
  preprod.unmount();

  const read = performanceRunBreakFound;
  setup({ ...read, config: { ...read.config, target: { ...read.config.target, is_production: true } } });
  await screen.findByRole('heading', { name: 'Run 24' });
  const tag = header().querySelector<HTMLElement>('[data-performance-environment]')!;
  expect(tag).toHaveTextContent('Production');
  expect(tag).toHaveAttribute('data-tone', 'success');
});

it('shows a result whose levels leave out by_tier: empty per-kind cells and chart, no error', async () => {
  const summary = performanceRunBreakFound.summary!;
  const levels = summary.levels.map(({ by_tier: _dropped, ...level }) => level);
  setup({ ...performanceRunBreakFound, summary: { ...summary, levels } });
  await screen.findByRole('heading', { name: 'Run 24' });
  const row = document.querySelector<HTMLElement>('[data-performance-level-row="40"]')!;
  expect(row).toHaveTextContent('Passed');
  // Simple, Medium and Complex are the last three cells of the row: empty, as for a kind with no answers.
  expect([...row.querySelectorAll('td')].slice(-3).map((cell) => cell.textContent)).toEqual(['–', '–', '–']);
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Charts' }));
  const byKind = await screen.findByRole('region', { name: 'p95 by kind' });
  expect(within(byKind).getByText('No answer times by kind')).toBeInTheDocument();
});

it('says who started a run, and who ended it only when a person did', async () => {
  const header = () => document.querySelector<HTMLElement>('[data-page-header]')!.textContent ?? '';
  const first = setup(performanceRunBreakFound);
  await screen.findByRole('heading', { name: 'Run 24' });
  // The run stopped by itself at its break: no one is named for the end.
  expect(header()).toMatch(/Started .+ by ?A ?Ali, ended \d\d:\d\d(?! ?by)/);
  first.unmount();

  setup(performanceRunStopped);
  await screen.findByRole('heading', { name: 'Run 24' });
  expect(header()).toMatch(/Started .+ by ?A ?Ali, ended \d\d:\d\d by\s?A ?Ali/);
});
