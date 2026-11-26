import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetsPage } from '../TargetsPage';
import { performanceTargets } from '@/features/dev/performanceFixtures';
import { PlatformRun } from '../components/platform/PlatformRun';
import { PlatformNewRun, platformPlanProblems } from '../components/platform/PlatformNewRun';
import { SessionDialog } from '../components/platform/SessionDialog';
import { PlatformTargetDialog } from '../components/platform/PlatformTargetDialog';
import {
  platformFixtureRead,
  platformRunRead,
  platformSetup,
  platformTarget,
  type PlatformFixtureState,
} from '../platform-fixtures';
import { setup, response, refusal, writes } from './areaHarness';

function run(state: PlatformFixtureState) {
  const read = platformRunRead(state);
  const prefix = `/runs/${read.run.id}`;
  return setup(
    <PlatformRun
      slug="demo"
      runId={read.run.id}
      read={read}
      now={() => read.received_at}
      onRetry={vi.fn()}
    />,
    {
      server: {
        reads: Object.fromEntries(
          ['dashboards', 'steps', 'discovery', 'log', 'events'].map((part) => [
            `${prefix}/${part}`,
            (url: URL) => platformFixtureRead(`${prefix}/${part}`, url.searchParams, state),
          ]),
        ),
      },
    },
  );
}

