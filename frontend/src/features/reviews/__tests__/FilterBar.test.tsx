import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CorrectionsPage } from '@/api/reviews';
import { activeFilterCount, FacetRow } from '../FilterBar';
import { filtersFromParams } from '../lib/filters';

const facets = {
  tasks: ['qa', 'sql'],
  datasets: ['golden'],
  models: ['gpt-4o'],
  run_names: ['run-1'],
  facet_counts: { task: {}, dataset: {}, model: {}, run_name: {} },
} as unknown as CorrectionsPage;

describe('Reviews filter bar (C152)', () => {
  it('counts the search and every set facet for Clear, never the status tab', () => {
    expect(activeFilterCount(filtersFromParams(new URLSearchParams('status=all'), 'p'))).toBe(0);
    expect(
      activeFilterCount(
        filtersFromParams(new URLSearchParams('q=x&task=qa&conf_min=10&source=ai_only'), 'p'),
      ),
    ).toBe(4);
  });

  it('writes each facet value on its trigger and shows Clear n only when something is set', () => {
    const { rerender } = render(
      <FacetRow
        filters={filtersFromParams(new URLSearchParams(''), 'p')}
        facets={facets}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('clear-filters')).toBeNull();
    rerender(
      <FacetRow
        filters={filtersFromParams(
          new URLSearchParams('task=qa&dataset=__none__&conf_min=20&conf_max=80'),
          'p',
        )}
        facets={facets}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^Task/ })).toHaveTextContent('qa');
    expect(screen.getByRole('button', { name: /^Dataset/ })).toHaveTextContent('None');
    expect(screen.getByTestId('confidence-trigger')).toHaveTextContent('Confidence · 20–80%');
    expect(screen.getByTestId('clear-filters')).toHaveTextContent('Clear 3');
  });
});
