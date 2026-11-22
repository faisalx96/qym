/**
 * What the trace drawer reads out of a span to show it as the pre-React viewer did (trace_viewer.js
 * decorateMessages / extractLlmMessagesFromSpan / extractRetrieverDocs / extractErrorInfoDeep / inferToolCallId):
 * one chat thread (OpenAI, Anthropic, LangChain, Gemini and OpenInference shapes), the usage and model facts of an
 * LLM call, the documents of a retriever, the error of a step, and the links between a tool call and its tool span.
 *
 * Pure and tolerant: any input gives an answer or null, never an exception. A part of a message the parser does not
 * know is kept as a `data` part (shown as a structured value), so nothing is dropped.
 */
import type { Span } from '../types';
import { attrs, extractMessages, spanKind, type SpanNode } from './traceTree';

/* ── the thread ── */

export type ThreadPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name?: string; content: unknown; isError?: boolean }
  | { type: 'data'; value: unknown };

export type ThreadRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ThreadMessage {
  /** system, user, assistant or tool; another role is kept as written. */
  role: ThreadRole | string;
  /** The name on the message (a tool message: the tool). */
  name?: string;
  /** A tool message: the id of the call it answers. */
  toolCallId?: string;
  /** A tool message: the tool said it failed. */
  isError?: boolean;
  parts: ThreadPart[];
}

export interface SpanThread {
  input: ThreadMessage[];
  output: ThreadMessage[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A JSON text gives its value; anything else is itself. */
export function parseJsonish(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t || !'[{'.includes(t[0]!)) return v;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return v;
  }
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

const ROLE_ALIASES: Record<string, ThreadRole> = {
  system: 'system',
  developer: 'system',
  systemmessage: 'system',
  user: 'user',
  human: 'user',
  humanmessage: 'user',
  assistant: 'assistant',
  ai: 'assistant',
  model: 'assistant',
  aimessage: 'assistant',
  aimessagechunk: 'assistant',
  bot: 'assistant',
  tool: 'tool',
  function: 'tool',
  toolmessage: 'tool',
  functionmessage: 'tool',
  ipython: 'tool',
};

export function normRole(raw: unknown): string {
  const r = String(raw ?? '').trim();
  return ROLE_ALIASES[r.toLowerCase().replace(/[^a-z]/g, '')] ?? (r || 'unknown');
}

const ERROR_TEXT = /^\s*(error|exception|traceback)\b/i;

/** The parts of a message's content: a string, a list of content blocks, or one block. */
export function parseContent(content: unknown): ThreadPart[] {
  if (content == null || content === '') return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content.flatMap((b) => parseBlock(b));
  return parseBlock(content);
}

function parseBlock(b: unknown): ThreadPart[] {
  if (b == null || b === '') return [];
  if (typeof b === 'string') return [{ type: 'text', text: b }];
  if (!isObj(b)) return [{ type: 'data', value: b }];
  const type = String(b.type ?? '');
  // OpenInference flattened content blocks once unflattened: { message_content: { type, text } }
  if (isObj(b.message_content)) return parseBlock(b.message_content);
  if (
    (type === 'text' || type === 'input_text' || type === 'output_text' || type === '') &&
    typeof b.text === 'string' &&
    Object.keys(b).every((k) => ['type', 'text', 'annotations', 'cache_control', 'citations'].includes(k))
  )
    return b.text ? [{ type: 'text', text: b.text }] : [];
  if (type === 'thinking' && typeof b.thinking === 'string') return [{ type: 'thinking', text: b.thinking }];
  if (type === 'redacted_thinking') return [{ type: 'thinking', text: '(The model hid this reasoning.)' }];
  if (type === 'reasoning') {
    const summary = Array.isArray(b.summary)
      ? b.summary.map((x) => (isObj(x) ? str(x.text) : str(x))).join('\n\n')
      : str(b.text ?? b.summary ?? b.reasoning);
    return summary ? [{ type: 'thinking', text: summary }] : [];
  }
  if (type === 'tool_use' || type === 'function_call' || type === 'tool_call') {
    const fn = isObj(b.function) ? b.function : null;
    return [
      {
        type: 'tool_call',
        id: str(b.id ?? b.call_id),
        name: str(b.name ?? fn?.name),
        args: str(b.input ?? b.arguments ?? b.args ?? fn?.arguments ?? ''),
      },
    ];
  }
  if (type === 'tool_result' || type === 'function_call_output') {
    const inner = b.content ?? b.output;
    const parts = Array.isArray(inner) ? parseContent(inner) : null;
    // a list of text blocks is its text; anything else is kept as given
    const content =
      parts && parts.every((p) => p.type === 'text')
        ? parts.map((p) => (p as { text: string }).text).join('\n\n')
        : inner;
    return [
      {
        type: 'tool_result',
        id: str(b.tool_use_id ?? b.call_id ?? b.id),
        content,
        isError: b.is_error === true || (typeof content === 'string' && ERROR_TEXT.test(content)),
      },
    ];
  }
  // Gemini parts
  if (isObj(b.functionCall)) {
    return [
      {
        type: 'tool_call',
        id: str(b.functionCall.id),
        name: str(b.functionCall.name),
        args: str(b.functionCall.args),
      },
    ];
  }
  if (isObj(b.functionResponse)) {
    return [
      {
        type: 'tool_result',
        id: str(b.functionResponse.id),
        name: str(b.functionResponse.name),
        content: b.functionResponse.response,
      },
    ];
  }
  if (typeof b.text === 'string' && Object.keys(b).length === 1) return [{ type: 'text', text: b.text }];
  // an image, a file, a block of a kind not known here: kept, shown as a value
  return [{ type: 'data', value: b }];
}

function toolCallsOf(list: unknown): ThreadPart[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((tc) => {
    const fn = isObj(tc.function) ? tc.function : null;
    return {
      type: 'tool_call' as const,
      id: str(tc.id ?? tc.call_id),
      name: str(fn?.name ?? tc.name),
      args: str(fn?.arguments ?? tc.args ?? tc.arguments ?? tc.input ?? ''),
    };
  });
}

/** True when a value looks like one chat message (any of the known shapes). */
export function isMessageLike(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.lc === 1 && v.type === 'constructor' && Array.isArray(v.id)) return true;
  if (typeof v.role === 'string')
    return 'content' in v || 'tool_calls' in v || 'parts' in v || 'function_call' in v;
  if (typeof v.type === 'string' && normRole(v.type) !== v.type) return 'content' in v;
  return false;
}

