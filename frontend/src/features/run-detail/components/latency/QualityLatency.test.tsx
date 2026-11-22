/** RD9: a boolean metric's Quality vs latency has no "Pass = true" legend entry and no 50% threshold line. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../RunContext', () => ({
  useRunPage: () => ({ api: { view: { filters: { latency: null } }, setItemParam: () => {} } }),
}));

import { QualityLatency, type QualityMetric } from './QualityLatency';

const items = Array.from({ length: 12 }, (_, i) => ({
  itemId: `it-${i}`,
  latency: 300 + i * 150,
  error: false,
  score: i % 3 === 0 ? 0 : 1,
}));

const draw = (metric: QualityMetric) => render(<QualityLatency items={items} metric={metric} />);

describe('QualityLatency (RD9)', () => {
  it('a boolean metric: no Pass legend item, no threshold line, the axis reads false and true', () => {
    const { container } = draw({ name: 'correct', direction: 'maximize', threshold: 0.5, isBoolean: true });
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend).not.toHaveTextContent(/Pass/);
    expect(legend).toHaveTextContent('Median latency');
    expect(container.querySelector('line[class*=passLine]')).toBeNull();
    const ticks = [...container.querySelectorAll('svg text[class*=tick]')].map((t) => t.textContent);
    expect(ticks).toContain('false');
    expect(ticks).toContain('true');
    expect(ticks.some((t) => /%$/.test(t ?? ''))).toBe(false);
  });

  it('a boolean averaged over repeat passes keeps a percent axis, still with no threshold line', () => {
    const shares = items.map((it, i) => ({ ...it, score: (i % 5) / 4 }));
    const { container } = render(
      <QualityLatency
        items={shares}
        metric={{ name: 'correct', direction: 'maximize', threshold: 0.5, isBoolean: true }}
      />,
    );
    const ticks = [...container.querySelectorAll('svg text[class*=tick]')].map((t) => t.textContent);
    expect(ticks).toContain('0%');
    expect(ticks).toContain('100%');
    expect(ticks).not.toContain('true');
    expect(container.querySelector('line[class*=passLine]')).toBeNull();
    expect(screen.getByRole('list', { name: 'Legend' })).not.toHaveTextContent(/Pass/);
  });

  it('a scored metric keeps its threshold line and its Pass legend item', () => {
    const { container } = draw({ name: 'quality', direction: 'maximize', threshold: 0.7, isBoolean: false });
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent(/Pass ≥\s?70%/);
    expect(container.querySelector('line[class*=passLine]')).not.toBeNull();
  });
});
