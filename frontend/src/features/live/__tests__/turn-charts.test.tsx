import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { liveOverview, liveTurnDetail, liveTurnsPage } from '@/features/dev/liveFixtures';
import { LiveTurnPage } from '../LiveTurnPage';
import { ChartsTab } from '../components/turn/ChartsTab';
import { DiagnosisTab } from '../components/turn/DiagnosisTab';
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
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

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
