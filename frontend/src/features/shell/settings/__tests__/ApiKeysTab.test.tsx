import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiKey, DatasetReadToken, Me, Project } from '@/api/types';
import { ToastProvider } from '@/ui';
import { AuthContext } from '../../AuthContext';
import { ProjectContext } from '../../ProjectContext';
import { ApiKeysTab } from '../ApiKeysTab';

const creator = { id: 'u1', email: 'u@example.com', display_name: 'Una' };
const key = (id: string, name: string, over: Partial<ApiKey> = {}): ApiKey => ({
  id,
  name,
  prefix: `qym_${id}`,
  project_id: 'p1',
  creator,
  kind: 'user',
  created_at: '2026-10-20T10:00:00Z',
  ...over,
});
const expKey = (id: string, name: string) =>
  key(id, `Evaluation Service · ${name}`, {
    kind: 'experiment',
    experiment_id: `x-${id}`,
    experiment_name: name,
  });
const token = (id: string, name: string, over: Partial<DatasetReadToken> = {}): DatasetReadToken => ({
  id,
  name,
  prefix: `qym_dr_${id}`,
  created_at: '2026-10-20T10:00:00Z',
  creator,
  kind: 'admin',
  ...over,
});

function install(keys: ApiKey[], tokens: DatasetReadToken[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('dataset-read-tokens') ? { tokens } : { api_keys: keys };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const project = { id: 'p1', slug: 'demo', name: 'Demo' } as unknown as Project;
  const me = { id: 'u1' } as unknown as Me;
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <AuthContext.Provider value={{ me, isAdmin: true, refetch: () => undefined }}>
            <ProjectContext.Provider
              value={{ project, slug: 'demo', readOnly: false, canManage: true, isAdmin: true }}
            >
              <ApiKeysTab />
            </ProjectContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API keys tab: platform-issued credentials are grouped', () => {
  it('lists user keys in the table and experiment keys in a closed group with the count', async () => {
    install([key('a', 'CI pipeline'), expKey('b', 'rag sweep'), expKey('c', 'timeouts')]);
    renderTab();
    const main = await screen.findByRole('grid', { name: 'API keys' });
    expect(within(main).getByText('CI pipeline')).toBeTruthy();
    expect(within(main).queryByText(/Evaluation Service/)).toBeNull();

    const trigger = await screen.findByRole('button', { name: /Evaluation Service keys/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('2 · issued at launch, revoked when the experiment settles');
    expect(screen.getByText('Evaluation Service · rag sweep')).not.toBeVisible();

    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const group = await screen.findByRole('grid', { name: 'Evaluation Service keys' });
    expect(within(group).getByText('Evaluation Service · rag sweep')).toBeVisible();
    const link = within(group).getByRole('link', { name: 'rag sweep' });
    expect(link.getAttribute('href')).toBe('/projects/demo/experiments/x-b');
    expect(within(group).getByText('Evaluation Service · timeouts')).toBeTruthy();
    expect(within(group).queryByText('CI pipeline')).toBeNull();
  });

  it('renders no group when the project has no experiment keys', async () => {
    install([key('a', 'CI pipeline')]);
    renderTab();
    await screen.findByRole('grid', { name: 'API keys' });
    expect(screen.queryByRole('button', { name: /Evaluation Service keys/ })).toBeNull();
  });

  it('splits dataset read tokens the same way', async () => {
    install(
      [],
      [
        token('a', 'Eval service'),
        token('b', 'Evaluation Service · rag sweep', {
          kind: 'experiment',
          experiment: { id: 'x1', name: 'rag sweep' },
        }),
      ],
    );
    renderTab();
    const main = await screen.findByRole('grid', { name: 'Dataset read tokens' });
    expect(within(main).getByText('Eval service')).toBeTruthy();
    expect(within(main).queryByText(/rag sweep/)).toBeNull();
    const trigger = await screen.findByRole('button', { name: /Experiment tokens/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('1 · issued at launch');
    await userEvent.click(trigger);
    const group = await screen.findByRole('grid', { name: 'Experiment tokens' });
    expect(within(group).getAllByText(/rag sweep/).length).toBeGreaterThan(0);
    expect(within(group).getAllByText(/rag sweep/)[0]).toBeVisible();
  });
});
