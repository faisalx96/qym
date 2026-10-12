import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/api/types';
import { ProjectContext } from '@/features/shell';
import { ToastProvider } from '@/ui';
import { ExperimentsPage } from './ExperimentsPage';

/** One versioning select per versioning_metadata key the project reports, synced to the URL. */

const project = { id: 'p1', slug: 'demo', name: 'Demo', role: 'MANAGER' } as Project;

const EXPERIMENTS = [
  { name: 'Nightly', versioning: { agent_version: 'v1', kb_version: '381' } },
  { name: 'Prompt sweep', versioning: { agent_version: 'v2', kb_version: '400' } },
];

const experiment = (name: string) => ({
  id: name.toLowerCase().replace(/ /g, '-'),
  name,
  status: 'COMPLETED',
  environment_ids: [],
  base_source: null,
  job_counts: { SUCCEEDED: 1 },
  created_by_email: 'owner@example.test',
  created_by_user_id: 'u1',
  created_at: '2026-10-01T10:00:00Z',
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** Stands in for the platform: filters by every repeated `versioning=key=value`. */
function stubPlatform() {
  const requests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://platform.test');
      if (/\/eval-environments/.test(url.pathname)) return json({ environments: [] });
      requests.push(url);
      const wanted = url.searchParams.getAll('versioning').map((v) => v.split('=') as [string, string]);
      const rows = EXPERIMENTS.filter((x) =>
        wanted.every(([k, v]) => (x.versioning as Record<string, string>)[k] === v),
      );
      return json({
        experiments: rows.map((x) => experiment(x.name)),
        total: rows.length,
        versioning_facets: { agent_version: ['v2', 'v1'], kb_version: ['400', '381'] },
      });
    }),
  );
  return requests;
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function mount(url: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:slug/experiments',
        element: (
          <ProjectContext.Provider
            value={{ project, slug: 'demo', readOnly: false, canManage: true, isAdmin: false }}
          >
            <ExperimentsPage />
            <Where />
          </ProjectContext.Provider>
        ),
      },
    ],
    { initialEntries: [url] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const names = () =>
  within(screen.getByRole('grid', { name: 'Experiments' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '');

afterEach(() => vi.unstubAllGlobals());

describe('ExperimentsPage versioning facets', () => {
  it('offers one select per key, filters on a value, keeps it in the URL and clears it', async () => {
    const requests = stubPlatform();
    const user = userEvent.setup();
    mount('/projects/demo/experiments');
    await waitFor(() => expect(names()).toHaveLength(2));
    expect(screen.getByRole('button', { name: /Agent version/ })).toHaveTextContent('All agent versions');
    expect(screen.getByRole('button', { name: /KB version/ })).toHaveTextContent('All KB versions');

    await user.click(screen.getByRole('button', { name: /KB version/ }));
    await user.click(await screen.findByRole('option', { name: '381' }));
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(names()[0]).toContain('Nightly');
    expect(requests.at(-1)!.searchParams.getAll('versioning')).toEqual(['kb_version=381']);
    expect(screen.getByTestId('where').textContent).toContain('versioning=kb_version%3D381');

    await user.click(screen.getByRole('button', { name: /KB version/ }));
    await user.click(await screen.findByRole('option', { name: 'All KB versions' }));
    await waitFor(() => expect(names()).toHaveLength(2));
    expect(requests.at(-1)!.searchParams.has('versioning')).toBe(false);
    expect(screen.getByTestId('where').textContent).not.toContain('versioning');
  });

  it('restores the selection from the URL', async () => {
    const requests = stubPlatform();
    mount('/projects/demo/experiments?versioning=kb_version%3D381');
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(screen.getByRole('button', { name: /KB version/ })).toHaveTextContent('381');
    expect(requests.at(-1)!.searchParams.getAll('versioning')).toEqual(['kb_version=381']);
  });
});
