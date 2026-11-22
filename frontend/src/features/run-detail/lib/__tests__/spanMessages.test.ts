/** Round 3 T2: the tolerant span parser of the trace drawer (spanMessages.ts). */
import { describe, expect, it } from 'vitest';
import type { SpanNode } from '../traceTree';
import {
  callerOf,
  lastConversation,
  messageText,
  parseMessageList,
  spanDocuments,
  spanErrors,
  spanThread,
  spanUsage,
  toolSpanFor,
} from '../spanMessages';

const node = (id: string, attributes: Record<string, unknown>, extra: Partial<SpanNode> = {}): SpanNode =>
  ({
    span_id: id,
    name: id,
    status: 'OK',
    start_time_ns: 0,
    end_time_ns: 1,
    attributes,
    events: [],
    _children: [],
    ...extra,
  }) as unknown as SpanNode;

const llm = (input: unknown, output?: unknown) =>
  node('llm', {
    'openinference.span.kind': 'LLM',
    'input.value': typeof input === 'string' ? input : JSON.stringify(input),
    ...(output === undefined
      ? {}
      : { 'output.value': typeof output === 'string' ? output : JSON.stringify(output) }),
  });

const roles = (msgs: { role: string }[] | undefined) => (msgs ?? []).map((m) => m.role);

describe('spanThread reads every common shape', () => {
  it('OpenAI: messages with tool calls, the tool answers named by their call, the choices as the output', () => {
    const t = spanThread(
      llm(
        {
          messages: [
            { role: 'system', content: 'Be brief.' },
            { role: 'user', content: 'Where is A-1?' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":"A-1"}' } },
              ],
            },
            { role: 'tool', tool_call_id: 'call_1', content: '{"status":"shipped"}' },
          ],
        },
        { choices: [{ message: { role: 'assistant', content: 'It shipped.' } }] },
      ),
    )!;
    expect(roles(t.input)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(t.input[2]!.parts[0]).toEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'lookup',
      args: '{"id":"A-1"}',
    });
    expect(t.input[3]).toMatchObject({ role: 'tool', toolCallId: 'call_1', name: 'lookup' });
    expect(messageText(t.output[0]!)).toBe('It shipped.');
  });

  it('Anthropic: the system prompt, thinking, tool_use, and one tool message per tool_result', () => {
    const t = spanThread(
      llm(
        {
          system: 'Write the note.',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Note for T-1' }] },
            {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'Read it first.' },
                { type: 'tool_use', id: 'toolu_1', name: 'get_ticket', input: { ticket_id: 'T-1' } },
              ],
            },
            {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: 'toolu_1', content: 'open' },
                { type: 'tool_result', tool_use_id: 'toolu_2', content: 'boom', is_error: true },
              ],
            },
          ],
        },
        { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      ),
    )!;
    expect(roles(t.input)).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    expect(t.input[2]!.parts.map((p) => p.type)).toEqual(['thinking', 'tool_call']);
    expect(t.input[3]).toMatchObject({ toolCallId: 'toolu_1', name: 'get_ticket' });
    expect(t.input[4]).toMatchObject({ toolCallId: 'toolu_2', isError: true });
    expect(messageText(t.output[0]!)).toBe('Done.');
  });

  it('LangChain: serialized messages in a batch, and the generations as the output', () => {
    const lc = (cls: string, content: string) => ({
      lc: 1,
      type: 'constructor',
      id: ['langchain', 'schema', 'messages', cls],
      kwargs: { content },
    });
    const t = spanThread(
      llm(
        { messages: [[lc('SystemMessage', 'Classify.'), lc('HumanMessage', 'Do you ship?')]] },
        { generations: [[{ text: 'shipping', message: lc('AIMessage', 'shipping') }]] },
      ),
    )!;
    expect(roles(t.input)).toEqual(['system', 'user']);
    expect(roles(t.output)).toEqual(['assistant']);
    expect(messageText(t.output[0]!)).toBe('shipping');
  });

  it('OpenInference flattened attributes come first', () => {
    const t = spanThread(
      node('f', {
        'openinference.span.kind': 'LLM',
        'llm.input_messages.0.message.role': 'user',
        'llm.input_messages.0.message.content': 'hi',
        'llm.output_messages.0.message.role': 'assistant',
        'llm.output_messages.0.message.tool_calls.0.tool_call.id': 'c1',
        'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'search',
        'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{}',
        'input.value': 'ignored',
      }),
    )!;
    expect(roles(t.input)).toEqual(['user']);
    expect(t.output[0]!.parts[0]).toMatchObject({ type: 'tool_call', id: 'c1', name: 'search' });
  });

  it('a plain string is a message on an LLM span, and nothing on another step', () => {
    const t = spanThread(llm('hello', 'hi there'))!;
    expect(t.input[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hello' }] });
    expect(t.output[0]).toMatchObject({ role: 'assistant', parts: [{ type: 'text', text: 'hi there' }] });
    expect(
      spanThread(node('chain', { 'openinference.span.kind': 'CHAIN', 'input.value': 'hello' })),
    ).toBeNull();
  });

  it('an unknown shape is no thread, so the drawer shows the value as it is', () => {
    expect(parseMessageList({ payload: { q: 'x' }, frames: [[1, 2]] })).toBeNull();
    expect(parseMessageList([1, 2, 3])).toBeNull();
    expect(
      spanThread(node('odd', { 'openinference.span.kind': 'CHAIN', 'input.value': '{"payload":{"q":"x"}}' })),
    ).toBeNull();
  });

  it('keeps a content block it does not know as a data part (nothing is dropped)', () => {
    const t = spanThread(
      llm({
        messages: [{ role: 'user', content: [{ type: 'image', source: { media_type: 'image/png' } }] }],
      }),
    )!;
    expect(t.input[0]!.parts).toEqual([
      { type: 'data', value: { type: 'image', source: { media_type: 'image/png' } } },
    ]);
  });

  it('never throws, whatever the attributes hold', () => {
    const odd = [null, 42, '{not json', '[]', '{}', '""', [null], { messages: 'x' }, { choices: [null, 3] }];
    for (const v of odd) {
      expect(() =>
        spanThread(node('x', { 'openinference.span.kind': 'LLM', 'input.value': v, 'output.value': v })),
      ).not.toThrow();
      expect(() => parseMessageList(v)).not.toThrow();
    }
    expect(spanThread({ attributes: null } as unknown as SpanNode)).toBeNull();
  });
});

