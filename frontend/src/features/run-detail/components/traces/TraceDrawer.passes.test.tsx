/** C009: on a repeat run the drawer shows one pass, with a chip per pass in place of 'All attempts'. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
const trace = (attempts: number) => ({
  item: { item_id: 'item-1', trace_id: 'abc12345' },
  attempts: Array.from({ length: attempts }, (_, i) => ({
    attempt_number: i + 1,
    pass_number: 2,
    status: i + 1 < attempts ? 'failed' : 'completed',
    is_last_attempt: i + 1 === attempts,
    summary: { span_count: 2, duration_ms: 1 },
    spans: [span(`r${i}`, null, 'root'), span(`c${i}`, `r${i}`, 'call')],
  })),
});
let data = trace(1);
vi.mock('@/api/runs', () => ({ useItemTraceQuery: () => ({ data, isLoading: false, isError: false }) }));
vi.mock('../../RunContext', () => ({ useRunPage: () => ({ runId: 'r', payload: { run: {} } }) }));

import { TraceDrawer } from './TraceDrawer';

function show(passCount: number, onPass = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TraceDrawer itemId="item-1" pass={2} passCount={passCount} onPass={onPass} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onPass;
}

describe('trace drawer on a repeat run', () => {
  it('has a chip per pass, the open pass pressed, and a chip asks for its pass', () => {
    data = trace(1);
    const onPass = show(3);
    const group = screen.getByRole('group', { name: 'Passes' });
    const chips = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
    expect(chips).toEqual(['Pass 1', 'Pass 2', 'Pass 3']);
    expect(screen.queryByText('All attempts')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pass 2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pass 3' }));
    expect(onPass).toHaveBeenCalledWith(3);
  });

  it('retries inside the open pass stay combined, with their own chips', () => {
    data = trace(2);
    show(3);
    expect(screen.getByRole('group', { name: 'Attempts' })).toHaveTextContent('Retries combined');
    expect(screen.getByLabelText('Trace summary')).toHaveTextContent('2 attempts');
  });

  it('a single run keeps its attempt chips and no pass chips', () => {
    data = trace(2);
    show(0);
    expect(screen.queryByRole('group', { name: 'Passes' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Attempts' })).toHaveTextContent('All attempts');
  });
});
