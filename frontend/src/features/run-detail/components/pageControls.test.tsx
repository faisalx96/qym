/**
 * C039, C154 (review group R1): the page metric, its Pass if threshold, the Filters rules and Clear live in the sticky
 * nav only. The Items bar keeps Search, Show, Sort, Display and the count; the Quick filters sidebar keeps only the
 * category and error picks.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyView } from '../lib/filterRules';

const view = { ...emptyView(), q: 'reconcile' };
const page = {
  api: {
    view,
    defs: [],
    selectedMetric: 'faithfulness',
    ctx: {},
    setView: () => undefined,
    setFilters: () => undefined,
    replaceView: () => undefined,
    clearFilters: () => undefined,
  },
  model: {
    metricNames: ['faithfulness', 'accuracy'],
    defaultMetric: 'faithfulness',
    defaultThresholds: { faithfulness: 0.7 },
    metricIsBoolean: {},
    metricTypes: {},
    metricDirections: { faithfulness: 'maximize' },
    autoCategories: [],
    rows: [],
    isRepeat: false,
    viewPass: null,
    samples: 1,
    allMetadataKeys: [],
    allMetricMetaKeys: [],
  },
  items: [],
  payload: { run: { run_id: 'r1' }, snapshot: { rows: [] } },
};
vi.mock('../RunContext', () => ({ useRunPage: () => page }));

import { QuickFilters } from './QuickFilters';
import { FilterBar } from './items/FilterBar';

describe('one control per concept on the run page', () => {
  it('the Items bar has no metric, slider, Filters or Clear', () => {
    render(<FilterBar display={{ textMode: 'raw', onTextMode: () => undefined }} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByTestId('items-metric')).toBeNull();
    expect(screen.queryByTestId('open-filters')).toBeNull();
    expect(screen.queryByTestId('clear-filters')).toBeNull();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Display/ })).toBeInTheDocument();
    expect(screen.getByTestId('items-count')).toHaveTextContent('0 of 0 items');
  });

  it('the Quick filters sidebar has no status, metric, slider, order or Clear all', () => {
    render(<QuickFilters onJump={() => undefined} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByText('Order by')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('Metric')).toBeNull();
    expect(screen.queryByText('ACTIVE')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
    expect(screen.getByTestId('quick-view-items')).toHaveTextContent('View 0 items');
  });
});
