// Shared setup for the Live worker page test files (split so the slow page tests run in parallel).
// Each test file mocks '@/features/shell/ProjectContext' itself (vi.mock is per file).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, vi } from 'vitest';
import { type LiveWorkerRead } from '@/api/liveWorker';
import { liveOverview, liveWorkerRead, liveWorkerEvents } from '@/features/dev/liveFixtures';
import { ToastProvider } from '@/ui';
import { LiveWorkerPage } from '../LiveWorkerPage';

export const clients: QueryClient[] = [];
export const source = liveOverview.status.key;
export const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
export function setup(
  read = liveWorkerRead,
  write?: (url: URL, body: Record<string, unknown>) => Response | Promise<Response>,
  initialEntries = ['/projects/demo/live/worker?source=worker'],
) {
  let current = structuredClone(read);
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/dashboard/overview') return response({ chart_data: { modelIndex: {} } });
    if (init?.method && init.method !== 'GET') {
      expect(url.searchParams.get('source')).toBe(source);
      return (
        write?.(url, init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}) ??
        response({ version: 4 })
      );
    }
    if (url.pathname.endsWith('/events')) return response({ events: liveWorkerEvents });
    if (url.pathname.endsWith('/worker')) return response(current);
    return response({ sources: [liveOverview.status], default_source: source });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider>
          <LiveWorkerPage slug="demo" source={source} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    fetch,
    setRead: (value: LiveWorkerRead) => {
      current = value;
    },
  };
}
export const writes = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls.filter(
    ([input, init]) => init?.method !== 'GET' && !String(input).includes('/api/dashboard/overview'),
  );
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

export async function openField(section: string, label: string) {
  const region = await screen.findByRole('region', { name: section });
  const trigger = within(region).getByRole('button', { name: new RegExp(`^${section} `) });
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.setup().click(trigger);
  return within(region).getByLabelText(label);
}

export async function refetchWorker(view: ReturnType<typeof setup>, read: LiveWorkerRead) {
  view.setRead(read);
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ['project', 'demo', 'live', 'worker', source] });
  });
}

export async function openRange() {
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole('button', { name: 'Backfill a day range' }))[0]!);
  return user;
}

export function dates(since: string, until: string) {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: since } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: until } });
}
