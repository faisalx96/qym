/** RD11: an active filter chip in the Items bar is labelled (field apart from value), clamped, and removable with ×. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyView, type RunView } from '../../lib/filterRules';

const long = `RateLimitError: ${'the upstream service refused the call '.repeat(6)}`;
const view: RunView = {
  ...emptyView(),
  filters: { ...emptyView().filters, errors: { task: { kind: 'Task error', label: long } } },
};
const replaceView = vi.fn();

vi.mock('../../RunContext', () => ({
  useRunPage: () => ({
    api: { view, defs: [], selectedMetric: 'quality', setView: () => {}, replaceView },
    model: { allMetadataKeys: [], allMetricMetaKeys: [], samples: 1 },
    items: [],
    payload: { run: { run_id: 'r1' }, snapshot: { rows: [] } },
  }),
}));

import { FilterBar } from './FilterBar';

describe('FilterBar active chips (RD11)', () => {
  it('names the field, keeps the full error on hover, and × removes only that filter', () => {
    render(<FilterBar display={{ textMode: 'wrap' as never, onTextMode: () => {} }} />);
    const text = screen.getByTestId('active-filter');
    expect(text).toHaveAttribute('title', `Task error: ${long}`);
    expect(text.querySelector('[class*=chipField]')).toHaveTextContent('Task error');
    expect(text.querySelector('[class*=chipValue]')).toHaveTextContent(long.trim());
    fireEvent.click(screen.getByRole('button', { name: /^Remove filter: Task error: RateLimitError/ }));
    expect(replaceView).toHaveBeenCalledTimes(1);
    expect(replaceView.mock.calls[0]![0].filters.errors).toEqual({});
  });
});
