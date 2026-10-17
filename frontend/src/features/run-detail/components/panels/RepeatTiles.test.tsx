/** Round 3 P2: seven tiles (three for a metric without pass rates), flat, in the legacy order, one meaning line each. */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { repeatCopy, tileMeaning } from '../../lib/repeatCopy';
import { stepForWidth } from '../../lib/columnStep';
import { RepeatTiles } from './RepeatTiles';

const stats = {
  k: 10,
  pass_at_k: 1,
  pass_hat_k: 0.042,
  consistency: 0.333,
  reliability: 0.567,
  avg_at_k: 0.567,
};
const base = {
  stats,
  k: 10,
  metric: 'correct',
  metricType: 'boolean',
  direction: 'maximize' as const,
  avgLatencyMs: 1800,
  errors: 0,
  copy: repeatCopy(10, true, 100, 'maximize'),
};

describe('RepeatTiles', () => {
  it('renders seven tiles in the legacy order with no group labels', () => {
    const { container } = render(<RepeatTiles {...base} passBased />);
    const items = within(screen.getByRole('list', { name: 'Repeat run statistics' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(7);
    expect(items.map((i) => i.getAttribute('data-tile'))).toEqual([
      'pass_at_k',
      'pass_hat_k',
      'consistency',
      'reliability',
      'avg',
      'latency',
      'errors',
    ]);
    expect(container.querySelector('[data-group]')).toBeNull();
    for (const i of items) {
      const meaning = i.querySelector('[data-part=meaning]')!.textContent!;
      expect(meaning.length).toBeGreaterThan(0);
      expect(meaning.length).toBeLessThanOrEqual(80);
    }
  });

  it('renders three tiles for a numeric metric (Avg score, Avg latency, Errors)', () => {
    render(<RepeatTiles {...base} passBased={false} metricType="numeric" direction={null} />);
    const items = within(screen.getByRole('list', { name: 'Repeat run statistics' })).getAllByRole(
      'listitem',
    );
    expect(items.map((i) => i.getAttribute('data-tile'))).toEqual(['avg', 'latency', 'errors']);
  });

  it('bands pass rates and leaves latency and errors neutral; errors above 0 are danger', () => {
    const { container } = render(<RepeatTiles {...base} passBased errors={3} />);
    expect(
      container.querySelector('[data-tile=pass_at_k] [data-part=value]')!.getAttribute('data-band'),
    ).toBe('5');
    expect(
      container.querySelector('[data-tile=latency] [data-part=value]')!.getAttribute('data-band'),
    ).toBeNull();
    expect(container.querySelector('[data-tile=errors] [data-part=value]')!.hasAttribute('data-danger')).toBe(
      true,
    );
  });
});

describe('tileMeaning and column steps', () => {
  it('writes the k into the sentence', () => {
    expect(tileMeaning('pass_at_k', 10, 'm')).toBe('Items that passed in at least 1 of 10 passes');
    expect(tileMeaning('avg', 10, 'correct')).toBe('Mean of correct over all passes');
  });

  it('names the four steps of the report column', () => {
    expect([1193, 1033, 777, 521, 279].map(stepForWidth)).toEqual([
      'wide',
      'mid',
      'narrow',
      'compact',
      'compact',
    ]);
  });
});
