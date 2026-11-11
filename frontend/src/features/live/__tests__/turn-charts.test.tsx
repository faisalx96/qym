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
    const trigger = screen.getByRole('button', { name: 'bar chart — Monthly totals increased.' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'bar chart — Monthly totals increased.' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', image.url);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('shows the missing state when a chart ref has no uploaded image', () => {
    const { container } = render(<ChartsTab data={data} />);
    expect(container.querySelector('[data-live-chart-missing]')).toHaveTextContent(
      'No screenshot was captured for this chart',
    );
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

  it('shows only the first chart as a thumbnail on Diagnosis', () => {
    const { container } = render(
      <DiagnosisTab data={{ ...data, chart_images: { first: image, second: image } }} />,
    );
    const card = container.querySelector('[data-live-block="chart"]')!;
    expect(card.querySelectorAll('img')).toHaveLength(1);
    expect(card.querySelector('figure')).toHaveClass(/chartThumb/);
    expect(screen.getByRole('img', { name: 'bar chart — Monthly totals increased.' })).toBeInTheDocument();
  });

  it('keeps the no-charts message on Diagnosis', () => {
    const { container } = render(<DiagnosisTab data={{ ...data, summary: {} }} />);
    expect(screen.getByText('No charts available for this turn.')).toBeInTheDocument();
    expect(container.querySelector('[data-live-chart-image]')).not.toBeInTheDocument();
  });

  it('matches images by ref and leaves missing refs and images null', () => {
    expect(chartsOf(data.summary, data.chart_images).map((chart) => chart.image)).toEqual([image, null]);
    expect(chartsOf({ charts: [{}, { ref: 'toString' }] }).map((chart) => chart.image)).toEqual([null, null]);
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
    expect(screen.queryByRole('status', { name: 'Loading diagnosis' })).not.toBeInTheDocument();
  });

  it('ignores the same turn id in a different source', () => {
    const { container } = renderPending('charts', 2, 'other-worker');
    expect(container.querySelector('[data-chart-slots]')).toHaveAttribute('data-chart-slots', '1');
  });

  it('keeps the existing loading frame for other tabs', async () => {
    const { container } = renderPending('diagnosis', 2);
    expect(container.querySelector('[data-chart-slots]')).not.toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Loading diagnosis' })).toBeInTheDocument();
  });
});
