import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveOverview, liveTurnDetail, liveTurnsPage } from '@/features/dev/liveFixtures';
import { LiveTurnPage } from '../LiveTurnPage';
import { ChartsTab } from '../components/turn/ChartsTab';
import { DiagnosisTab } from '../components/turn/DiagnosisTab';
import { SNAPSHOT_CSP, snapshotDocument, snapshotLayout } from '../lib/snapshot';
import { chartsOf } from '../lib/summary';

const image = {
  url: '/mounted/api/projects/demo/live/chart-image?source=worker&turn_id=turn&ref=first&v=1234',
  width: 240,
  height: 140,
  byte_size: 400,
};
const data = {
  ...liveTurnDetail,
  summary: {
    charts: [
      { ref: 'first', kind: 'bar', reading: 'Monthly totals increased. The final month was highest.' },
      { ref: 'second', kind: 'line' },
    ],
  },
  chart_images: { first: image },
};
// The second chart has no image row, but its vision score shows that a screenshot was read.
const expired = {
  ...data,
  summary: {
    charts: [data.summary.charts[0]!, { ref: 'second', kind: 'line', scores: { chart_vision: 0.5 } }],
  },
  chart_images_expired: true,
  chart_image_retention_days: 30,
};
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The second chart of `data` (a line chart without an image) redrawn from saved markup.
const snapshot = {
  url: '/mounted/api/projects/demo/live/chart-snapshot?source=worker&turn_id=turn&ref=second&v=abcd',
  style_url: `/mounted/api/projects/demo/live/chart-style?source=worker&sha256=${'a'.repeat(64)}`,
  viewport_width: 1248,
  box: { x: 100, y: 20, width: 624, height: 312 },
  byte_size: 5000,
};
const redrawn = { ...data, chart_snapshots: { second: snapshot } };
const HTML =
  '<html lang="ar" dir="rtl"><head></head><body><div class="card"><h2>المبيعات &lt;b&gt;</h2></div></body></html>';
const CSS = '.card{color:red}';

function stubSnapshot(markup: () => Response | Promise<Response>, css = CSS) {
  const fetch = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/chart-snapshot')
      ? markup()
      : new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const stored = (html = HTML) => new Response(JSON.stringify({ html, style_sha256: 'a'.repeat(64) }));

function renderCharts(detail: Parameters<typeof ChartsTab>[0]['data']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ChartsTab data={detail} />
    </QueryClientProvider>,
  );
}
async function frameOf(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  return container.querySelector('iframe')!;
}