/**
 * One chat message in any known shape. A user message made of tool results (Anthropic) becomes one tool message per
 * result, so each result reads as the answer of its call.
 */
export function parseMessage(m: unknown, fallbackRole = 'user'): ThreadMessage[] {
  if (typeof m === 'string') return m ? [{ role: fallbackRole, parts: [{ type: 'text', text: m }] }] : [];
  if (!isObj(m)) return m == null ? [] : [{ role: fallbackRole, parts: [{ type: 'data', value: m }] }];
  let msg: Obj = m;
  let role: string;
  if (m.lc === 1 && m.type === 'constructor' && Array.isArray(m.id)) {
    // LangChain serialized message: the class name says the role
    const kw = isObj(m.kwargs) ? m.kwargs : {};
    msg = kw;
    const cls = String(m.id[m.id.length - 1] ?? '');
    role =
      cls === 'ChatMessage' && typeof kw.role === 'string' ? normRole(kw.role) : normRole(cls || kw.type);
  } else {
    role = normRole(m.role ?? m.type ?? fallbackRole);
  }
  const extra = isObj(msg.additional_kwargs) ? msg.additional_kwargs : {};
  const parts: ThreadPart[] = [];
  const reasoning = msg.reasoning ?? msg.reasoning_content ?? extra.reasoning_content;
  if (typeof reasoning === 'string' && reasoning) parts.push({ type: 'thinking', text: reasoning });
  parts.push(...parseContent(msg.content ?? msg.parts ?? msg.text));
  const calls = toolCallsOf(msg.tool_calls);
  parts.push(...(calls.length ? calls : toolCallsOf(extra.tool_calls)));
  if (isObj(msg.function_call)) {
    parts.push({
      type: 'tool_call',
      id: '',
      name: str(msg.function_call.name),
      args: str(msg.function_call.arguments),
    });
  }
  const name = typeof msg.name === 'string' && msg.name ? msg.name : undefined;
  const toolCallId = typeof msg.tool_call_id === 'string' && msg.tool_call_id ? msg.tool_call_id : undefined;
  // Anthropic: the results of the tool calls come back in a user message
  const results = parts.filter((p) => p.type === 'tool_result');
  if (results.length) {
    const rest = parts.filter((p) => p.type !== 'tool_result');
    const out: ThreadMessage[] = results.map((r) => ({
      role: 'tool',
      name: r.name || undefined,
      toolCallId: r.id || undefined,
      isError: r.isError || undefined,
      parts: [r],
    }));
    if (rest.length) out.push({ role, name, parts: rest });
    return out;
  }
  const isError =
    role === 'tool' &&
    (msg.status === 'error' || parts.some((p) => p.type === 'text' && ERROR_TEXT.test(p.text)));
  return [{ role, name, toolCallId, isError: isError || undefined, parts }];
}