describe('platform run components', () => {
  it('shows breakpoint capacity and incomplete coverage without a Questions tab', () => {
    run('finished');
    expect(screen.getByRole('heading', { name: 'Run 24' })).toBeVisible();
    expect(screen.getByText('Breaks at 8 users (dashboard-open time)', { exact: true })).toBeVisible();
    expect(screen.getByText('Coverage incomplete.', { exact: true })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Questions' })).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Limits' })).toHaveTextContent('Level 8');
  });
  it('keeps live error rates unknown and avoids premature passed results', () => {
    run('running');
    expect(screen.getByText('Open p95 so far', { exact: true })).toBeVisible();
    expect(screen.getByRole('grid', { name: 'Levels' })).toHaveTextContent('Measured; result pending');
    expect(
      within(screen.getByRole('grid', { name: 'Levels' })).queryByText('Passed', { exact: true }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Levels' })).not.toHaveTextContent('0.6%');
  });
  it('describes discovery as preparation before load and does not claim empty discovery is complete', () => {
    run('discovery');
    expect(screen.getByText('Preparing the test', { exact: true })).toBeVisible();
    expect(screen.getByText('Counts are still growing. Load starts after discovery finishes.')).toBeVisible();
    expect(screen.queryByText('Safe load', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Coverage incomplete.', { exact: true })).not.toBeInTheDocument();
  });
  it('shows sign-in replacement and the continuing test clock during load', () => {
    run('waiting');
    expect(screen.getByText(/The test clock continues while sign-in is replaced/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save a new sign-in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeVisible();
  });
  it('loads Arabic dashboard titles and nested request errors without synthetic durations', async () => {
    run('finished');
    await userEvent.click(screen.getByRole('tab', { name: /^Dashboards/ }));
    const dashboards = await screen.findByRole('treegrid', { name: 'Dashboards' });
    await waitFor(() => expect(dashboards).toHaveTextContent('التجارة الخارجية'));
    await userEvent.click(within(dashboards).getByText('التجارة الخارجية', { exact: true }));
    const steps = await screen.findByRole('grid', { name: 'Dashboard steps' });
    await waitFor(() => expect(steps).toHaveTextContent('Failed request'));
    const failed = within(steps).getByText('Failed request').closest('[role="row"]');
    expect(failed).toHaveTextContent('–');
    expect(failed).toHaveTextContent('502');
    expect(steps).toHaveTextContent('Control: year');
  });
  it('Smoke has a one-user result without a capacity recommendation', () => {
    run('smoke');
    expect(screen.getByText('Smoke coverage', { exact: true })).toBeVisible();
    expect(screen.queryByText('Recommended', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Safe load', { exact: true })).not.toBeInTheDocument();
  });
});

describe('platform setup and secret entry', () => {
  it('offers Smoke and Breakpoint, and replaces question setup with dashboards', () => {
    setup(
      <PlatformNewRun
        slug="demo"
        setup={platformSetup}
        target={platformTarget}
        initial={{ step: 2 }}
        onTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
      { server: {} },
    );
    expect(screen.getByRole('radio', { name: /Smoke/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Breakpoint/ })).toBeVisible();
    expect(screen.queryByRole('radio', { name: /Soak/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dashboards/ })).toBeVisible();
    expect(screen.queryByText('Questions', { exact: true })).not.toBeInTheDocument();
  });
  it('preserves an over-cap default and refuses it instead of silently clamping', () => {
    const limitedTarget = { ...platformTarget, max_users: 3 };
    const plan = structuredClone(platformSetup.platform.defaults.breakpoint);
    expect(platformPlanProblems(plan, limitedTarget, platformSetup)).toContain(
      'This target allows at most 3 users.',
    );
    expect(plan.max_users).toBe(10);
  });
  it('shows platform runner capability refusal in review', () => {
    const unavailable = { ...platformSetup, platform: { ...platformSetup.platform, supported: false } };
    setup(
      <PlatformNewRun
        slug="demo"
        setup={unavailable}
        target={platformTarget}
        initial={{ step: 5 }}
        onTarget={vi.fn()}
        onCancel={vi.fn()}
      />,
      { server: {} },
    );
    expect(
      screen.getAllByText(
        'The connected runner cannot run platform tests. An operator needs to update it.',
      )[0],
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
  });
  it('clears a rejected session cookie from the input and mutation state', async () => {
    const view = setup(<SessionDialog slug="demo" targetId="platform" onClose={vi.fn()} />, {
      server: {
        write: () =>
          refusal(422, 'session_cookie_invalid', 'Paste the whole Cookie header value as name=value pairs.'),
      },
    });
    await userEvent.type(screen.getByLabelText(/^Cookie header/), 'session=fictional-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save sign-in' }));
    await waitFor(() => expect(screen.getByLabelText(/^Cookie header/)).toHaveValue(''));
    await waitFor(() => expect(screen.getByText(/Paste the whole Cookie header value/)).toBeVisible());
    expect(
      JSON.stringify(
        view.client
          .getMutationCache()
          .getAll()
          .map((entry) => entry.state),
      ),
    ).not.toContain('fictional-secret');
  });
  it('creates a platform target without chat fields or a default address', async () => {
    const view = setup(<PlatformTargetDialog slug="demo" onClose={vi.fn()} />, {
      server: { write: () => response(platformTarget, 201) },
    });
    expect(screen.getByLabelText(/^Address/)).toHaveValue('');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Fictional platform');
    await userEvent.type(screen.getByLabelText(/^Address/), 'https://platform.example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(writes(view.fetch)).toHaveLength(1));
    expect(writes(view.fetch)[0]).toEqual([
      'POST',
      '/targets',
      expect.objectContaining({ kind: 'estishraf_platform', base_url: 'https://platform.example.test' }),
    ]);
    expect(writes(view.fetch)[0]![2]).not.toHaveProperty('chat_path');
    expect(writes(view.fetch)[0]![2]).not.toHaveProperty('token_refresh_path');
  });
});

it('opens Advanced and places the backend route refusal under the affected field', async () => {
  setup(<PlatformTargetDialog slug="demo" target={platformTarget} onClose={vi.fn()} />, {
    server: {
      write: () =>
        refusal(422, 'target_route_invalid', 'This session route has an unsupported placeholder.', {
          field: 'settings.routes.session',
        }),
    },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const input = await screen.findByRole('textbox', { name: 'Session route' });
  await waitFor(() =>
    expect(input).toHaveAccessibleDescription('This session route has an unsupported placeholder.'),
  );
  expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
});

it('offers the platform kind before a project has its first platform target', async () => {
  setup(<TargetsPage slug="demo" />, {
    server: {
      reads: {
        '/setup': () => ({ ...platformSetup, targets: performanceTargets }),
        '/targets': () => ({
          targets: performanceTargets,
          can_manage: true,
          encryption_ready: true,
          platform_limits: { max_users: 200, max_duration_s: 28_800 },
        }),
      },
    },
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Add target' }));
  expect(await screen.findByRole('dialog', { name: 'What do you want to test?' })).toBeVisible();
  expect(screen.getByText('Estishraf platform', { exact: true })).toBeVisible();
});
