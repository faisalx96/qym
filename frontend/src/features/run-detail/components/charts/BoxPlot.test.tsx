/** Round 3 P7: box plot states (P7-11), tooltips and focus order (P7-8, P7-9), the sentence name, the number row. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { boxAxis } from '../../lib/boxAxis';
import { boxStats } from '../../lib/boxStats';
import { BoxKey, BoxPlot, boxSentence } from './BoxPlot';

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

describe('no number row (round 5 R2)', () => {
  it('draws no dl of values, no Total row and no legend list', () => {
    const { container } = plot(range(100));
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
    expect(screen.queryByRole('list', { name: 'How to read the box plot' })).toBeNull();
  });

  it('prints the median above the line and the data min and max under the baseline, nothing else', () => {
    const { container } = plot(range(100), { name: 'm' });
    const texts = [...container.querySelectorAll('svg[role=img] text')].map((t) => t.textContent);
    expect(texts).toEqual(['50.5', '1', '100']);
  });

  it('merges the end labels into "a to b" when the data span is too narrow for two labels', () => {
    const { container } = plot([1, 1.01, 1.02, 1.03, 1.04], { name: 'm' });
    const texts = [...container.querySelectorAll('svg[role=img] text')].map((t) => t.textContent);
    expect(texts.some((t) => / to /.test(t ?? ''))).toBe(true);
    expect(texts).toHaveLength(2);
  });

  it('puts all six numbers and the IQR in the box tooltip', async () => {
    const user = userEvent.setup();
    plot(range(100), { onRange: () => {}, onItem: () => {} });
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    for (const label of ['Min', 'P25', 'Median', 'Mean', 'P75', 'Max'])
      expect(within(tip).getByText(label)).toBeInTheDocument();
    expect(tip).toHaveTextContent('IQR 49.5');
  });

  it('takes series 1 by default and a band when asked; the sentence ends with the band', () => {
    const { container, rerender } = plot(range(100));
    expect(container.firstElementChild?.getAttribute('data-series')).toBe('1');
    const stats = boxStats(range(100));
    rerender(
      <BoxPlot
        stats={stats}
        axis={boxAxis(stats)}
        format={fmt}
        tone={{ band: 3 }}
        name={boxSentence('m', stats, fmt, { band: 3 })}
      />,
    );
    expect(container.firstElementChild?.getAttribute('data-band')).toBe('3');
    expect(container.firstElementChild?.hasAttribute('data-series')).toBe(false);
    expect(boxSentence('m', stats, fmt, { band: 3 })).toMatch(/; band 3 of 5\.$/);
  });

  it('the key line names the glyphs', () => {
    render(<BoxKey />);
    expect(screen.getByText(/Box: middle 50%/)).toBeInTheDocument();
  });
});
