import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectContext } from '@/features/shell';
import type { Project } from '@/api/types';
import { LaunchPage } from '../LaunchPage';
import { envRecord, installFakePlatform, newClient, Providers } from './helpers';

// The sections are built by their own modules; the page itself is what is tested here.
vi.mock('../sections/ModelsSection', () => ({ ModelsSection: () => <p>models section</p> }));
vi.mock('../sections/SettingsSection', () => ({ SettingsSection: () => <p>settings section</p> }));
vi.mock('../sections/SweepsSection', () => ({ SweepsSection: () => <p>sweeps section</p> }));
vi.mock('../sections/EvaluationSection', () => ({ EvaluationSection: () => <p>evaluation section</p> }));
vi.mock('../sections/RawJsonSection', () => ({ RawJsonSection: () => <p>raw section</p> }));
vi.mock('../sections/BestRunPicker', () => ({ BestRunPicker: () => <p>best run picker</p> }));

afterEach(() => vi.unstubAllGlobals());

const project = { id: 'p1', slug: 'proj', name: 'Proj', role: 'MANAGER' } as Project;

function mount(url: string, platform = installFakePlatform([envRecord()])) {
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:slug/experiments/new',
        element: (
          <ProjectContext.Provider
            value={{ project, slug: 'proj', readOnly: false, canManage: true, isAdmin: false }}
          >
            <LaunchPage />
          </ProjectContext.Provider>
        ),
      },
      { path: '/projects/:slug/experiments/:id', element: <p>detail page</p> },
      { path: '/projects/:slug/experiments', element: <p>experiments list</p> },
    ],
    { initialEntries: [url] },
  );
  render(
    <Providers client={newClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, platform };
}

const posts = (p: ReturnType<typeof installFakePlatform>, dry: boolean) =>
  p.calls.filter(
    (c) =>
      c.method === 'POST' &&
      /\/experiments$/.test(c.url) &&
      (c.body as { dry_run?: boolean }).dry_run === dry,
  );

describe('LaunchPage', () => {
  it('starts from the default preset of the preselected environment', async () => {
    mount('/projects/proj/experiments/new?env=e1');
    expect(await screen.findByText(/Based on/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Default preset v1', { selector: 'strong' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('radio', { name: /Default preset v1/ })).toBeChecked();
  });

  it('asks before changing the starting point when there are edits', async () => {
    mount('/projects/proj/experiments/new?env=e1');
    await waitFor(() =>
      expect(screen.getByText('Default preset v1', { selector: 'strong' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Dataset$/ })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /Dataset$/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'ds2' }));
    expect(await screen.findByText('1 change on top')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /From scratch/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Change the starting point?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep current' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('radio', { name: /Default preset v1/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /From scratch/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Change starting point' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /From scratch/ })).toBeChecked());
  });

  it('launches, confirms the HIGH preemption warning and resends with the acknowledgement', async () => {
    const platform = installFakePlatform([envRecord()]);
    platform.launchResponses.push({
      status: 422,
      body: {
        detail: { code: 'preemption_acknowledgement_required', message: 'HIGH preempts running jobs.' },
      },
    });
    const { router } = mount('/projects/proj/experiments/new?env=e1', platform);
    await waitFor(() =>
      expect(screen.getByText('Default preset v1', { selector: 'strong' })).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByLabelText('Experiment name'), 'my run');
    const launch = await screen.findByRole('button', { name: 'Launch' }, { timeout: 4000 });
    await waitFor(() => expect(launch).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(launch);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('HIGH preempts running jobs.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Launch at HIGH' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/proj/experiments/x1'));
    const sent = posts(platform, false);
    expect(sent).toHaveLength(2);
    expect((sent[0]!.body as { acknowledge_preemption?: boolean }).acknowledge_preemption).toBeUndefined();
    expect((sent[1]!.body as { acknowledge_preemption?: boolean }).acknowledge_preemption).toBe(true);
    expect((sent[1]!.body as { name: string }).name).toBe('my run');
  });

  it('shows the server problems of a rejected launch and focuses the first', async () => {
    const platform = installFakePlatform([envRecord()]);
    platform.launchResponses.push({
      status: 422,
      body: { detail: { message: 'invalid', errors: [{ pointer: '#name', message: 'Name already used.' }] } },
    });
    mount('/projects/proj/experiments/new?env=e1', platform);
    await waitFor(() =>
      expect(screen.getByText('Default preset v1', { selector: 'strong' })).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByLabelText('Experiment name'), 'dup');
    const launch = await screen.findByRole('button', { name: 'Launch' }, { timeout: 4000 });
    await waitFor(() => expect(launch).toBeEnabled(), { timeout: 4000 });
    await userEvent.click(launch);
    expect(await screen.findByText('Name already used.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Experiment name')).toHaveFocus());
  });

  it('refreshes the schema once per visit and environment and announces a change', async () => {
    const platform = installFakePlatform([envRecord()]);
    platform.schemaRefresh = { changed: true, added: ['/A', '/B'], removed: ['/C'], schema_hash: 'h2' };
    mount('/projects/proj/experiments/new?env=e1', platform);
    expect(await screen.findByText('Schema updated for staging (2 added, 1 removed)')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Default preset v1', { selector: 'strong' })).toBeInTheDocument(),
    );
    expect(platform.calls.filter((c) => /schema\/refresh$/.test(c.url))).toHaveLength(1);
  });

  it('guards against leaving with unsaved edits', async () => {
    const { router } = mount('/projects/proj/experiments/new?env=e1');
    await waitFor(() =>
      expect(screen.getByText('Default preset v1', { selector: 'strong' })).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByLabelText('Experiment name'), 'draft');
    await router.navigate('/projects/proj/experiments');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Leave without launching?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/projects/proj/experiments/new');
  });

  it('shows an empty state when the project has no active environment', async () => {
    installFakePlatform([]);
    const router = createMemoryRouter(
      [
        {
          path: '/projects/:slug/experiments/new',
          element: (
            <ProjectContext.Provider
              value={{ project, slug: 'proj', readOnly: false, canManage: true, isAdmin: false }}
            >
              <LaunchPage />
            </ProjectContext.Provider>
          ),
        },
      ],
      { initialEntries: ['/projects/proj/experiments/new'] },
    );
    render(
      <Providers client={newClient()}>
        <RouterProvider router={router} />
      </Providers>,
    );
    expect(await screen.findByText('No active environments')).toBeInTheDocument();
  });
});
