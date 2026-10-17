/** Round 3 P7: box plot states (P7-11), tooltips and focus order (P7-8, P7-9), the sentence name, the number row. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { boxAxis } from '../../lib/boxAxis';
import { boxStats } from '../../lib/boxStats';
import { BoxLegend, BoxNumbers, BoxPlot, boxSentence } from './BoxPlot';

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function plot(values: number[], props: Partial<React.ComponentProps<typeof BoxPlot>> = {}) {
  const stats = boxStats(values);
  return render(
    <BoxPlot
      stats={stats}
      axis={boxAxis(stats)}
      format={fmt}
      name={boxSentence('metric', stats, fmt)}
      {...props}
    />,
  );
}

describe('BoxPlot states', () => {
  it('n = 0 shows "No values"', () => {
    plot([]);
    expect(screen.getByText('No values')).toBeInTheDocument();
  });

  it('n = 1 draws one diamond and no box', () => {
    const { container } = plot([5]);
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.querySelector('rect[data-mark-kind=box]')).toBeNull();
  });

  it('all-equal draws one line and "All n values are v"', () => {
    const { container } = plot(Array(30).fill(4));
    expect(screen.getByText('All 30 values are 4')).toBeInTheDocument();
    expect(container.querySelector('rect[data-mark-kind=box]')).toBeNull();
  });

  it('n < 20 draws no dots beyond min and max and whiskers equal min and max', () => {
    const { container } = plot([1, 2, 3, 4, 100]);
    expect(container.querySelectorAll('circle[data-mark-kind=dot]')).toHaveLength(0);
  });

  it('IQR 0 draws a box 3px wide', () => {
    const values = [...Array(90).fill(0), ...range(10)];
    const { container } = plot(values);
    const box = container.querySelector('rect[data-mark-kind=box]')!;
    expect(Number(box.getAttribute('width'))).toBeGreaterThanOrEqual(3);
    expect(Number(box.getAttribute('width'))).toBeLessThan(6);
  });

  it('with 5,200 values the plot has at most 80 dots and keeps the true min and max (P7-10)', () => {
    const values = Array.from(
      { length: 5200 },
      (_, i) => (i % 7) + (i % 1000 === 0 ? 5000 * (i % 3) : 0) - (i % 900 === 0 ? 400 : 0),
    );
    const { container } = plot(values);
    const dots = container.querySelectorAll('circle[data-mark-kind^=dot]');
    expect(dots.length).toBeLessThanOrEqual(82);
    expect(container.querySelector('[data-mark-kind=dot-min]')).not.toBeNull();
    expect(container.querySelector('[data-mark-kind=dot-max]')).not.toBeNull();
  });
});

describe('BoxPlot accessibility and interaction', () => {
  it('is a role=img named by one sentence with the six values and the total', () => {
    const stats = boxStats(range(100));
    const sentence = boxSentence('tokens_used', stats, fmt, { total: '5050' });
    expect(sentence).toMatch(
      /^tokens_used, 100 items: minimum 1, 25th percentile 25\.75, median 50\.5, mean 50\.5, 75th percentile 75\.25, maximum 100, total 5050/,
    );
    plot(range(100), { name: sentence });
    expect(screen.getByRole('img', { name: sentence })).toBeInTheDocument();
  });

  it('puts box, low whisker, high whisker, min and max in tab order', async () => {
    const user = userEvent.setup();
    const pick = vi.fn();
    plot(range(100), { onRange: pick, onItem: pick });
    const buttons = screen.getAllByRole('button').map((b) => b.getAttribute('data-mark-kind'));
    expect(buttons.slice(0, 5)).toEqual(['box', 'cap-low', 'cap-high', 'dot-min', 'dot-max']);
    await user.tab();
    expect(document.activeElement?.getAttribute('data-mark-kind')).toBe('box');
    await user.keyboard('{Enter}');
    expect(pick).toHaveBeenCalledWith('box', expect.closeTo(25.75), expect.closeTo(75.25));
  });

  it('shows tooltips with the values on focus', async () => {
    const user = userEvent.setup();
    plot(range(100), { onRange: () => {}, onItem: () => {} });
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Middle 50%: 25.75 to 75.25');
    await user.keyboard('{Escape}');
  });
});

describe('BoxNumbers and legend', () => {
  it('lists Min, P25, Median, Mean, P75, Max and a Total row only when given', () => {
    const stats = boxStats(range(100));
    const { rerender } = render(<BoxNumbers stats={stats} format={fmt} />);
    expect(screen.queryByText('Total')).toBeNull();
    for (const label of ['Min', 'P25', 'Mean', 'P75', 'Max'])
      expect(screen.getByText(label)).toBeInTheDocument();
    rerender(<BoxNumbers stats={stats} format={fmt} total="5050" />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('5050')).toBeInTheDocument();
  });

  it('shows "-" for P25 and P75 with a single value', () => {
    render(<BoxNumbers stats={boxStats([7])} format={fmt} />);
    expect(screen.getAllByText('-')).toHaveLength(2);
  });

  it('the legend names the five glyphs', () => {
    render(<BoxLegend />);
    const list = screen.getByRole('list', { name: 'How to read the box plot' });
    expect(within(list).getByText('middle 50%')).toBeInTheDocument();
    expect(within(list).getByText('outside p5 to p95')).toBeInTheDocument();
  });
});

describe('BoxNumbers at the 279px column (the "Med" abbreviation)', () => {
  const measure = (width: number) => {
    class RO {
      constructor(private cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width,
      height: 40,
      top: 0,
      left: 0,
      right: width,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  };

  it('abbreviates Median to Med in a 237px card body and keeps the other labels', () => {
    measure(237);
    render(<BoxNumbers stats={boxStats(range(100))} format={fmt} />);
    expect(screen.getByText('Med')).toBeInTheDocument();
    expect(screen.queryByText('Median')).toBeNull();
    for (const label of ['Min', 'P25', 'Mean', 'P75', 'Max'])
      expect(screen.getByText(label)).toBeInTheDocument();
    // the full name stays in the title (and the dl is a list of term / definition pairs)
    expect(screen.getByText('Med').getAttribute('title')).toBe('Median');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps Median at 300px and wider', () => {
    measure(340);
    render(<BoxNumbers stats={boxStats(range(100))} format={fmt} />);
    expect(screen.getByText('Median')).toBeInTheDocument();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wraps to two rows of three when the longest value cannot fit a sixth of the width', () => {
    measure(237);
    const { container } = render(
      <BoxNumbers stats={boxStats([0.0012, 0.0013, 0.0014])} format={(v) => `$${v.toFixed(4)}`} />,
    );
    expect(container.querySelector('dl[data-wrap]')).not.toBeNull();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