function messagesFrom(list: unknown[], fallbackRole: string): ThreadMessage[] | null {
  // LangChain batches: a list of lists of messages (the first prompt of the batch is the call's own)
  const flat = list.length && list.every(Array.isArray) ? (list as unknown[][]).flat() : list;
  if (!flat.length) return null;
  if (!flat.every((m) => typeof m === 'string' || isMessageLike(m))) return null;
  return flat.flatMap((m) => parseMessage(m, fallbackRole));
}

/**
 * The chat messages in a request or a response, in any known shape; null when the value is not a conversation (the
 * caller then shows it as a value). A plain string is a conversation only when `plain` says so (an LLM span's text).
 */
export function parseMessageList(
  value: unknown,
  fallbackRole = 'user',
  plain = false,
): ThreadMessage[] | null {
  const v = parseJsonish(value);
  if (typeof v === 'string')
    return plain && v ? [{ role: fallbackRole, parts: [{ type: 'text', text: v }] }] : null;
  if (Array.isArray(v)) return messagesFrom(v, fallbackRole);
  if (!isObj(v)) return null;
  // a request: messages / input (OpenAI Responses) / contents (Gemini), with a system prompt beside them (Anthropic)
  const list = Array.isArray(v.messages) ? v.messages : Array.isArray(v.contents) ? v.contents : null;
  if (list) {
    const msgs = messagesFrom(list, fallbackRole) ?? [];
    const sys = v.system ?? (isObj(v.systemInstruction) ? v.systemInstruction.parts : v.systemInstruction);
    const sysParts = parseContent(sys);
    if (sysParts.length) msgs.unshift({ role: 'system', parts: sysParts });
    return msgs.length ? msgs : null;
  }
  if (Array.isArray(v.input)) {
    const msgs = responsesItems(v.input, fallbackRole);
    if (msgs) {
      if (typeof v.instructions === 'string' && v.instructions)
        msgs.unshift({ role: 'system', parts: [{ type: 'text', text: v.instructions }] });
      return msgs;
    }
  }
  if (Array.isArray(v.prompts) && v.prompts.every((p) => typeof p === 'string'))
    return (v.prompts as string[]).map((p) => ({ role: 'user', parts: [{ type: 'text', text: p }] }));
  // a response: OpenAI choices, Anthropic message, LangChain generations, OpenAI Responses output, Gemini candidates
  if (Array.isArray(v.choices)) {
    const msgs = v.choices
      .filter(isObj)
      .flatMap((c) =>
        isObj(c.message)
          ? parseMessage(c.message, 'assistant')
          : isObj(c.delta)
            ? parseMessage(c.delta, 'assistant')
            : typeof c.text === 'string'
              ? parseMessage(c.text, 'assistant')
              : [],
      );
    return msgs.length ? msgs : null;
  }
  if (Array.isArray(v.generations)) {
    const gens = (v.generations as unknown[]).flat().filter(isObj);
    const msgs = gens.flatMap((g) =>
      isObj(g.message)
        ? parseMessage(g.message, 'assistant')
        : typeof g.text === 'string'
          ? parseMessage(g.text, 'assistant')
          : [],
    );
    return msgs.length ? msgs : null;
  }
  if (Array.isArray(v.candidates)) {
    const msgs = v.candidates
      .filter(isObj)
      .flatMap((c) => (isObj(c.content) ? parseMessage(c.content, 'assistant') : []));
    return msgs.length ? msgs : null;
  }
  if (Array.isArray(v.output)) return responsesItems(v.output, 'assistant');
  if (v.type === 'message' && 'content' in v) return parseMessage(v, 'assistant');
  if (isMessageLike(v)) return parseMessage(v, fallbackRole);
  if (isObj(v.message) && isMessageLike(v.message)) return parseMessage(v.message, 'assistant');
  return null;
}