describe('live chart screenshots', () => {
  it('renders the matching image with its dimensions, first-sentence alt and unchanged mounted URL', () => {
    const { container } = render(<ChartsTab data={data} />);
    const screenshot = screen.getByRole('img', { name: 'bar chart — Monthly totals increased.' });
    expect(screenshot).toHaveAttribute('src', image.url);
    expect(screenshot).toHaveAttribute('width', '240');
    expect(screenshot).toHaveAttribute('height', '140');
    expect(screenshot).toHaveAttribute('loading', 'lazy');
    expect(screenshot).toHaveAttribute('decoding', 'async');
    expect(container.querySelectorAll('figure[data-live-chart-image]')).toHaveLength(1);
  });

  it('opens the full image in the shell dialog and restores focus when closed', async () => {
    const user = userEvent.setup();
    render(<ChartsTab data={data} />);
    const trigger = screen.getByRole('button', { name: 'Enlarge bar chart — Monthly totals increased.' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'bar chart — Monthly totals increased.' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', image.url);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('shows the missing state when a chart ref has no uploaded image', () => {
    const { container } = render(<ChartsTab data={data} />);
    const missing = container.querySelector('[data-live-chart-missing]')!;
    expect(missing.querySelector('[data-empty-state]')).toBeInTheDocument();
    expect(missing).toHaveTextContent('No screenshot was captured');
    expect(missing).toHaveTextContent(
      "The chart could not be checked by eye. The fidelity score compares the chart's data with the SQL result only.",
    );
    expect(container.querySelector('[data-live-chart-expired]')).not.toBeInTheDocument();
  });

  it('says the screenshot is no longer stored once the turn is past the screenshot retention', () => {
    const { container, rerender } = render(<ChartsTab data={expired} />);
    // A chart that still has its image shows it; only the chart without one changes.
    expect(screen.getByRole('img', { name: 'bar chart — Monthly totals increased.' })).toBeInTheDocument();
    expect(container.querySelector('[data-live-chart-missing]')).not.toBeInTheDocument();
    const removed = container.querySelectorAll('[data-live-chart-expired]');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.querySelector('[data-empty-state]')).toBeInTheDocument();
    expect(removed[0]).toHaveTextContent('The screenshot is no longer stored');
    expect(removed[0]).toHaveTextContent(
      'Screenshots are removed 30 days after upload. The scores and the text read from the chart are kept.',
    );
    expect(removed[0]).not.toHaveTextContent('No screenshot was captured');
    rerender(<ChartsTab data={{ ...expired, chart_image_retention_days: 1 }} />);
    expect(container.querySelector('[data-live-chart-expired]')).toHaveTextContent(
      'Screenshots are removed 1 day after upload.',
    );
  });

  it('keeps the missing state on an expired turn when nothing shows that a screenshot was read', () => {
    // The second chart of `data` has no reading and no vision or design score.
    const { container } = render(
      <ChartsTab data={{ ...data, chart_images_expired: true, chart_image_retention_days: 30 }} />,
    );
    expect(container.querySelector('[data-live-chart-expired]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-chart-missing]')).toHaveTextContent(
      'No screenshot was captured',
    );
  });

  it('keeps the missing state while the turn is inside the screenshot retention', () => {
    const { container } = render(<ChartsTab data={{ ...expired, chart_images_expired: false }} />);
    expect(container.querySelector('[data-live-chart-expired]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-chart-missing]')).toHaveTextContent(
      'No screenshot was captured',
    );
  });

  it('keeps recorded chart scores and issues on labelled rows', () => {
    const { container } = render(
      <ChartsTab
        data={{
          ...data,
          summary: {
            charts: [
              {
                kind: 'bar',
                scores: { chart_fidelity: 1, chart_vision: 0.5, chart_design: 0.7 },
                issues: ['Labels overlap on the axis.'],
              },
              { kind: 'line', issues: [] },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Chart fidelity' })).toHaveTextContent(
      '100.0%data against SQL result',
    );
    expect(screen.getByRole('group', { name: 'Chart vision' })).toHaveTextContent('50.0%');
    expect(screen.getByRole('group', { name: 'Chart design' })).toHaveTextContent('70.0%');
    expect(screen.getByText('Labels overlap on the axis.').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'warning',
    );
    expect(screen.getByText('None reported').closest('h2')).toBeNull();
    expect(container.querySelectorAll('[data-live-card^="chart-"]')).toHaveLength(2);
  });

  it('accepts a legacy response without chart_images', () => {
    const { chart_images: _images, ...legacy } = data;
    const { container } = render(<ChartsTab data={legacy as typeof data} />);
    expect(container.querySelectorAll('[data-live-chart-missing]')).toHaveLength(2);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses just the kind for alt text when reading is absent', () => {
    render(<ChartsTab data={{ ...data, chart_images: { second: image } }} />);
    expect(screen.getByRole('img', { name: 'line chart' })).toBeInTheDocument();
  });

  it('keeps chart thumbnails in their own tab', () => {
    const { container } = render(
      <MemoryRouter>
        <DiagnosisTab data={{ ...data, chart_images: { first: image, second: image } }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-live-block="chart"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not repeat the chart empty state in Diagnosis', () => {
    const { container } = render(
      <MemoryRouter>
        <DiagnosisTab data={{ ...data, summary: {} }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('No charts for this turn')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-chart-image]')).not.toBeInTheDocument();
  });

  it('matches images by ref and leaves missing refs and images null', () => {
    expect(chartsOf(data.summary, data.chart_images).map((chart) => chart.image)).toEqual([image, null]);
    expect(chartsOf({ charts: [{}, { ref: 'toString' }] }).map((chart) => chart.image)).toEqual([null, null]);
  });

  it('marks a screenshot as removed only for a chart without an image whose picture was read', () => {
    const charts = [
      { ref: 'first', reading: 'Still has its image.' },
      { reading: 'Read from the picture.' },
      { scores: { chart_vision: 0 } },
      { scores: { chart_design: 0.7 } },
      { scores: { chart_fidelity: 1 } },
      { reading: '  ', scores: { chart_vision: 'n/a' } },
      {},
    ];
    const expiry = (days?: number) =>
      chartsOf({ charts }, data.chart_images, days).map((chart) => chart.imageExpiredAfterDays);
    expect(expiry(30)).toEqual([null, 30, 30, 30, null, null, null]);
    expect(expiry()).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('chart snapshots', () => {
  it('redraws the saved chart in a frame with an empty sandbox and a closed policy', async () => {
    const fetch = stubSnapshot(() => stored());
    const { container } = renderCharts(redrawn);
    const frame = await frameOf(container);
    // Empty, not merely present: every sandbox restriction applies.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame).toHaveAttribute('title', 'Redrawn line chart');
    expect(frame).toHaveAttribute('inert');
    expect(frame).toHaveAttribute('tabindex', '-1');
    const doc = frame.getAttribute('srcdoc')!;
    expect(SNAPSHOT_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:");
    // qym's head comes before any stored byte; the stored markup follows it unchanged.
    expect(doc).toBe(
      '<!doctype html><html><head><meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}">` +
        `<style>${CSS}</style></head>${HTML}`,
    );
    // The frame carries the same policy itself, from its first load.
    expect(frame.getAttribute('csp')).toBe(SNAPSHOT_CSP);
    const parsed = new DOMParser().parseFromString(doc, 'text/html');
    expect(parsed.compatMode).toBe('CSS1Compat');
    // The stored <html> tag still gives the root its attributes, and its empty head adds nothing.
    expect(parsed.documentElement.getAttribute('lang')).toBe('ar');
    expect(parsed.documentElement.getAttribute('dir')).toBe('rtl');
    expect(parsed.querySelectorAll('head')).toHaveLength(1);
    // The markup exists only as the frame's document, never as elements of the app's own.
    expect(document.querySelector('.card')).toBeNull();
    expect(document.body).not.toHaveTextContent('المبيعات');
    const origin = window.location.origin;
    expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual(
      [origin + snapshot.url, origin + snapshot.style_url].sort(),
    );
  });

  it('labels a redrawn chart and keeps the screenshot of the chart that has one', async () => {
    stubSnapshot(() => stored());
    const { container } = renderCharts(redrawn);
    await frameOf(container);
    const figure = container.querySelector('[data-live-chart-snapshot]')!;
    expect(figure).toHaveAttribute('data-live-chart-snapshot', 'ready');
    expect(figure.querySelector('figcaption')).toHaveTextContent('Redrawn from the saved chart.');
    expect(container.querySelectorAll('[data-live-chart-snapshot]')).toHaveLength(1);
    expect(container.querySelectorAll('figure[data-live-chart-image] img')).toHaveLength(1);
    expect(container.querySelector('[data-live-chart-image]')).not.toHaveTextContent('Redrawn');
  });

  it('keeps a stylesheet inside its style element whatever it contains', async () => {
    const css = 'a{}</style><script>alert(1)</script></STYLE ><style>b{}</StYlE>$&';
    stubSnapshot(() => stored(), css);
    const { container } = renderCharts(redrawn);
    const parsed = new DOMParser().parseFromString(
      (await frameOf(container)).getAttribute('srcdoc')!,
      'text/html',
    );
    expect(parsed.querySelectorAll('script')).toHaveLength(0);
    expect(parsed.querySelectorAll('style')).toHaveLength(1);
    expect(parsed.head.querySelector('style')!.textContent).toBe(
      'a{}<\\/style><script>alert(1)</script><\\/STYLE ><style>b{}<\\/StYlE>$&',
    );
    expect([...parsed.head.children].map((el) => el.tagName)).toEqual(['META', 'META', 'STYLE']);
    expect(parsed.body.querySelector('.card h2')!.textContent).toBe('المبيعات <b>');
  });

  it('builds the document only around the single empty head', () => {
    expect(snapshotDocument('<html><body></body></html>', CSS)).toBeNull();
    expect(snapshotDocument('<html><head></head><body><head></head></body></html>', CSS)).toBeNull();
    expect(snapshotDocument('<html><HEAD></HEAD><body></body></html>', CSS)).toBeNull();
    expect(snapshotDocument('<html><head></head><body>$1</body></html>', "a::after{content:'$&$1'}")).toBe(
      '<!doctype html><html><head><meta charset="utf-8">' +
        `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}">` +
        "<style>a::after{content:'$&$1'}</style></head><html><head></head><body>$1</body></html>",
    );
  });

  // Markup that puts something ahead of its head, or only quotes the head: a policy placed "at the head"
  // would land in the body, where browsers ignore it. The server refuses these; the page must hold anyway.
  it.each([
    '<html><img src="https://x/b"><head></head><body><div class="card"></div></body></html>',
    '<html><style>@import url(https://x/c)</style><head></head><body></body></html>',
    '<html><body><!--<head></head>--><img src="https://x/d"></body></html>',
    '<html><body><textarea><head></head></textarea><img src="https://x/e"></body></html>',
    '<html><svg><image href="https://x/g"/></svg><head></head><body></body></html>',
    '<html><frameset><frame src="https://x/h"></frameset><head></head>',
  ])('keeps its policy in the real head when the stored markup is %s', (html) => {
    const built = snapshotDocument(html, CSS)!;
    expect(built.endsWith(html)).toBe(true);
    const parsed = new DOMParser().parseFromString(built, 'text/html');
    const policy = parsed.head.querySelector('meta[http-equiv]')!;
    expect(policy.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(policy.getAttribute('content')).toBe(SNAPSHOT_CSP);
    expect(parsed.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
    // Only qym's charset line precedes it, and qym's stylesheet follows at once.
    expect([...parsed.head.children].slice(0, 3)).toEqual([
      parsed.head.querySelector('meta[charset]'),
      policy,
      parsed.head.querySelector('style'),
    ]);
    expect(parsed.head.querySelector('style')!.textContent).toBe(CSS);
    // Everything that came from the stored markup is after the policy in the document.
    const stored = [
      ...parsed.querySelectorAll('img, image, svg, frame, frameset, textarea, style, div'),
    ].filter((el) => el !== parsed.head.querySelector('style'));
    expect(stored.length).toBeGreaterThan(0);
    for (const el of stored)
      expect(policy.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prefers the snapshot over a screenshot, the expired state and the missing state', async () => {
    stubSnapshot(() => stored());
    const { container } = renderCharts({
      ...expired,
      chart_images: { first: image, second: image },
      chart_snapshots: { second: snapshot },
    });
    await frameOf(container);
    expect(container.querySelectorAll('[data-live-chart-snapshot="ready"]')).toHaveLength(1);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('[data-live-chart-expired]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-chart-missing]')).not.toBeInTheDocument();
    const charts = chartsOf(expired.summary, { first: image }, 30, { second: snapshot });
    expect(charts.map((chart) => chart.snapshot)).toEqual([null, snapshot]);
    expect(charts.map((chart) => chart.imageExpiredAfterDays)).toEqual([null, null]);
    expect(chartsOf(expired.summary, {}, 30, { toString: snapshot })[1]!.snapshot).toBeNull();
    expect(chartsOf(expired.summary, {}, 30)[1]!.imageExpiredAfterDays).toBe(30);
  });

  it('holds the chart height with a loading state while the saved chart is fetched', async () => {
    let release!: (response: Response) => void;
    stubSnapshot(() => new Promise<Response>((resolve) => (release = resolve)));
    const { container } = renderCharts(redrawn);
    const loading = container.querySelector('[data-live-chart-snapshot="loading"]')!;
    expect(within(loading as HTMLElement).getByRole('status', { name: 'Loading saved chart' })).toBeVisible();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[data-live-chart-missing]')).not.toBeInTheDocument();
    await waitFor(() => expect(release).toBeTypeOf('function'));
    release(stored());
    await frameOf(container);
    expect(container.querySelector('[data-live-chart-snapshot="loading"]')).not.toBeInTheDocument();
  });

  it('says that the saved chart failed to load and never that no screenshot was captured', async () => {
    let fail = true;
    stubSnapshot(() =>
      fail ? new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 }) : stored(),
    );
    const user = userEvent.setup();
    const { container } = renderCharts(redrawn);
    const failed = await waitFor(() => {
      const el = container.querySelector('[data-live-chart-snapshot="error"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(failed).toHaveTextContent('Couldn’t load the saved chart');
    expect(container).not.toHaveTextContent('No screenshot was captured');
    expect(container.querySelector('[data-live-chart-missing]')).not.toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    fail = false;
    await user.click(within(failed).getByRole('button', { name: /retry|try again/i }));
    expect((await frameOf(container)).getAttribute('sandbox')).toBe('');
  });

  it('refuses to draw saved markup that is not one chart document', async () => {
    stubSnapshot(() => stored('<html><body><div class="card"></div></body></html>'));
    const { container } = renderCharts(redrawn);
    await waitFor(() =>
      expect(container.querySelector('[data-live-chart-snapshot="error"]')).toHaveTextContent(
        'Couldn’t redraw the saved chart',
      ),
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.querySelector('.card')).toBeNull();
  });

  it('opens the same enlarge dialog and scales the frame to the space it has', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(312);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    stubSnapshot(() => stored());
    const user = userEvent.setup();
    const { container } = renderCharts(redrawn);
    const frame = await frameOf(container);
    // 312 px for a 624 px box: half size, with the box's corner moved to the frame's corner.
    expect(frame.style.width).toBe('1248px');
    expect(frame.style.height).toBe('332px');
    expect(frame.style.transform).toBe('translate(-50px, -10px) scale(0.5)');
    expect(frame.style.visibility).toBe('visible');
    const trigger = screen.getByRole('button', { name: 'Enlarge line chart' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'line chart' });
    const full = dialog.querySelector('iframe')!;
    expect(full.getAttribute('sandbox')).toBe('');
    expect(full.getAttribute('srcdoc')).toBe(frame.getAttribute('srcdoc'));
    // Fitted to both sides: 100 px of height allows less than 312 px of width does.
    expect(full.style.transform).toBe(
      `translate(${-100 * (100 / 312)}px, ${-20 * (100 / 312)}px) scale(${100 / 312})`,
    );
    expect(full.parentElement!.style.height).toBe('100px');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('lays the frame out at the captured width and hides it until the space is known', () => {
    const geometry = { viewport_width: 1248, box: { x: 0, y: 0.5, width: 1248, height: 461.5 } };
    expect(snapshotLayout(geometry, { width: 624, height: 0 }, 'width')).toEqual({
      scale: 0.5,
      clip: { width: 624, height: 230.75 },
      frame: { width: 1248, height: 462, transform: 'translate(0px, -0.25px) scale(0.5)' },
    });
    expect(snapshotLayout(geometry, { width: 2496, height: 461.5 }, 'contain').scale).toBe(1);
    for (const fit of ['width', 'contain'] as const)
      expect(snapshotLayout(geometry, { width: 0, height: 0 }, fit).scale).toBe(0);
    // The page is laid out at its captured height when the producer reported it; only the box shows.
    const available = { width: 624, height: 0 };
    const laidOut = (viewport_height?: number | null) =>
      snapshotLayout({ ...geometry, viewport_height }, available, 'width');
    expect(laidOut(600)).toEqual({ ...laidOut(), frame: { ...laidOut().frame, height: 600 } });
    expect(laidOut(null).frame.height).toBe(462);
    // A height above the box's bottom would make the frame cut the chart.
    expect(laidOut(300).frame.height).toBe(462);
    // In the dialog too, a taller page changes only the frame: the clip still shows just the box.
    const fitted = (viewport_height?: number) =>
      snapshotLayout({ ...geometry, viewport_height }, { width: 2496, height: 461.5 }, 'contain');
    expect(fitted(900)).toEqual({ ...fitted(), frame: { ...fitted().frame, height: 900 } });
    expect(fitted(900).clip).toEqual({ width: 1248, height: 461.5 });
  });

  it('lays the frame out at the height the page was captured at', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(312);
    stubSnapshot(() => stored());
    const { container } = renderCharts({
      ...data,
      chart_snapshots: { second: { ...snapshot, viewport_height: 600 } },
    });
    const frame = await frameOf(container);
    expect(frame.style.width).toBe('1248px');
    expect(frame.style.height).toBe('600px');
    expect(frame.style.transform).toBe('translate(-50px, -10px) scale(0.5)');
  });
});

function renderPending(tab: string, count?: number, cachedSource = liveOverview.status.key) {
  const source = liveOverview.status.key;
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  clients.push(client);
  if (count !== undefined) {
    client.setQueryData(['project', 'demo', 'live', 'turns', cachedSource, { day: '2026-11-01' }], {
      ...liveTurnsPage,
      rows: [{ ...liveTurnsPage.rows[0]!, charts: { count, failed: 0 } }],
    });
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`?tab=${tab}`]}>
        <LiveTurnPage slug="demo" source={source} turnId={liveTurnDetail.turn.turn_id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Charts loading frame', () => {
  it.each([
    [undefined, '1'],
    [2, '2'],
    [0, '0'],
  ] as const)('reserves %s cached charts with %s slots', async (count, slots) => {
    const { container } = renderPending('charts', count);
    await screen.findByRole('status', { name: 'Loading turn header' });
    expect(container.querySelector('[data-chart-slots]')).toHaveAttribute('data-chart-slots', slots);
    expect(screen.queryAllByRole('status', { name: /Loading chart screenshot/ })).toHaveLength(Number(slots));
    expect(screen.queryByRole('status', { name: 'Loading how we got here' })).not.toBeInTheDocument();
  });

  it('ignores the same turn id in a different source', () => {
    const { container } = renderPending('charts', 2, 'other-worker');
    expect(container.querySelector('[data-chart-slots]')).toHaveAttribute('data-chart-slots', '1');
  });

  it('reserves only Diagnosis evidence blocks below the shared header', async () => {
    const { container } = renderPending('diagnosis', 2);
    expect(container.querySelector('[data-chart-slots]')).not.toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Loading how we got here' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'How we got here',
      'Insightor rules behind this verdict',
      'What Insightor did',
    ]);
    expect(screen.queryByRole('status', { name: 'Loading judge deviations' })).not.toBeInTheDocument();
  });
  it.each([
    ['conversation', ['Turns in this conversation']],
    [
      'evaluator',
      ['How this turn was evaluated', 'Scores', 'Problems during evaluation', 'Raw evaluation detail'],
    ],
    ['services', ['Services', 'Tool calls']],
    ['answer', ['Final answer', 'SQL comparison']],
    ['judges', ['Judge A', 'Judge B']],
  ])('reserves only the %s tab cards', async (tab, titles) => {
    renderPending(tab as string);
    await screen.findByRole('status', { name: 'Loading turn header' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(
      titles,
    );
    expect(screen.queryByRole('status', { name: 'Loading how we got here' })).not.toBeInTheDocument();
  });
});
