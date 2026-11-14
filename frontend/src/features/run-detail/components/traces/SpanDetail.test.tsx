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

  it('does not remember a Raw pick for the next span', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SpanDetail node={span({ 'input.value': 'q' })} />);
    await user.click(screen.getByRole('tab', { name: /^Raw/ }));
    expect(selected()).toMatch(/^Raw/);
    unmount();
    render(<SpanDetail node={span({ 'input.value': 'q' })} />);
    expect(selected()).toMatch(/^Input \/ Output/);
  });
});

describe('SpanDetail follows the item pane', () => {
  const llm = (status: string) =>
    ({
      ...span({
        'openinference.span.kind': 'LLM',
        'llm.model_name': 'gpt-4.1',
        'llm.token_count.total': 1200,
        'llm.input_messages.0.message.role': 'system',
        'llm.input_messages.0.message.content': 'You are a support agent.',
        'llm.input_messages.1.message.role': 'user',
        'llm.input_messages.1.message.content': 'Where is my order?',
        'llm.output_messages.0.message.role': 'assistant',
        'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'get_order_status',
        'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{"order_id":"A-1"}',
      }),
      status,
    }) as SpanNode;

  it('shows the facts of the span in the stat strip and has no Metrics tab', () => {
    render(<SpanDetail node={llm('OK')} />);
    const facts = screen.getByLabelText('Span facts');
    expect(facts).toHaveTextContent('Duration');
    expect(facts).toHaveTextContent('Tokens');
    expect(facts).toHaveTextContent('1,200');
    expect(screen.queryByRole('tab', { name: /^Metrics/ })).toBeNull();
    expect(screen.getByText('LLM call · gpt-4.1')).toBeInTheDocument();
  });

  it('gives each block the tone of its part: the user message blue, the answer by the status of the call', () => {
    const { unmount } = render(<SpanDetail node={llm('OK')} />);
    expect(screen.getByRole('region', { name: 'System' })).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByRole('region', { name: 'User' })).toHaveAttribute('data-tone', 'info');
    expect(screen.getByRole('region', { name: 'Assistant' })).toHaveAttribute('data-tone', 'success');
    unmount();
    render(<SpanDetail node={llm('ERROR')} />);
    expect(screen.getByRole('region', { name: 'Assistant' })).toHaveAttribute('data-tone', 'danger');
  });

  it('shows a tool call with its name and its arguments as fields', () => {
    render(<SpanDetail node={llm('OK')} />);
    const answer = screen.getByRole('region', { name: 'Assistant' });
    expect(answer).toHaveTextContent('get_order_status');
    expect(answer).toHaveTextContent('order_id');
    expect(answer).toHaveTextContent('A-1');
  });

  it('shows JSON as fields, and the raw JSON switch changes its own block only', async () => {
    const user = userEvent.setup();
    render(
      <SpanDetail
        node={span({ 'input.value': '{"order_id":"A-1"}', 'output.value': '{"status":"shipped"}' })}
      />,
    );
    const input = screen.getByRole('region', { name: 'Input' });
    const output = screen.getByRole('region', { name: 'Output' });
    expect(input).toHaveAttribute('data-tone', 'info');
    expect(output).toHaveAttribute('data-tone', 'success');
    expect(input.querySelector('pre')).toBeNull();
    const switches = screen.getAllByRole('button', { name: 'Show the raw JSON' });
    expect(switches).toHaveLength(2);
    await user.click(switches[0]!);
    expect(input.querySelector('pre')).toHaveTextContent('"order_id": "A-1"');
    expect(output.querySelector('pre')).toBeNull();
  });

  it('has a copy tile and an expand tile on each block, and no raw switch on plain text', () => {
    render(<SpanDetail node={span({ 'input.value': 'q', 'output.value': 'a' })} />);
    for (const name of ['Copy input', 'Expand input', 'Copy output', 'Expand output', 'Copy span id'])
      expect(screen.getByRole('button', { name })).toHaveAttribute('data-tile');
    expect(screen.queryByRole('button', { name: 'Show the raw JSON' })).toBeNull();
  });

  it('shows an exception as a red block', () => {
    const node = {
      ...span({ 'input.value': 'q' }),
      status: 'ERROR',
      events: [
        {
          name: 'exception',
          attributes: { 'exception.type': 'TimeoutError', 'exception.message': 'the tool did not answer' },
        },
      ],
    } as unknown as SpanNode;
    render(<SpanDetail node={node} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('TimeoutError');
    expect(alert).toHaveTextContent('the tool did not answer');
    expect(screen.getByRole('region', { name: 'Error' })).toHaveAttribute('data-tone', 'danger');
  });
});
