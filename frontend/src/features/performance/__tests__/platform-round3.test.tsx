import { expect, it, vi, afterEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isPlatformRun } from '@/api/performancePlatform';
import { PlatformRun } from '../components/platform/PlatformRun';
import { MixedHome } from '../components/platform/PlatformHome';
import { LineChart } from '../components/shared/LineChart';
import { platformCount, platformResultExplanation, progressSentence } from '../components/platform/words';
import { signInSaved, SIGN_IN_SAVED } from '../components/platform/useSignInSaved';
import { platformTarget, platformRunRead, platformHome } from '../platform-fixtures';
import { setup, response } from './areaHarness';

afterEach(() => vi.restoreAllMocks());

it('acknowledges a successful save immediately, even while the run read still asks for the old sign-in', async () => {
  const read = platformRunRead('waiting');
  read.progress!.auth.rejected_at = '2026-11-25T18:00:00Z';
  read.tokens = [{ ...platformTarget.tokens[0]!, version: 1, updated_at: '2026-11-25T17:00:00Z' }];
  setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={() => undefined} />, {
    server: { write: () => response({ name: 'session_cookie', hint: '1 cookie', version: 2 }) },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Save a new sign-in' }));
  await userEvent.type(screen.getByLabelText(/^Cookie header/), 'fictional=session');
  await userEvent.click(screen.getByRole('button', { name: /^Save sign-in$/ }));
  expect(await screen.findByText(SIGN_IN_SAVED, { exact: false })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save a new sign-in' })).toHaveAttribute(
    'data-variant',
    'neutral',
  );
  expect(screen.queryByText('Sign-in needed.')).not.toBeInTheDocument();
});
it('compares server request/save times across stale reads, reloads and later requests', () => {
  const progress = platformRunRead('waiting').progress!;
  const saved = { ...platformTarget.tokens[0]!, version: 2, updated_at: '2026-11-25T18:00:05Z' };
  progress.auth.rejected_at = '2026-11-25T18:00:00Z';
  expect(signInSaved(progress, [saved])).toBe(true);
  progress.auth.rejected_at = saved.updated_at;
  expect(signInSaved(progress, [saved])).toBe(true);
  progress.auth.rejected_at = '2026-11-25T18:00:06Z';
  expect(signInSaved(progress, [saved], { requestAt: '2026-11-25T18:00:00Z', version: 2 })).toBe(false);
});
it('shows the saved acknowledgement on Home while the runner still asks', () => {
  const home = platformHome('waiting');
  const active = home.active_run!;
  if (!isPlatformRun(active)) throw new Error('Expected platform fixture');
  active.progress!.auth.rejected_at = '2026-11-25T18:00:00Z';
  home.targets = [
    {
      ...platformTarget,
      id: active.target.id!,
      tokens: [{ ...platformTarget.tokens[0]!, updated_at: '2026-11-25T18:00:05Z' }],
    },
  ];
  setup(<MixedHome slug="demo" home={home} staleSince={null} onRetry={() => undefined} />, { server: {} });
  expect(screen.getByText(SIGN_IN_SAVED)).toBeVisible();
});
it('uses one singular rule for all platform count units', () => {
  for (const noun of ['user', 'dashboard', 'chart', 'open', 'filter', 'level', 'cookie'] as const) {
    expect(platformCount(1, noun)).toBe(`1 ${noun}`);
    expect(platformCount(2, noun)).toBe(`2 ${noun}s`);
    expect(platformCount(0, noun, true)).toBe(`${noun}s`);
  }
});
for (const verdict of ['invalid_auth', 'invalid_no_data'] as const) {
  it(`does not present capacity from ${verdict}, while keeping the measured levels`, () => {
    const read = platformRunRead('finished');
    read.summary!.verdict = verdict;
    read.summary!.headline.safe_load_users = 1;
    read.summary!.headline.recommended_max_users = 1;
    setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={() => undefined} />, {
      server: {},
    });
    const stats = screen.getByLabelText('The run in numbers');
    for (const label of ['Safe load', 'Breaks at', 'Recommended']) {
      const cell = within(stats).getByText(label).closest('[data-variant]')!;
      expect(cell.textContent).toBe(`${label}–`);
    }
    expect(screen.getByLabelText('Levels')).toBeVisible();
    expect(
      screen.getByText(/this run does not establish a safe load or a recommended maximum/i),
    ).toBeVisible();
  });
}
it('explains clean and excluded levels from summary fields, without backend prose', () => {
  const summary = platformRunRead('finished').summary!;
  summary.verdict = 'invalid_auth';
  summary.source_verdict_reason = 'raw_backend_reason';
  summary.levels = [
    {
      ...summary.levels[0]!,
      level: 1,
      has_data: true,
      passed: true,
      auth_contaminated: false,
      result: 'pass',
    },
    {
      ...summary.levels[0]!,
      level: 2,
      has_data: true,
      passed: false,
      auth_contaminated: true,
      result: 'auth',
    },
  ];
  expect(platformResultExplanation(summary)).toContain(
    'Level 1 passed before the sign-in was lost; level 2 was not counted because sign-in was lost;',
  );
  expect(platformResultExplanation(summary)).not.toContain('raw_backend_reason');
  summary.verdict = 'invalid_no_data';
  summary.ended_by = 'stop';
  summary.headline.duration_s = 30;
  summary.levels.forEach((level) => {
    level.has_data = false;
    level.actual_duration_s = 0;
  });
  expect(platformResultExplanation(summary)).toContain('Stopped during the baseline');
  summary.test_type = 'smoke';
  expect(platformResultExplanation(summary)).toBe(
    'Stopped before a usable dashboard open measurement was collected.',
  );
});
it('separates the live message from the final-results sentence', () => {
  expect(progressSentence('Opening dashboards')).toBe('Opening dashboards.');
  expect(progressSentence('Testing baseline.')).toBe('Testing baseline.');
});
it('anchors the outer shared chart labels inside the plot for both target kinds', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(350);
  setup(
    <LineChart
      label="Capacity over time"
      xs={['Nov 25 · run 1', 'Nov 25 · run 15']}
      yMax={5}
      series={[{ name: 'Safe load', values: [1, 2] }]}
    />,
    { server: {} },
  );
  await waitFor(() => expect(screen.getByText('Nov 25 · run 15')).toBeVisible());
  expect(screen.getByText('Nov 25 · run 1')).toHaveAttribute('text-anchor', 'start');
  expect(screen.getByText('Nov 25 · run 15')).toHaveAttribute('text-anchor', 'end');
});