/** OpenAI Responses API items: messages, function calls, their outputs, reasoning. */
function responsesItems(items: unknown[], fallbackRole: string): ThreadMessage[] | null {
  const out: ThreadMessage[] = [];
  for (const it of items) {
    if (typeof it === 'string') out.push(...parseMessage(it, fallbackRole));
    else if (isObj(it) && (it.type === 'message' || typeof it.role === 'string'))
      out.push(...parseMessage(it, fallbackRole));
    else if (isObj(it) && (it.type === 'function_call' || it.type === 'reasoning'))
      out.push({ role: 'assistant', parts: parseBlock(it) });
    else if (isObj(it) && it.type === 'function_call_output') {
      const [r] = parseBlock(it);
      out.push({ role: 'tool', toolCallId: str(it.call_id) || undefined, parts: r ? [r] : [] });
    } else return null;
  }
  return out.length ? out : null;
}

function fromFlattened(a: Obj, prefix: 'llm.input_messages' | 'llm.output_messages'): ThreadMessage[] {
  return extractMessages(a, prefix).map((m, i) => {
    const parts: ThreadPart[] = [];
    if (m.reasoning) parts.push({ type: 'thinking', text: m.reasoning });
    if (m.content) parts.push({ type: 'text', text: m.content });
    // content blocks that are not text (an image) are kept as values
    for (let j = 0; j < 20; j++) {
      const base = `${prefix}.${i}.message.contents.${j}.message_content`;
      const type = a[`${base}.type`];
      if (type == null) break;
      if (String(type) !== 'text') {
        const block: Obj = {};
        for (const [k, v] of Object.entries(a))
          if (k.startsWith(`${base}.`)) block[k.slice(base.length + 1)] = v;
        parts.push({ type: 'data', value: block });
      }
    }
    for (const t of m.toolCalls) parts.push({ type: 'tool_call', id: t.id, name: t.name, args: t.arguments });
    const name = a[`${prefix}.${i}.message.name`];
    const role = normRole(m.role);
    return {
      role,
      name: name ? String(name) : undefined,
      toolCallId: m.toolCallId,
      isError: role === 'tool' && ERROR_TEXT.test(m.content) ? true : undefined,
      parts,
    };
  });
}

/** Tool messages take the name of the call they answer; a call's id finds its name anywhere in the thread. */
export function decorateThread(t: SpanThread): SpanThread {
  const names = new Map<string, string>();
  for (const m of [...t.input, ...t.output])
    for (const p of m.parts) if (p.type === 'tool_call' && p.id && p.name) names.set(p.id, p.name);
  const fix = (m: ThreadMessage): ThreadMessage =>
    m.role === 'tool' && !m.name && m.toolCallId && names.has(m.toolCallId)
      ? { ...m, name: names.get(m.toolCallId) }
      : m;
  return { input: t.input.map(fix), output: t.output.map(fix) };
}

/**
 * The conversation of a span: the OpenInference message attributes first, else the messages in `input.value` /
 * `output.value`. Null when the span holds no conversation.
 */
export function spanThread(span: Span): SpanThread | null {
  try {
    const a = attrs(span);
    const llm = spanKind(span) === 'LLM';
    let input = fromFlattened(a, 'llm.input_messages');
    let output = fromFlattened(a, 'llm.output_messages');
    if (!input.length) input = parseMessageList(a['input.value'], 'user', llm) ?? [];
    if (!output.length)
      output = parseMessageList(a['output.value'], 'assistant', llm && input.length > 0) ?? [];
    if (!input.length && !output.length) return null;
    // a non-LLM step is a conversation only when its input is one (a chain that passes messages on)
    if (!llm && !input.length) return null;
    return decorateThread({ input, output });
  } catch {
    return null;
  }
}

/** The plain text of a message, for copy. */
export function messageText(m: ThreadMessage): string {
  return m.parts
    .map((p) =>
      p.type === 'text' || p.type === 'thinking'
        ? p.text
        : p.type === 'tool_call'
          ? `${p.name}(${p.args})`
          : p.type === 'tool_result'
            ? str(p.content)
            : str(p.value),
    )
    .filter(Boolean)
    .join('\n\n');
}

/* ── facts of an LLM call ── */

