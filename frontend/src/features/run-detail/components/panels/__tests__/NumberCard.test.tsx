/** RD3, RD4, RD5: the plain-number card: a quiet count-only caption, no Min/Max, exactly median / 50% interval / p90 KPIs. */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as BoxCardModule from '../../charts/BoxCard';

vi.mock('../../charts/BoxCard', async (orig) => ({
  ...(await orig<typeof BoxCardModule>()),
  BoxCardBody: () => <div data-testid="box-body" />,
}));

import { NumberCard } from '../OverviewTab';

const entries = Array.from({ length: 100 }, (_, i) => ({ id: `i${i + 1}`, v: i + 1 }));

describe('NumberCard (RD3-RD5)', () => {
  it('puts the count in a caption on the number row, not in a tag in the title', () => {
    render(<NumberCard title="tokens_used" kind="tokens" entries={entries} field="metric:tokens_used" />);
    const card = screen.getByRole('region', { name: 'tokens_used' });
    expect(card.querySelector('[class*=tag]')).toBeNull();
    // round 2 RD3: the caption is the item count only, no total
    expect(screen.getByTestId('number-card-caption')).toHaveTextContent(/^100 items$/);
  });

  it('shows exactly Median, 50% interval and 90th percentile, each with its plot symbol, and no Min or Max', () => {
    const { container } = render(
      <NumberCard title="tokens_used" kind="tokens" entries={entries} field="metric:tokens_used" />,
    );
    const facts = [...container.querySelectorAll('dl > div')];
    expect(facts.map((f) => f.querySelector('dt')?.textContent)).toEqual([
      'Median',
      '50% interval',
      '90th percentile',
    ]);
    expect(facts.map((f) => f.querySelector('svg[data-glyph]')?.getAttribute('data-glyph'))).toEqual([
      'median',
      'interval',
      'p90',
    ]);
    const dl = container.querySelector('dl')!;
    expect(within(dl as HTMLElement).queryByText(/^Min|^Max|^Total/)).toBeNull();
    expect(facts[2]!.querySelector('dd')?.textContent).toMatch(/^90/);
    expect(container.querySelector('[data-glyph=mean]')).not.toBeNull();
  });

  it('a value that can be negative shows the same count-only caption', () => {
    render(
      <NumberCard
        title="delta"
        kind="tokens"
        entries={[
          { id: 'a', v: -1 },
          { id: 'b', v: 2 },
        ]}
        field="metric:delta"
      />,
    );
    expect(screen.getByTestId('number-card-caption')).toHaveTextContent(/^2 items$/);
  });
});
