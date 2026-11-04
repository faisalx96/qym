import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveOverviewQueryOptions, type LiveOverview } from '@/api/live';
import { liveOverview } from '@/features/dev/liveFixtures';
import { LiveOverviewPage } from '../LiveOverviewPage';
import { LiveTurnsPage } from '../LiveTurnsPage';

vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));

const source = liveOverview.status.key;
const day = '2026-11-01';
const clients: QueryClient[] = [];
const second = {
  ...liveOverview.status,
  id: 'second',
  key: 'worker-dev',
  name: 'Development worker',
  environment: 'dev',
};

function Page({ turns = false }: { turns?: boolean }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const selected = params.get('source') ?? source;
  return (
    <>
      {turns ? (
        <LiveTurnsPage slug="demo" source={selected} />
      ) : (
        <LiveOverviewPage slug="demo" source={selected} day={params.get('day') ?? day} />
      )}
      <output aria-label="URL">{location.search}</output>
    </>
  );
}
function mount(turns = false, cached?: LiveOverview) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  if (cached)
    client.setQueryData(
      liveOverviewQueryOptions('demo', { source, day: '2026-10-30', trendDays: 14, daysPage: 1 }).queryKey,
      cached,
    );
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`?source=${source}&day=${day}`]}>
        <Page turns={turns} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function sources() {
  return new Response(JSON.stringify({ sources: [liveOverview.status, second], default_source: source }));
}
const overviewResponse = (data = liveOverview) => new Response(JSON.stringify(data));
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe('overview loading and error states', () => {
  it('renders ErrorState with retry and recovers after a failed overview query', async () => {
    let failed = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.includes('/overview')
          ? failed
            ? new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 })
            : overviewResponse()
          : sources(),
      ),
    );
    mount();
    expect(await screen.findByRole('heading', { name: 'Couldn’t load live evaluation' })).toBeVisible();
    expect(screen.queryByText('No live source yet')).toBeNull();
    failed = false;
    await userEvent.setup().click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(document.querySelector('[data-live-stat="turns"]')).toHaveTextContent('47'));
  });

  it('reserves the measured first-load frames through their CSS variables', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input.includes('/overview') ? new Promise<Response>(() => {}) : Promise.resolve(sources()),
      ),
    );
    const { container } = mount();
    const frames = container.querySelector<HTMLElement>('[data-live-loading]')!;
    expect(frames).toHaveAttribute('data-visible', 'false');
    for (const [size, services, days, trend] of [
      ['wide', 192, 676, 330],
      ['medium', 380, 688, 330],
      ['narrow', 572, 716, 427],
    ] as const) {
      expect(frames.style.getPropertyValue(`--live-services-${size}`)).toBe(`${services}px`);
      expect(frames.style.getPropertyValue(`--live-days-${size}`)).toBe(`${days}px`);
      expect(frames.style.getPropertyValue(`--live-trend-${size}`)).toBe(`${trend}px`);
    }
    await waitFor(() => expect(frames).toHaveAttribute('data-visible', 'true'));
    for (const [label, variable] of [
      ['Loading service health and canaries', 'services'],
      ['Loading days', 'days'],
      ['Loading turns over time', 'trend'],
    ]) {
      expect(screen.getByRole('status', { name: label })).toHaveStyle({
        height: `var(--live-${variable}-height)`,
      });
    }
    await waitFor(() => expect(frames).toHaveAttribute('data-visible', 'true'));
  });

  it('uses the last overview counts from the same source before the pending request answers', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input.includes('/overview') ? new Promise<Response>(() => {}) : Promise.resolve(sources()),
      ),
    );
    const cached = {
      ...liveOverview,
      day: { ...liveOverview.day, services: liveOverview.day.services.slice(0, 6) },
      days: { ...liveOverview.days, total: 7, rows: liveOverview.days.rows.slice(0, 7) },
    };
    const { container } = mount(false, cached);
    const frames = container.querySelector<HTMLElement>('[data-live-loading]')!;
    expect(frames.style.getPropertyValue('--live-services-wide')).toBe('192px');
    expect(frames.style.getPropertyValue('--live-services-medium')).toBe('300px');
    expect(frames.style.getPropertyValue('--live-services-narrow')).toBe('492px');
    expect(frames.style.getPropertyValue('--live-days-wide')).toBe('396px');
  });

  it('keeps the previous day visible without skeletons until the new day arrives', async () => {
    let resolveNext: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (!input.includes('/overview')) return Promise.resolve(sources());
        if (new URL(input, 'http://localhost').searchParams.get('day') === day)
          return Promise.resolve(overviewResponse());
        return new Promise<Response>((resolve) => {
          resolveNext = resolve;
        });
      }),
    );
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-live-stat="turns"]')).toHaveTextContent('47'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByLabelText('URL')).toHaveTextContent('day=2026-10-31');
    expect(container.querySelector('[data-live-loading]')).toBeNull();
    expect(container.querySelector('[data-live-stat="turns"]')).toHaveTextContent('47');
    await act(async () =>
      resolveNext(
        overviewResponse({
          ...liveOverview,
          day: { ...liveOverview.day, row: { ...liveOverview.day.row!, turns_seen: 3 } },
        }),
      ),
    );
    await waitFor(() => expect(container.querySelector('[data-live-stat="turns"]')).toHaveTextContent('3'));
  });
});

it.each([false, true])('changes the source and reloads the %s page numbers', async (turns) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      const dev = url.searchParams.get('source') === 'worker-dev';
      if (url.pathname.endsWith('/overview'))
        return overviewResponse(
          dev
            ? {
                ...liveOverview,
                status: second,
                day: { ...liveOverview.day, in_qym: 3, row: { ...liveOverview.day.row!, turns_seen: 3 } },
              }
            : liveOverview,
        );
      if (url.pathname.endsWith('/turns'))
        return new Response(
          JSON.stringify({
            rows: [],
            total: dev ? 3 : 47,
            facets: { labels: {}, modes: {}, statuses: {}, outcomes: {}, services: {}, users: [] },
          }),
        );
      return sources();
    }),
  );
  const { container } = mount(turns);
  if (turns) expect(await screen.findByText('47 of 47 turns on 1 Nov 2026')).toBeVisible();
  else
    await waitFor(() => expect(container.querySelector('[data-live-stat="turns"]')).toHaveTextContent('47'));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Live source/ }));
  await user.click(screen.getByRole('option', { name: 'Development worker' }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('source=worker-dev');
  if (turns) expect(await screen.findByText('3 of 3 turns on 1 Nov 2026')).toBeVisible();
  else
    await waitFor(() => expect(container.querySelector('[data-live-stat="turns"]')).toHaveTextContent('3'));
});