export interface LlmUsage {
  input?: number;
  output?: number;
  total?: number;
  cached?: number;
  cacheWrite?: number;
  reasoning?: number;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

function outputObj(span: Span): Obj | null {
  const v = parseJsonish(attrs(span)['output.value']);
  return isObj(v) ? v : null;
}

function inputObj(span: Span): Obj | null {
  const v = parseJsonish(attrs(span)['input.value']);
  return isObj(v) ? v : null;
}

/** Token counts: the response's own usage first, else the span attributes. */
export function spanUsage(span: Span): LlmUsage {
  const a = attrs(span);
  const out = outputObj(span);
  const llmOut = isObj(out?.llm_output) ? out.llm_output : null;
  const u = isObj(out?.usage)
    ? out.usage
    : isObj(out?.usageMetadata)
      ? out.usageMetadata
      : isObj(llmOut?.token_usage)
        ? llmOut.token_usage
        : {};
  const pd = isObj(u.prompt_tokens_details)
    ? u.prompt_tokens_details
    : isObj(u.input_tokens_details)
      ? u.input_tokens_details
      : {};
  const cd = isObj(u.completion_tokens_details)
    ? u.completion_tokens_details
    : isObj(u.output_tokens_details)
      ? u.output_tokens_details
      : {};
  const usage: LlmUsage = {
    input:
      num(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount) ??
      num(a['llm.token_count.prompt'] ?? a['gen_ai.usage.input_tokens'] ?? a['gen_ai.usage.prompt_tokens']),
    output:
      num(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount) ??
      num(
        a['llm.token_count.completion'] ??
          a['gen_ai.usage.output_tokens'] ??
          a['gen_ai.usage.completion_tokens'],
      ),
    total:
      num(u.total_tokens ?? u.totalTokenCount) ??
      num(a['llm.token_count.total'] ?? a['gen_ai.usage.total_tokens']),
    cached:
      num(pd.cached_tokens ?? u.cache_read_input_tokens ?? u.cachedContentTokenCount) ??
      num(a['llm.token_count.prompt_details.cache_read']),
    cacheWrite: num(u.cache_creation_input_tokens) ?? num(a['llm.token_count.prompt_details.cache_write']),
    reasoning: num(cd.reasoning_tokens) ?? num(a['llm.token_count.completion_details.reasoning']),
  };
  if (usage.total === undefined && usage.input !== undefined && usage.output !== undefined)
    usage.total = usage.input + usage.output;
  return Object.fromEntries(Object.entries(usage).filter(([, v]) => v !== undefined)) as LlmUsage;
}

/** Who answered and how: provider, model, response id, why it stopped, when, the system fingerprint. */
export function spanResponseMeta(span: Span): Record<string, string> {
  const a = attrs(span);
  const out = outputObj(span);
  const choice = Array.isArray(out?.choices) && isObj(out.choices[0]) ? out.choices[0] : null;
  const gen =
    Array.isArray(out?.generations) && Array.isArray(out.generations[0]) && isObj(out.generations[0][0])
      ? out.generations[0][0]
      : null;
  const genMeta =
    gen && isObj(gen.message) && isObj(gen.message.kwargs) && isObj(gen.message.kwargs.response_metadata)
      ? gen.message.kwargs.response_metadata
      : null;
  const created = num(out?.created);
  const meta: Record<string, unknown> = {
    Provider: a['llm.provider'] ?? a['llm.system'] ?? a['gen_ai.system'],
    Model: out?.model ?? a['llm.model_name'] ?? a['gen_ai.response.model'] ?? genMeta?.model_name,
    'Response id': out?.id ?? a['gen_ai.response.id'],
    'Finish reason':
      choice?.finish_reason ??
      out?.stop_reason ??
      genMeta?.finish_reason ??
      a['gen_ai.response.finish_reasons'],
    Created: created ? new Date(created * 1000).toISOString().replace('.000Z', 'Z') : undefined,
    'System fingerprint': out?.system_fingerprint,
  };
  return Object.fromEntries(
    Object.entries(meta)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => [k, str(v)]),
  );
}

/** The settings of the call: `llm.invocation_parameters`, else the request's own settings. */
export function spanInvocation(span: Span): Obj | null {
  const a = attrs(span);
  const p = parseJsonish(a['llm.invocation_parameters']);
  if (isObj(p) && Object.keys(p).length) return p;
  const req = inputObj(span);
  if (!req || !(Array.isArray(req.messages) || Array.isArray(req.contents) || Array.isArray(req.input)))
    return null;
  const skip = new Set([
    'messages',
    'contents',
    'input',
    'system',
    'instructions',
    'tools',
    'systemInstruction',
  ]);
  const rest = Object.fromEntries(Object.entries(req).filter(([k]) => !skip.has(k)));
  return Object.keys(rest).length ? rest : null;
}

