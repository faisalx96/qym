import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PerformanceVerdict } from '@/api/performance';
import { MixedHome } from '../components/platform/PlatformHome';
import { PlatformRun } from '../components/platform/PlatformRun';
import { PlatformCharts } from '../components/platform/PlatformProgress';
import { PlatformSetupTab } from '../components/platform/PlatformSetup';
import { PlatformSignIn } from '../components/platform/SessionDialog';
import { TargetKindDialog } from '../components/platform/TargetKindDialog';
import {
  PlatformDashboardFields,
  PlatformLoadFields,
  platformPlanProblems,
} from '../components/platform/PlatformNewRun';
import {
  platformFixtureRead,
  platformRunRead,
  platformSetup,
  platformTarget,
  platformHome,
} from '../platform-fixtures';
import { setup, response, writes } from './areaHarness';

for (const [verdict, sentence] of [
  ['breakpoint_found', 'Breaks at 8 users (dashboard-open time)'],
  ['not_reached', 'No break up to 10 users'],
  ['invalid_auth', 'Not valid: sign-in'],
  ['invalid_no_data', 'No measurement'],
  ['pass', 'Passed'],
  ['fail', 'Failed: Requests failed'],
] as [PerformanceVerdict, string][]) {
  it(`keeps the ${verdict} sentence independent of incomplete coverage`, () => {
    const read = platformRunRead('finished');
    read.summary = { ...read.summary!, verdict, verdict_reason: sentence };
    setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={vi.fn()} />, { server: {} });
    expect(screen.getAllByText(sentence, { exact: true })[0]).toBeVisible();
    expect(screen.getByText('Coverage incomplete.', { exact: true })).toBeVisible();
  });
}
for (const state of ['failed', 'stopped', 'interrupted', 'stopping'] as const) {
  it(`shows the ${state} lifecycle without a fabricated final verdict`, () => {
    const read = platformRunRead(state);
    setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={vi.fn()} />, { server: {} });
    expect(screen.getByRole('heading', { name: `Run ${read.run.number}` })).toBeVisible();
    expect(
      screen.queryByText('Breaks at 8 users (dashboard-open time)', { exact: true }),
    ).not.toBeInTheDocument();
  });
}
it('keeps empty charts out of a discovery run', () => {
  setup(<PlatformCharts read={platformRunRead('discovery')} />, { server: {} });
  expect(screen.getByText('No chart measurements yet')).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('charts completed open and filter times with readable labels', () => {
  setup(<PlatformCharts read={platformRunRead('finished')} />, { server: {} });
  expect(screen.getByText('Dashboard open time', { selector: 'h3' })).toBeVisible();
  expect(screen.getByText('Filter time', { selector: 'h3' })).toBeVisible();
});
it('loads discovery reasons and frozen settings without exposing session hints in Setup', async () => {
  const read = platformRunRead('finished');
  const prefix = `/runs/${read.run.id}`;
  setup(<PlatformSetupTab slug="demo" runId={read.run.id} read={read} />, {
    server: {
      reads: {
        [`${prefix}/discovery`]: (url) =>
          platformFixtureRead(`${prefix}/discovery`, url.searchParams, 'finished'),
      },
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('grid', { name: 'Discovery charts' })).toHaveTextContent('التجارة الخارجية'),
  );
  expect(screen.getByText('Plan as started')).toBeVisible();
  expect(screen.getByText('Plan after discovery')).toBeVisible();
  expect(screen.getByText('Target settings as started')).toBeVisible();
  expect(screen.queryByText(platformTarget.tokens[0]!.hint)).not.toBeInTheDocument();
});
it('hides sign-in writes for a viewer', () => {
  setup(<PlatformSignIn slug="demo" target={{ ...platformTarget, can_save_tokens: false }} />, {
    role: 'viewer',
    server: {},
  });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('asks the target kind before opening its dedicated fields', async () => {
  setup(<TargetKindDialog slug="demo" onClose={vi.fn()} />, { server: {} });
  expect(screen.getByRole('dialog', { name: 'What do you want to test?' })).toBeVisible();
  await userEvent.click(screen.getByText('Estishraf platform', { exact: true }));
  expect(screen.getByLabelText(/^Cookie header/)).toHaveAttribute('type', 'password');
  expect(screen.queryByLabelText('Chat path')).not.toBeInTheDocument();
});
it('uses the setup defaults for load and dashboard fields', () => {
  const plan = structuredClone(platformSetup.platform.defaults.breakpoint);
  plan.limit_ms = 7000;
  plan.pause_seconds = 9;
  setup(
    <>
      <PlatformLoadFields setup={platformSetup} plan={plan} onChange={vi.fn()} />
      <PlatformDashboardFields plan={plan} onChange={vi.fn()} />
    </>,
    { server: {} },
  );
  expect(screen.getByRole('textbox', { name: 'Dashboard open p95 limit, seconds' })).toHaveValue('7');
  expect(screen.getByRole('textbox', { name: 'Pause between dashboards, seconds' })).toHaveValue('9');
  expect(
    screen.getByText('The list is found when the run starts. It uses the dashboards this account can see.'),
  ).toBeVisible();
});

it('stops a platform run from Home with a reason and preserves the measured results', async () => {
  const home = platformHome('running');
  const { fetch } = setup(<MixedHome slug="demo" home={home} staleSince={null} onRetry={vi.fn()} />, {
    server: { write: () => response({}) },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Stop run' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('keeps the results measured so far');
  await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'Load window ended');
  await userEvent.click(screen.getAllByRole('button', { name: 'Stop run' }).at(-1)!);
  await waitFor(() =>
    expect(writes(fetch)).toContainEqual([
      'POST',
      `/runs/${home.active_run!.id}/stop`,
      { reason: 'Load window ended' },
    ]),
  );
});
it('keeps platform Home controls hidden for a viewer', () => {
  const home = platformHome('running');
  home.can = { start: false, manage: false };
  setup(<MixedHome slug="demo" home={home} staleSince={null} onRetry={vi.fn()} />, {
    role: 'viewer',
    server: {},
  });
  expect(screen.queryByRole('button', { name: 'Stop run' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'New run' })).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Kind' })).toBeVisible();
});

it('refuses missing required load values and fractional whole-number limits', () => {
  const plan = structuredClone(platformSetup.platform.defaults.breakpoint);
  Object.assign(plan, { max_users: null, max_dashboards: 1.5 });
  expect(platformPlanProblems(plan, platformTarget, platformSetup)).toEqual(
    expect.arrayContaining(['Enter highest users.', 'Dashboard limit must be a whole number.']),
  );
});
it('gives a platform-only project its first-run steps', () => {
  const home = platformHome();
  home.targets = [platformTarget];
  home.runs = { ...home.runs, total: 0, rows: [] };
  setup(<MixedHome slug="demo" home={home} staleSince={null} onRetry={vi.fn()} />, { server: {} });
  expect(screen.getByText('3. Start Smoke')).toBeVisible();
  expect(screen.getByText('One user opens every runnable dashboard once.')).toBeVisible();
});
