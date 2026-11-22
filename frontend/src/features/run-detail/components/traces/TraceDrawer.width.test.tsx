/** Round 3 T1: the trace drawer takes the full width and gives it back, as the item pane, and its edge resizes it. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const span = (id: string, parent: string | null, name: string) => ({
  span_id: id,
  parent_span_id: parent,
  name,
  start_time_ns: 0,
  end_time_ns: 1_000_000,
  duration_ms: 1,
  status: 'OK',
  attributes: {},
});
const data = {
  item: { item_id: 'item-1', trace_id: 'abc12345' },
  attempts: [
    {
      attempt_number: 1,
      pass_number: 1,
      status: 'completed',
      is_last_attempt: true,
      summary: { span_count: 2, duration_ms: 1 },
      spans: [span('r', null, 'root'), span('c', 'r', 'call')],
    },
  ],
};
vi.mock('@/api/runs', () => ({ useItemTraceQuery: () => ({ data, isLoading: false, isError: false }) }));
vi.mock('../../RunContext', () => ({ useRunPage: () => ({ runId: 'r', payload: { run: {} } }) }));

import { TraceDrawer } from './TraceDrawer';

const KEY = 'qym:trace-drawer-width';

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TraceDrawer itemId="item-1" pass={null} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const edge = () => screen.getByRole('separator', { name: 'Resize the trace drawer' });
const now = () => Number(edge().getAttribute('aria-valuenow'));

// jsdom's window is 1024px wide: the default is 97% of it (993), the narrowest 720, the widest the window
describe('trace drawer width', () => {
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('has a head button that takes the full width and gives it back', () => {
    show();
    expect(now()).toBe(993);
    const wide = screen.getByRole('button', { name: 'Use the full page width' });
    expect(wide).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(wide);
    expect(now()).toBe(1024);
    const back = screen.getByRole('button', { name: 'Give the page its room back' });
    expect(back).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(KEY)).toBe('1024');
    fireEvent.click(back);
    expect(now()).toBe(993);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is a separator with its range, that moves 16px a key and goes to the ends on Home / End', () => {
    show();
    expect(edge()).toHaveAttribute('aria-valuemin', '720');
    expect(edge()).toHaveAttribute('aria-valuemax', '1024');
    expect(edge()).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(edge(), { key: 'ArrowRight' });
    expect(now()).toBe(977);
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' });
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' });
    expect(now()).toBe(1009);
    fireEvent.keyDown(edge(), { key: 'End' });
    expect(now()).toBe(720);
    expect(localStorage.getItem(KEY)).toBe('720');
    fireEvent.keyDown(edge(), { key: 'Home' });
    expect(now()).toBe(1024);
    expect(screen.getByRole('button', { name: 'Give the page its room back' })).toBeInTheDocument();
  });

  it('a double click on the edge gives the default width back', () => {
    show();
    fireEvent.keyDown(edge(), { key: 'End' });
    expect(now()).toBe(720);
    fireEvent.doubleClick(edge());
    expect(now()).toBe(993);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('opens at the width the reader kept, inside the limits of the window', () => {
    localStorage.setItem(KEY, '800');
    const { unmount } = show();
    expect(now()).toBe(800);
    unmount();
    localStorage.setItem(KEY, '5000');
    show();
    expect(now()).toBe(1024);
  });
});