/** The tools the model was offered: name and description. */
export function spanToolsOffered(span: Span): Array<{ name: string; description: string }> {
  const a = attrs(span);
  const req = inputObj(span);
  const list: unknown[] = Array.isArray(req?.tools) ? req.tools : [];
  if (!list.length) {
    for (let i = 0; i < 64; i++) {
      const s = a[`llm.tools.${i}.tool.json_schema`];
      if (s == null) break;
      list.push(parseJsonish(s));
    }
  }
  return list.filter(isObj).map((t) => {
    const fn = isObj(t.function) ? t.function : t;
    return { name: str(fn.name), description: str(fn.description) };
  });
}

/* ── documents of a retriever ── */

export interface RetrievedDoc {
  content: string;
  title?: string;
  id?: string;
  score?: number;
  meta: Obj | null;
}

const DOC_LISTS = [
  'documents',
  'docs',
  'source_documents',
  'matches',
  'results',
  'items',
  'contexts',
  'hits',
  'chunks',
];

function docOf(d: unknown): RetrievedDoc | null {
  if (typeof d === 'string') return d ? { content: d, meta: null } : null;
  if (!isObj(d)) return null;
  const inner = isObj(d.document) ? d.document : d;
  const meta = isObj(inner.metadata) ? inner.metadata : isObj(d.metadata) ? d.metadata : null;
  const content =
    inner.page_content ?? inner.pageContent ?? inner.content ?? inner.text ?? inner.chunk ?? inner.body;
  if (content == null) return null;
  const score = num(d.score ?? d.relevance_score ?? d.similarity ?? inner.score ?? meta?.score);
  const title = meta?.title ?? inner.title ?? d.title ?? meta?.name ?? meta?.source ?? inner.source;
  const id = inner.id ?? d.id ?? meta?.id;
  return {
    content: str(content),
    title: title == null ? undefined : str(title),
    id: id == null ? undefined : str(id),
    score,
    meta,
  };
}

/** The documents a retriever returned: the OpenInference attributes, else its output in any common shape. */
export function spanDocuments(span: Span): RetrievedDoc[] {
  const a = attrs(span);
  const docs: RetrievedDoc[] = [];
  for (let i = 0; i < 200; i++) {
    const content = a[`retrieval.documents.${i}.document.content`];
    if (content == null) break;
    const meta = parseJsonish(a[`retrieval.documents.${i}.document.metadata`]);
    const m = isObj(meta) ? meta : null;
    const id = a[`retrieval.documents.${i}.document.id`] ?? m?.id;
    const title = m?.title ?? m?.name ?? m?.source;
    docs.push({
      content: str(content),
      score: num(a[`retrieval.documents.${i}.document.score`]),
      id: id == null ? undefined : str(id),
      title: title == null ? undefined : str(title),
      meta: m,
    });
  }
  if (docs.length) return docs;
  try {
    const out = parseJsonish(a['output.value']);
    const list = Array.isArray(out)
      ? out
      : isObj(out)
        ? (DOC_LISTS.map((k) => out[k]).find(Array.isArray) as unknown[] | undefined)
        : undefined;
    if (!list) return [];
    const parsed = list.map(docOf);
    // a list that is not documents (one item is not one) is not shown as documents
    return parsed.every(Boolean) ? (parsed as RetrievedDoc[]) : [];
  } catch {
    return [];
  }
}

/* ── the error of a step ── */

export interface SpanError {
  type: string;
  message: string;
  stack?: string;
  /** The error came from this child span (the step itself recorded none). */
  from?: SpanNode;
}

function ownErrors(span: Span): SpanError[] {
  const evs = (Array.isArray(span.events) ? span.events : []).filter((e) => e?.name === 'exception');
  if (evs.length)
    return evs.map((e) => {
      const ea = e.attributes ?? {};
      return {
        type: str(ea['exception.type']) || 'Exception',
        message: str(ea['exception.message']),
        stack: str(ea['exception.stacktrace']) || undefined,
      };
    });
  const a = attrs(span);
  const message =
    a['error.message'] ?? a['exception.message'] ?? a['otel.status_description'] ?? a['status_message'];
  const type = a['error.type'] ?? a['exception.type'];
  if (message != null || type != null)
    return [
      {
        type: str(type) || 'Error',
        message: str(message),
        stack: str(a['exception.stacktrace'] ?? a['error.stack']) || undefined,
      },
    ];
  return [];
}