describe('span facts', () => {
  it('reads the usage from the response, else from the attributes', () => {
    expect(
      spanUsage(
        llm({ messages: [] }, { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }),
      ),
    ).toMatchObject({ input: 10, output: 2, total: 12 });
    expect(
      spanUsage(
        node('a', {
          'llm.token_count.prompt': 5,
          'llm.token_count.completion': 1,
          'llm.token_count.total': 6,
        }),
      ),
    ).toMatchObject({ input: 5, output: 1, total: 6 });
  });

  it('reads retriever documents from the attributes and from a list in the output', () => {
    const flat = spanDocuments(
      node('r', {
        'retrieval.documents.0.document.content': 'Returns in 60 days.',
        'retrieval.documents.0.document.score': 0.9,
        'retrieval.documents.0.document.metadata': '{"title":"Policy 4.1"}',
      }),
    );
    expect(flat).toEqual([
      {
        content: 'Returns in 60 days.',
        score: 0.9,
        title: 'Policy 4.1',
        id: undefined,
        meta: { title: 'Policy 4.1' },
      },
    ]);
    const listed = spanDocuments(
      node('r', {
        'output.value': JSON.stringify({ documents: [{ page_content: 'A', metadata: { source: 'a.md' } }] }),
      }),
    );
    expect(listed[0]).toMatchObject({ content: 'A', title: 'a.md' });
    expect(spanDocuments(node('r', { 'output.value': '[1, 2]' }))).toEqual([]);
  });

  it('finds the error of a step: its own exception, else a failing child, else a plain notice', () => {
    const exc = {
      name: 'exception',
      attributes: { 'exception.type': 'Timeout', 'exception.message': 'slow' },
    };
    expect(
      spanErrors(node('e', {}, { status: 'ERROR', events: [exc] } as Partial<SpanNode>))[0],
    ).toMatchObject({
      type: 'Timeout',
      message: 'slow',
    });
    const child = node('child', {}, { status: 'ERROR', events: [exc] } as Partial<SpanNode>);
    const parent = node('parent', {}, { status: 'ERROR', _children: [child] } as Partial<SpanNode>);
    expect(spanErrors(parent)[0]!.from).toBe(child);
    expect(spanErrors(node('bare', {}, { status: 'ERROR' }))[0]!.message).toMatch(/recorded no message/);
    expect(spanErrors(node('ok', {}))).toEqual([]);
  });
});

describe('tool calls and their spans', () => {
  const tool = (id: string, attrs: Record<string, unknown>, start: number) =>
    node(
      id,
      { 'openinference.span.kind': 'TOOL', ...attrs },
      { start_time_ns: start, name: String(attrs['tool.name']) },
    );
  const caller = node(
    'model',
    {
      'openinference.span.kind': 'LLM',
      'llm.output_messages.0.message.role': 'assistant',
      'llm.output_messages.0.message.tool_calls.0.tool_call.id': 'call_9',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'run_sql',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{"q":"select 1"}',
    },
    { start_time_ns: 1 },
  );
  const byId = tool('t1', { 'tool.name': 'run_sql', 'tool_call.id': 'call_9' }, 5);
  const byArgs = tool('t2', { 'tool.name': 'lookup', 'input.value': '{"id": "A-1"}' }, 6);
  const other = tool('t3', { 'tool.name': 'lookup', 'input.value': '{"id": "B-2"}' }, 7);
  const nodes = [caller, byId, byArgs, other];

  it('links a call to its span by the call id, else by the name and the arguments', () => {
    expect(toolSpanFor({ id: 'call_9', name: 'run_sql' }, nodes)).toBe(byId);
    expect(toolSpanFor({ name: 'lookup', args: '{"id":"A-1"}' }, nodes)).toBe(byArgs);
    expect(toolSpanFor({ name: 'lookup', args: '{"id":"B-2"}' }, nodes)).toBe(other);
    expect(toolSpanFor({ name: 'missing' }, nodes)).toBeNull();
  });

  it('links a tool span back to the model call that asked for it', () => {
    expect(callerOf(byId, nodes)).toBe(caller);
    expect(callerOf(byArgs, nodes)).toBeNull();
  });

  it('an agent shows the conversation of its last model call', () => {
    const first = node('m1', { 'openinference.span.kind': 'LLM', 'input.value': 'one' }, { end_time_ns: 2 });
    const last = node('m2', { 'openinference.span.kind': 'LLM', 'input.value': 'two' }, { end_time_ns: 9 });
    const agent = node('agent', { 'openinference.span.kind': 'AGENT' }, { _children: [first, byId, last] });
    expect(lastConversation(agent)).toBe(last);
    expect(lastConversation(node('lonely', {}))).toBeNull();
  });
});
