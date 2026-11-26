// Shared setup of the Home, Runner and Targets tests: the real page over a server double, in a project context.
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, vi } from 'vitest';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

export const response = (data: unknown, status = 200) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status });
/** A refusal in the platform's own shape. */
export const refusal = (status: number, code: string, message: string, details: unknown = {}) =>
  response({ error: { code, message, details } }, status);
/** What every route of the area answers while the area is switched off on the platform. */
export const switchedOff = () =>
  refusal(404, 'performance_is_switched_off', 'Performance is switched off.', []);

export type Role = 'manager' | 'member' | 'viewer';

/** The project around the page, as `ProjectLayout` gives it. */
export const project = (role: Role, archived = false): ProjectValue =>
  ({
    project: { name: 'Demo project', slug: 'demo' },
    slug: 'demo',
    readOnly: role === 'viewer' || archived,
    archived,
    viewer: role === 'viewer',
    canManage: role === 'manager',
    isAdmin: false,
  }) as ProjectValue;

/** Answers by the path under `/api/projects/demo/performance` ('' is the Home read); writes go to `write`. */
export interface Server {
  reads: Record<string, (url: URL) => unknown>;
  write: (url: URL, method: string, body: Record<string, unknown>) => Response | Promise<Response>;
}

const AREA = '/api/projects/demo/performance';

export function setup(page: ReactNode, options: { server: Partial<Server>; role?: Role; path?: string }) {
  const server: Server = { reads: {}, write: () => response({}), ...options.server };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    if (method !== 'GET')
      return server.write(
        url,
        method,
        init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      );
    const sub = url.pathname.slice(url.pathname.indexOf(AREA) + AREA.length);
    const answer = server.reads[sub];
    if (!answer) return refusal(404, 'not_found', `No answer for ${url.pathname}`);
    const data = answer(url);
    return data instanceof Response ? data.clone() : response(data);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.path ?? '/projects/demo/performance']}>
        <ProjectContext.Provider value={project(options.role ?? 'manager')}>{page}</ProjectContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client, fetch, server };
}

/** The reads of one path under the area ('' is the Home read), as their query strings. */
export const reads = (fetch: ReturnType<typeof setup>['fetch'], sub: string) =>
  fetch.mock.calls
    .filter(([, init]) => !init?.method || init.method === 'GET')
    .map(([input]) => new URL(input, 'http://localhost'))
    .filter((url) => url.pathname === `${AREA}${sub}`)
    .map((url) => url.searchParams);

/** The requests that were not plain reads, as [method, path under the area, body]. */
export const writes = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([input, init]) => [
      init!.method,
      new URL(input, 'http://localhost').pathname.replace(AREA, ''),
      init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    ]);

/** A block of the page by its `data-performance-block` name. */
export const block = (name: string) =>
  document.querySelector<HTMLElement>(`[data-performance-block="${name}"]`);

/** Asserts that the words appear in this order in the text. */
export function inOrder(text: string, words: string[]): void {
  let from = 0;
  for (const word of words) {
    const at = text.indexOf(word, from);
    if (at < 0) throw new Error(`"${word}" not found after position ${from} in: ${text}`);
    from = at + word.length;
  }
}