/** What went wrong in a step: its own exception events or error attributes, else the first failing child's. */
export function spanErrors(span: SpanNode): SpanError[] {
  const own = ownErrors(span);
  if (own.length) return own;
  if (String(span.status ?? '').toUpperCase() !== 'ERROR') return [];
  const stack: SpanNode[] = [...(span._children ?? [])];
  while (stack.length) {
    const c = stack.shift()!;
    const errs = ownErrors(c);
    if (errs.length) return errs.slice(0, 1).map((e) => ({ ...e, from: c }));
    stack.push(...(c._children ?? []));
  }
  return [{ type: 'Error', message: 'This step ended with an error status and recorded no message.' }];
}

/* ── tool calls and their spans ── */

function sameArgs(a: unknown, b: unknown): boolean {
  const x = parseJsonish(a);
  const y = parseJsonish(b);
  if (typeof x === 'string' || typeof y === 'string') return str(x).trim() === str(y).trim();
  return JSON.stringify(x) === JSON.stringify(y);
}

/** The call id a tool span records, if any. */
export function toolCallIdOf(span: Span): string {
  const a = attrs(span);
  return str(a['tool_call.id'] ?? a['tool.call_id'] ?? a['gen_ai.tool.call.id'] ?? a['tool.id'] ?? '');
}

export function toolNameOf(span: Span): string {
  return str(attrs(span)['tool.name'] ?? attrs(span)['gen_ai.tool.name'] ?? span.name);
}

const startOf = (s: Span) => Number(s.start_time_ns ?? 0);

/**
 * The tool span that ran a call: the same call id, else the same tool name and arguments, else the next span of
 * that tool after the LLM call that asked for it.
 */
export function toolSpanFor(
  call: { id?: string; name?: string; args?: string },
  nodes: SpanNode[],
  after?: Span,
): SpanNode | null {
  const tools = nodes.filter((n) => spanKind(n) === 'TOOL' || attrs(n)['tool.name'] != null);
  if (call.id) {
    const byId = tools.find((n) => toolCallIdOf(n) === call.id);
    if (byId) return byId;
  }
  if (!call.name) return null;
  const named = tools.filter((n) => toolNameOf(n) === call.name);
  if (call.args) {
    const byArgs = named.find((n) =>
      sameArgs(attrs(n)['input.value'] ?? attrs(n)['tool.parameters'], call.args),
    );
    if (byArgs) return byArgs;
  }
  const t0 = after ? startOf(after) : 0;
  const later = named.filter((n) => startOf(n) >= t0).sort((x, y) => startOf(x) - startOf(y));
  return later[0] ?? (named.length === 1 ? named[0]! : null);
}

/** The LLM call that asked for a tool span: its call id, else its tool name and arguments, the latest before it. */
export function callerOf(tool: SpanNode, nodes: SpanNode[]): SpanNode | null {
  const id = toolCallIdOf(tool);
  const name = toolNameOf(tool);
  const args = attrs(tool)['input.value'];
  let best: SpanNode | null = null;
  for (const n of nodes) {
    if (n === tool || spanKind(n) !== 'LLM' || startOf(n) > startOf(tool)) continue;
    const t = spanThread(n);
    const calls = (t?.output ?? []).flatMap((m) => m.parts).filter((p) => p.type === 'tool_call');
    const hit = calls.some(
      (c) => (id && c.id === id) || (!id && c.name === name && (args == null || sameArgs(c.args, args))),
    );
    if (hit && (!best || startOf(n) > startOf(best))) best = n;
  }
  return best;
}

/** The last LLM call under a step that holds a conversation: an agent shows it as its own. */
export function lastConversation(span: SpanNode): SpanNode | null {
  let best: SpanNode | null = null;
  const end = (s: Span) => Number(s.end_time_ns ?? s.start_time_ns ?? 0);
  const walk = (n: SpanNode) => {
    for (const c of n._children ?? []) {
      if (spanKind(c) === 'LLM' && spanThread(c) && (!best || end(c) >= end(best))) best = c;
      walk(c);
    }
  };
  walk(span);
  return best;
}
