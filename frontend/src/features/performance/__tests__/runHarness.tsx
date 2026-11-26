// Shared setup of the run page tests: the real page over a server double, with a clock that stands still.
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, vi } from 'vitest';
import type {
  PerformanceLogPage,
  PerformanceQuestionsPage,
  PerformanceRunEvents,
  PerformanceRunRead,
} from '@/api/performance';
import {
  performanceLogPage,
  performanceQuestionsPage,
  performanceRunEvents,
} from '@/features/dev/performanceFixtures';
import { useCurrentCrumbLabel } from '@/lib/crumb-label';
import { RunPage, type RunPageProps } from '../RunPage';

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

export const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
/** A refusal in the platform's own shape. */
export const refusal = (status: number, code: string, message: string, details: unknown = {}) =>
  response({ error: { code, message, details } }, status);

/** What the next requests answer. A test changes a field to change the server. */
export interface Server {
  read: PerformanceRunRead | Response;
  questions: (url: URL) => PerformanceQuestionsPage;
  log: (url: URL) => PerformanceLogPage;
  events: PerformanceRunEvents;
  write: (url: URL, body: Record<string, unknown>) => Response | Promise<Response>;
}

function Crumb() {
  return <span data-testid="crumb">{useCurrentCrumbLabel()}</span>;
}

/** The clock of the tests: it never moves, so an age stays what the read says. */
const still = () => 0;

export function setup(
  read: PerformanceRunRead | Response,
  options: {
    server?: Partial<Server>;
    initial?: RunPageProps['initial'];
    /** The query string the page opens with ('?kind=complex'): the Questions tab keeps its view there. */
    search?: string;
  } = {},
) {
  const server: Server = {
    read,
    questions: () => performanceQuestionsPage,
    log: () => performanceLogPage,
    events: performanceRunEvents,
    write: () => response({}),
    ...options.server,
  };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method && init.method !== 'GET')
      return server.write(url, init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {});
    if (url.pathname.endsWith('/questions')) return response(server.questions(url));
    if (url.pathname.endsWith('/log')) return response(server.log(url));
    if (url.pathname.endsWith('/events')) return response(server.events);
    return server.read instanceof Response ? server.read.clone() : response(server.read);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const runId = server.read instanceof Response ? 'run-missing' : server.read.run.id;
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projects/demo/performance/runs/${runId}${options.search ?? ''}`]}>
        <Crumb />
        <RunPage slug="demo" runId={runId} now={still} initial={options.initial} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client, fetch, server, runId };
}

/** The requests that were not plain reads, as [path, body]. */
export const writes = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([input, init]) => [
      new URL(input, 'http://localhost').pathname,
      init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    ]);

/** The reads of one kind ('/questions', '/log'), as their query strings. */
export const reads = (fetch: ReturnType<typeof setup>['fetch'], ending: string) =>
  fetch.mock.calls
    .map(([input]) => new URL(input, 'http://localhost'))
    .filter((url) => url.pathname.endsWith(ending))
    .map((url) => url.searchParams);

/** A block of the page by its `data-performance-block` name. */
export const block = (name: string) =>
  document.querySelector<HTMLElement>(`[data-performance-block="${name}"]`);
