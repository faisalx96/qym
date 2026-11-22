/** The loading frame of the item pane is the loaded layout (DESIGN_LANGUAGE §7): the same blocks, no invented value. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaneSkeleton } from '../Frame';

describe('PaneSkeleton', () => {
  it('draws the blocks of the pane in order, the Metrics head and one row for each metric', () => {
    const { container } = render(
      <PaneSkeleton blocks={['input', 'expected', 'outputs', 'metrics']} metricRows={4} outputs={2} />,
    );
    const parts = Array.from(container.querySelectorAll('[data-part]'))
      .map((n) => n.getAttribute('data-part'))
      .filter((x) => ['input', 'expected', 'output', 'metrics-section', 'metrics'].includes(x!));
    expect(parts).toEqual(['input', 'expected', 'output', 'output', 'metrics-section', 'metrics']);
    expect(container.querySelector('[data-part="expected"]')!.getAttribute('data-tone')).toBe('gold');
    expect(container.querySelector('[data-part="metrics-section"] h3')!.textContent).toBe('Metrics');
    // a row for each metric that will arrive: the head and four rows
    expect(container.querySelectorAll('[data-part="metrics"] [data-loading] > div')).toHaveLength(5);
  });

  it('shows Skeleton shapes only: no value, no Loading word', () => {
    const { container } = render(<PaneSkeleton blocks={['input', 'expected', 'outputs', 'metrics']} />);
    expect(container.querySelectorAll('[role="status"]').length).toBeGreaterThan(3);
    expect(container.textContent).toBe('InputExpectedOutputMetricsMetric');
  });
});
