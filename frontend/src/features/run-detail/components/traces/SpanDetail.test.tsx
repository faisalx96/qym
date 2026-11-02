/** Round 5 R4-3: a step opens on its content, never on its metadata. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SpanDetail } from './SpanDetail';
import type { SpanNode } from '../../lib/traceTree';

const span = (attributes: Record<string, unknown>): SpanNode =>
  ({
    span_id: 's1',
    name: 'step',
    status: 'OK',
    duration_ms: 10,
    attributes,
    events: [],
    children: [],
  }) as unknown as SpanNode;

const selected = () => screen.getByRole('tab', { selected: true }).textContent ?? '';

describe('SpanDetail default tab', () => {
  it('opens a span with input and output on Input / Output', () => {
    render(<SpanDetail node={span({ 'input.value': 'q', 'output.value': 'a' })} />);
    expect(selected()).toMatch(/^Input \/ Output/);
  });

  it('opens a span with no recorded content on a content tab with an empty state, not on Metrics', () => {
    render(<SpanDetail node={span({})} />);
    expect(selected()).toMatch(/^Input \/ Output/);
    expect(screen.getByText('No input or output was recorded for this step.')).toBeInTheDocument();
  });

  it('does not remember a Metrics pick for the next span', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SpanDetail node={span({ 'input.value': 'q' })} />);
    await user.click(screen.getByRole('tab', { name: /^Metrics/ }));
    expect(selected()).toMatch(/^Metrics/);
    unmount();
    render(<SpanDetail node={span({ 'input.value': 'q' })} />);
    expect(selected()).toMatch(/^Input \/ Output/);
  });
});
