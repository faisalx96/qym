/** Round 5 R4-3: a step opens on its content, never on its metadata. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  it('shows the facts of the span on one line under its name and has no Metrics tab', () => {
    render(<SpanDetail node={llm('OK')} />);
    const facts = screen.getByTestId('span-facts');
    expect(facts).toHaveTextContent('gpt-4.1');
    expect(facts).toHaveTextContent('1,200 tokens');
    expect(screen.getByRole('heading', { name: 'step' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'LLM call' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Metrics/ })).toBeNull();
  });

  it('gives each block the tone of its part: the user message blue, the answer by the status of the call', () => {
    const { unmount } = render(<SpanDetail node={llm('OK')} />);
    expect(screen.getByRole('article', { name: 'System message' })).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByRole('article', { name: 'User message' })).toHaveAttribute('data-tone', 'info');
    expect(screen.getByRole('article', { name: 'Assistant message' })).toHaveAttribute(
      'data-tone',
      'success',
    );
    expect(screen.getByRole('region', { name: 'Input messages' })).toHaveAttribute('data-tone', 'info');
    expect(screen.getByRole('region', { name: 'Output messages' })).toHaveAttribute('data-tone', 'success');
    unmount();
    render(<SpanDetail node={llm('ERROR')} />);
    expect(screen.getByRole('article', { name: 'Assistant message' })).toHaveAttribute('data-tone', 'danger');
  });

  it('shows a tool call with its name, a CALL mark and its arguments as JSON', () => {
    render(<SpanDetail node={llm('OK')} />);
    const answer = screen.getByRole('group', { name: 'Tool call get_order_status' });
    expect(screen.getByRole('article', { name: 'Assistant message' })).toContainElement(answer);
    expect(answer).toHaveTextContent('get_order_status');
    expect(answer).toHaveTextContent('order_id');
    expect(answer).toHaveTextContent('CALL');
    expect(answer).toHaveTextContent('"A-1"');
    expect(answer.querySelector('[data-json]')).not.toBeNull();
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
    expect(input.querySelector('[data-json]')).toBeNull();
    const switches = screen.getAllByRole('button', { name: 'Show the raw JSON' });
    expect(switches).toHaveLength(2);
    await user.click(switches[0]!);
    expect(input.querySelector('[data-json]')).toHaveTextContent('"order_id": "A-1"');
    expect(output.querySelector('[data-json]')).toBeNull();
  });

  it('has a copy action and an expand action on each block, and no raw switch on plain text', () => {
    render(<SpanDetail node={span({ 'input.value': 'q', 'output.value': 'a' })} />);
    for (const name of ['Copy input', 'Expand input', 'Copy output', 'Expand output', 'Copy span id'])
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('data-tile');
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

describe('SpanDetail per kind (round 3 T2: the pre-React viewer, in the new design)', () => {
  const node = (id: string, attributes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({
      span_id: id,
      name: id,
      status: 'OK',
      duration_ms: 10,
      start_time_ns: 0,
      end_time_ns: 1,
      attributes,
      events: [],
      _children: [],
      ...extra,
    }) as unknown as SpanNode;

  it('opens an LLM span on its conversation, with the Response tab next to it', () => {
    render(
      <SpanDetail
        node={node('model', {
          'openinference.span.kind': 'LLM',
          'input.value': JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
          'output.value': JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hello' } }] }),
        })}
      />,
    );
    expect(selected()).toMatch(/^Messages/);
    expect(screen.getByRole('tab', { name: /^Response/ })).toBeInTheDocument();
    expect(screen.getByTestId('span-thread')).toHaveTextContent('Hello');
  });

  it('opens a retriever on its documents, first', () => {
    render(
      <SpanDetail
        node={node('search_policies', {
          'openinference.span.kind': 'RETRIEVER',
          'input.value': 'refund window',
          'retrieval.documents.0.document.content': 'Returns are open for 60 days.',
          'retrieval.documents.0.document.metadata': '{"title":"Policy 4.1"}',
        })}
      />,
    );
    expect(selected()).toMatch(/^Documents/);
    expect(screen.getByText('Returns are open for 60 days.')).toBeInTheDocument();
    // the title heads the document (and stays in its metadata too)
    expect(screen.getAllByText('Policy 4.1').length).toBeGreaterThan(0);
  });

  it('links a tool span to the model call that asked for it, in one click', async () => {
    const user = userEvent.setup();
    const caller = node('ChatOpenAI', {
      'openinference.span.kind': 'LLM',
      'llm.output_messages.0.message.role': 'assistant',
      'llm.output_messages.0.message.tool_calls.0.tool_call.id': 'call_7',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'lookup_order',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{"id":"A-1"}',
    });
    const tool = node(
      'lookup_order',
      {
        'openinference.span.kind': 'TOOL',
        'tool.name': 'lookup_order',
        'tool_call.id': 'call_7',
        'input.value': '{"id":"A-1"}',
      },
      { start_time_ns: 5 },
    );
    const onOpenSpan = vi.fn();
    render(<SpanDetail node={tool} nodes={[caller, tool]} onOpenSpan={onOpenSpan} />);
    expect(screen.getByText('Called by')).toBeInTheDocument();
    expect(screen.getByText('call_7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open span ChatOpenAI' }));
    expect(onOpenSpan).toHaveBeenCalledWith('ChatOpenAI');
  });

  it('opens the tool span from the tool call in the conversation', async () => {
    const user = userEvent.setup();
    const caller = node('ChatOpenAI', {
      'openinference.span.kind': 'LLM',
      'llm.output_messages.0.message.role': 'assistant',
      'llm.output_messages.0.message.tool_calls.0.tool_call.id': 'call_7',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'lookup_order',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{"id":"A-1"}',
    });
    const tool = node('lookup_order', {
      'openinference.span.kind': 'TOOL',
      'tool.name': 'lookup_order',
      'tool_call.id': 'call_7',
    });
    const onOpenSpan = vi.fn();
    render(<SpanDetail node={caller} nodes={[caller, tool]} onOpenSpan={onOpenSpan} />);
    const call = screen.getByRole('group', { name: 'Tool call lookup_order' });
    await user.click(within(call).getByRole('button', { name: 'Open span lookup_order' }));
    expect(onOpenSpan).toHaveBeenCalledWith('lookup_order');
  });

  it('shows an agent the conversation of its last model call, with a link to that call', () => {
    const model = node('ChatOpenAI', {
      'openinference.span.kind': 'LLM',
      'input.value': JSON.stringify({ messages: [{ role: 'user', content: 'Do you ship to Iceland?' }] }),
    });
    const agent = node(
      'support_agent',
      { 'openinference.span.kind': 'AGENT', 'input.value': 'q' },
      { _children: [model] },
    );
    render(<SpanDetail node={agent} nodes={[agent, model]} onOpenSpan={() => {}} />);
    expect(selected()).toMatch(/^Input \/ Output/);
    expect(screen.getByRole('tab', { name: /^Messages/ })).toBeInTheDocument();
  });

  it('says so when a step recorded an output and no input', () => {
    render(
      <SpanDetail node={node('guard', { 'openinference.span.kind': 'GUARDRAIL', 'output.value': 'pass' })} />,
    );
    expect(screen.getByText('No input was recorded for this step.')).toBeInTheDocument();
  });

  it('names the failing child when a step failed with no message of its own', () => {
    const child = node(
      'lookup_order',
      {},
      {
        status: 'ERROR',
        events: [
          { name: 'exception', attributes: { 'exception.type': 'KeyError', 'exception.message': 'A-9' } },
        ],
      },
    );
    const parent = node('support_agent', { 'input.value': 'q' }, { status: 'ERROR', _children: [child] });
    render(<SpanDetail node={parent} nodes={[parent, child]} onOpenSpan={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('KeyError');
    expect(alert).toHaveTextContent('lookup_order');
  });
});

describe('SpanDetail tool JSON (round 3 T2: JSON first; SQL and tables parsed in the fields view only)', () => {
  const tool = (input: unknown, output?: unknown) =>
    span({
      'openinference.span.kind': 'TOOL',
      'tool.name': 'run_sql',
      'input.value': typeof input === 'string' ? input : JSON.stringify(input),
      ...(output === undefined
        ? {}
        : { 'output.value': typeof output === 'string' ? output : JSON.stringify(output) }),
    });

  it('opens the input and output of a tool span as JSON, and the switch shows the fields', async () => {
    const user = userEvent.setup();
    render(<SpanDetail node={tool({ order_id: 'A-1' }, { status: 'shipped' })} />);
    const input = screen.getByRole('region', { name: 'Input' });
    const code = input.querySelector('[data-json]');
    expect(code).toHaveTextContent('"order_id": "A-1"');
    expect(code).toHaveTextContent(/^1/);
    const toggles = screen.getAllByRole('button', { name: 'Show the fields' });
    expect(toggles).toHaveLength(2);
    for (const t of toggles) expect(t).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggles[0]!);
    expect(input.querySelector('[data-json]')).toBeNull();
    expect(within(input).getByRole('button', { name: 'Show the raw JSON' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('region', { name: 'Output' }).querySelector('[data-json]')).not.toBeNull();
  });

  it('keeps the JSON of a plain step behind the switch: fields first', () => {
    render(<SpanDetail node={span({ 'input.value': '{"order_id":"A-1"}' })} />);
    expect(screen.getByRole('button', { name: 'Show the raw JSON' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps a SQL string as a string in the JSON, and formats the query in the fields view', async () => {
    const user = userEvent.setup();
    render(
      <SpanDetail node={tool({ query: 'select id from refunds where order_id = 1', database: 'ledger' })} />,
    );
    const input = screen.getByRole('region', { name: 'Input' });
    const code = input.querySelector('[data-json]')!;
    expect(code).toHaveTextContent('"query": "select id from refunds where order_id = 1",');
    expect(code).toHaveTextContent('"database": "ledger"');
    expect(code.querySelector('pre[data-lang="sql"]')).toBeNull();
    await user.click(within(input).getByRole('button', { name: 'Show the fields' }));
    expect(input.querySelector('pre[data-lang="sql"]')).toHaveTextContent(/from refunds/);
  });

  it('keeps a list of records as JSON lines, and shows the table in the fields view', async () => {
    const user = userEvent.setup();
    const out = {
      order_id: 'A-1',
      lines: [
        { sku: 'TRAIL-RUN-9', qty: 1 },
        { sku: 'SOCK-MERINO-3', qty: 2 },
      ],
    };
    render(<SpanDetail node={tool({ order_id: 'A-1' }, out)} />);
    const output = screen.getByRole('region', { name: 'Output' });
    const code = output.querySelector<HTMLElement>('[data-json]')!;
    const fold = within(code).getByRole('button', { name: 'lines' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(within(code).queryByRole('grid')).toBeNull();
    expect(code).toHaveTextContent('"sku": "SOCK-MERINO-3"');
    await user.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(code).toHaveTextContent('2 items');
    expect(within(code).queryByRole('grid')).toBeNull();
    await user.click(within(output).getByRole('button', { name: 'Show the fields' }));
    expect(within(output).getByRole('grid')).toHaveTextContent('SOCK-MERINO-3');
  });

  it('shows a value that is a list of records as JSON too, and a query text as the query', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <SpanDetail
        node={tool('select 1', [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ])}
      />,
    );
    const output = screen.getByRole('region', { name: 'Output' });
    expect(output.querySelector('[data-json]')).toHaveTextContent('"name": "b"');
    expect(within(output).queryByRole('grid')).toBeNull();
    await user.click(within(output).getByRole('button', { name: 'Show the fields' }));
    expect(within(output).getByRole('grid')).toHaveTextContent('name');
    unmount();
    // a text that is not JSON has no JSON view: the query is formatted
    render(<SpanDetail node={tool('SELECT id FROM refunds WHERE order_id = 1')} />);
    const input = screen.getByRole('region', { name: 'Input' });
    expect(input.querySelector('pre[data-lang="sql"]')).toHaveTextContent(/FROM/);
  });

  it('opens a tool result message in a conversation as JSON', () => {
    render(
      <SpanDetail
        node={span({
          'openinference.span.kind': 'LLM',
          'llm.input_messages.0.message.role': 'tool',
          'llm.input_messages.0.message.name': 'lookup_order',
          'llm.input_messages.0.message.tool_call_id': 'call_1',
          'llm.input_messages.0.message.content': '{"status":"delivered"}',
          'llm.output_messages.0.message.role': 'assistant',
          'llm.output_messages.0.message.content': 'It was delivered.',
        })}
      />,
    );
    const result = screen.getByRole('article', { name: 'Tool result lookup_order' });
    expect(result).toHaveTextContent('RESULT');
    expect(result.querySelector('[data-json]')).toHaveTextContent('"status": "delivered"');
    expect(within(result).getByRole('button', { name: 'Show the fields' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
