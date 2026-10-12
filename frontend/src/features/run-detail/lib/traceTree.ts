/**
 * Span tree for the trace drawer (trace_viewer.js buildTree / _collapseNoise /
 * _dedupeGlobalLlmSpans / buildRetriedTree / detectRetries / computeBounds /
 * extractMessages). Pure: works on plain span objects and returns new nodes.
 */
import type { Span, TraceAttempt, TracePayload, TraceSummary } from '../types';

export type SpanKind =
  'LLM' | 'TOOL' | 'AGENT' | 'CHAIN' | 'EVALUATOR' | 'RETRIEVER' | 'EMBED' | 'GUARDRAIL' | 'DEFAULT';
const KNOWN_KINDS: SpanKind[] = [
  'LLM',
  'TOOL',
  'AGENT',
  'CHAIN',
  'EVALUATOR',
  'RETRIEVER',
  'EMBED',
  'GUARDRAIL',
];

export interface SpanNode extends Span {
  _i: number;
  _children: SpanNode[];
  _depth: number;
  _orphan: boolean;
  _attemptNumber?: number;
  _groupParent?: SpanNode | null;
  _retry?: number;
  _try?: number;
  _failed?: boolean;
}

export interface SpanTree {
  roots: SpanNode[];
  byId: Map<string, SpanNode>;
  nodes: SpanNode[];
}

export interface TraceBounds {
  start: number | null;
  end: number | null;
  total: number;
}

export interface CombinedTree extends SpanTree {
  bounds: TraceBounds;
  summary: { span_count: number; duration_ms: number | null; error_count: number };
  attemptCount: number;
  failedCount: number;
}

export function attrs(span: Span): Record<string, unknown> {
  return span.attributes && typeof span.attributes === 'object' ? span.attributes : {};
}

export function spanKind(span: Span): SpanKind {
  const a = attrs(span);
  const raw =
    a['openinference.span.kind'] ?? a['ai.openinference.span.kind'] ?? a['span.kind'] ?? span.kind ?? '';
  const k = String(raw)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if ((KNOWN_KINDS as string[]).includes(k)) return k as SpanKind;
  if (k === 'EMBEDDING') return 'EMBED';
  if (k === 'RETRIEVE') return 'RETRIEVER';
  return 'DEFAULT';
}

export function spanModel(span: Span): string {
  const a = attrs(span);
  let m = String(a['llm.model_name'] ?? a['gen_ai.request.model'] ?? a['gen_ai.response.model'] ?? '');
  if (m.includes('/')) m = m.split('/').pop() ?? m;
  return m;
}

export function spanTokens(span: Span): number | null {
  const a = attrs(span);
  return Number(a['llm.token_count.total'] ?? a['gen_ai.usage.total_tokens'] ?? 0) || null;
}

export function spanCost(span: Span): number | null {
  return Number(attrs(span)['llm.cost.total'] ?? 0) || null;
}

export type StatusClass = 'error' | 'ok' | 'unset';
export function statusClass(status: unknown): StatusClass {
  const u = String(status ?? '').toUpperCase();
  return u === 'ERROR' ? 'error' : u === 'OK' ? 'ok' : 'unset';
}

export function spanHasException(node: Span): boolean {
  return (Array.isArray(node.events) ? node.events : []).some((ev) => ev?.name === 'exception');
}

export function extractReasoning(span: Span): string | null {
  const a = attrs(span);
  for (let i = 0; i < 5; i++) {
    const r = a[`gen_ai.completion.${i}.reasoning`];
    if (r) return String(r);
  }
  try {
    const ov = a['output.value'];
    if (typeof ov === 'string') {
      const parsed = JSON.parse(ov) as { choices?: Array<{ message?: { reasoning?: unknown } }> };
      for (const c of parsed?.choices ?? []) {
        const r = c?.message?.reasoning;
        if (r) return String(r);
      }
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export function spanReasoningTokens(span: Span): number {
  const a = attrs(span);
  const direct =
    a['llm.token_count.completion_details.reasoning'] ??
    a['gen_ai.usage.completion_tokens_details.reasoning_tokens'] ??
    a['gen_ai.usage.output_tokens_details.reasoning'] ??
    a['gen_ai.usage.reasoning_tokens'];
  const parsedDirect = Number(direct ?? 0);
  if (Number.isFinite(parsedDirect) && parsedDirect > 0) return parsedDirect;
  try {
    const parsed = JSON.parse(String(a['output.value'] ?? '')) as {
      usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } };
    };
    const tokens = Number(parsed?.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
    return Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  } catch {
    return 0;
  }
}

export function spanHasReasoning(span: Span): boolean {
  return !!(extractReasoning(span) || spanReasoningTokens(span) > 0);
}

export interface ChatMessage {
  role: string;
  content: string;
  toolCalls: Array<{ name: string; arguments: string; id: string }>;
  toolCallId?: string;
  reasoning?: string;
}

export function extractMessages(
  a: Record<string, unknown>,
  prefix: 'llm.input_messages' | 'llm.output_messages',
): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < 50; i++) {
    const role = a[`${prefix}.${i}.message.role`];
    if (role == null) break;
    let content = String(a[`${prefix}.${i}.message.content`] ?? '');
    if (!content) {
      const parts: string[] = [];
      for (let j = 0; j < 20; j++) {
        const base = `${prefix}.${i}.message.contents.${j}.message_content`;
        const type = a[`${base}.type`];
        if (type == null) break;
        if (String(type) === 'text') {
          const text = a[`${base}.text`];
          if (text) parts.push(String(text));
        }
      }
      if (parts.length) content = parts.join('\n\n');
    }
    const toolCalls: ChatMessage['toolCalls'] = [];
    for (let j = 0; j < 20; j++) {
      const name = a[`${prefix}.${i}.message.tool_calls.${j}.tool_call.function.name`];
      if (name == null) break;
      toolCalls.push({
        name: String(name),
        arguments: String(a[`${prefix}.${i}.message.tool_calls.${j}.tool_call.function.arguments`] ?? ''),
        id: String(a[`${prefix}.${i}.message.tool_calls.${j}.tool_call.id`] ?? ''),
      });
    }
    const toolCallId = a[`${prefix}.${i}.message.tool_call_id`];
    msgs.push({
      role: String(role),
      content,
      toolCalls,
      toolCallId: toolCallId == null ? undefined : String(toolCallId),
      reasoning: String(a[`${prefix}.${i}.message.reasoning`] ?? '') || undefined,
    });
  }
  return msgs;
}

export interface SpanScore {
  name: string;
  value: unknown;
  label: string;
  explanation: string;
}

export function extractScores(span: Span): SpanScore[] {
  return (Array.isArray(span.events) ? span.events : [])
    .filter((ev) => typeof ev?.name === 'string' && ev.name.startsWith('score.'))
    .map((ev) => {
      const a = ev.attributes ?? {};
      return {
        name: String(a['score.name'] ?? ev.name!.replace('score.', '')),
        value: a['score.value'],
        label: String(a['score.label'] ?? ''),
        explanation: String(a['score.explanation'] ?? ''),
      };
    });
}

/* ── noise collapse ── */

const NOISE_NAMES = new Set([
  'should_continue',
  'route',
  'router',
  'RunnableSequence',
  'call_model',
  'ChannelWrite',
  'ChannelRead',
  'Prompt',
  'RunnableParallel',
  'RunnableLambda',
  '__start__',
  '__end__',
]);
const KEEP_KINDS = new Set<SpanKind>([
  'LLM',
  'TOOL',
  'AGENT',
  'EMBED',
  'RETRIEVER',
  'EVALUATOR',
  'GUARDRAIL',
]);

function isNoiseSpan(node: SpanNode): boolean {
  if (KEEP_KINDS.has(spanKind(node))) return false;
  return NOISE_NAMES.has((node.name ?? '').trim());
}

function isPassThrough(node: SpanNode): boolean {
  if (node._children.length !== 1) return false;
  if (KEEP_KINDS.has(spanKind(node))) return false;
  const a = attrs(node);
  if (a['input.value'] || a['output.value']) return false;
  if (a['llm.model_name'] || a['gen_ai.request.model']) return false;
  return true;
}

export function spanStart(node: Span): number | null {
  return node.start_time_ns == null ? null : Number(node.start_time_ns);
}
export function spanEnd(node: Span): number | null {
  if (node.end_time_ns != null) return Number(node.end_time_ns);
  return spanStart(node);
}

function overlapRatio(a: Span, b: Span): number {
  const as = spanStart(a);
  const ae = spanEnd(a);
  const bs = spanStart(b);
  const be = spanEnd(b);
  if (as == null || ae == null || bs == null || be == null) return 0;
  const overlap = Math.max(0, Math.min(ae, be) - Math.max(as, bs));
  const base = Math.max(1, Math.min(ae - as, be - bs));
  return overlap / base;
}

function messageSig(
  a: Record<string, unknown>,
  prefix: 'llm.input_messages' | 'llm.output_messages',
): string {
  const msgs = extractMessages(a, prefix);
  if (!msgs.length) return '';
  return msgs
    .map((m) => `${m.role.toLowerCase()}:${m.content}`)
    .join('|')
    .slice(0, 4000);
}

function llmSignature(node: Span): string {
  const a = attrs(node);
  const model = spanModel(node);
  const input = String(a['input.value'] ?? messageSig(a, 'llm.input_messages') ?? '').slice(0, 4000);
  const output = String(a['output.value'] ?? messageSig(a, 'llm.output_messages') ?? '').slice(0, 4000);
  return `${model}::${input}::${output}`;
}

function spanRichness(node: Span): number {
  const a = attrs(node);
  let score = 0;
  if (a['input.value']) score += 2;
  if (a['output.value']) score += 2;
  if (messageSig(a, 'llm.input_messages')) score += 3;
  if (messageSig(a, 'llm.output_messages')) score += 3;
  if (spanModel(node)) score += 1;
  if (spanHasReasoning(node)) score += 6;
  if (spanReasoningTokens(node) > 0) score += 2;
  score += Math.min(2, (Number(node.duration_ms) || 0) / 1000);
  return score;
}

const PROVIDER_LLM_NAME_RE = /^(ChatCompletion|Completion|Responses?|response)$/i;

function llmKeepPriority(node: Span): number {
  let score = spanRichness(node);
  if (PROVIDER_LLM_NAME_RE.test(String(node.name ?? ''))) score -= 4;
  if (spanHasReasoning(node)) score += 8;
  return score;
}

function subtreeHasError(node: SpanNode | null | undefined): boolean {
  if (!node) return false;
  if (statusClass(node.status) === 'error') return true;
  return node._children.some(subtreeHasError);
}

export function llmLooksDuplicate(a: SpanNode, b: SpanNode): boolean {
  if (spanKind(a) !== 'LLM' || spanKind(b) !== 'LLM') return false;
  if (subtreeHasError(a) || subtreeHasError(b)) return false;
  const am = spanModel(a);
  const bm = spanModel(b);
  if (!am || !bm || am !== bm) return false;
  if (overlapRatio(a, b) < 0.9) return false;
  const ad = Math.max(1, Number(a.duration_ms) || 0);
  const bd = Math.max(1, Number(b.duration_ms) || 0);
  if (Math.min(ad, bd) / Math.max(ad, bd) < 0.85) return false;
  const at = spanTokens(a);
  const bt = spanTokens(b);
  if (at != null && bt != null && Math.abs(at - bt) > Math.max(2, Math.round(Math.max(at, bt) * 0.02)))
    return false;
  const as = llmSignature(a);
  const bs = llmSignature(b);
  if (as && bs && as === bs) return true;
  const aProv = PROVIDER_LLM_NAME_RE.test(String(a.name ?? ''));
  const bProv = PROVIDER_LLM_NAME_RE.test(String(b.name ?? ''));
  return aProv !== bProv;
}

function pruneNodes(list: SpanNode[], toRemove: Set<SpanNode>): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const node = list[i]!;
    pruneNodes(node._children, toRemove);
    if (toRemove.has(node)) list.splice(i, 1);
  }
}

function dedupeGlobalLlmSpans(tree: SpanTree): void {
  // Duplicates must overlap in time by >= 90%, so sorting by start lets the inner loop stop at the first span
  // that begins after `a` ends (spans without times can never match). Keeps big traces from going quadratic.
  const llms = tree.nodes
    .filter((n) => spanKind(n) === 'LLM' && spanStart(n) != null)
    .sort((x, y) => spanStart(x)! - spanStart(y)! || x._i - y._i);
  if (llms.length < 2) return;
  const toRemove = new Set<SpanNode>();
  for (let i = 0; i < llms.length; i++) {
    const a = llms[i]!;
    if (toRemove.has(a)) continue;
    const aEnd = spanEnd(a)!;
    for (let j = i + 1; j < llms.length; j++) {
      const b = llms[j]!;
      if (spanStart(b)! >= aEnd) break;
      if (toRemove.has(b) || !llmLooksDuplicate(a, b)) continue;
      const keep = llmKeepPriority(a) >= llmKeepPriority(b) ? a : b;
      toRemove.add(keep === a ? b : a);
    }
  }
  if (toRemove.size) pruneNodes(tree.roots, toRemove);
}

function dedupeSiblingSpans(list: SpanNode[]): void {
  if (list.length < 2) return;
  const toRemove = new Set<SpanNode>();
  for (const node of list) {
    if (String(attrs(node)['db.system'] ?? '').toLowerCase() !== 'chroma') continue;
    if (subtreeHasError(node)) continue;
    const hasRetriever = list.some(
      (o) => o !== node && spanKind(o) === 'RETRIEVER' && !subtreeHasError(o) && overlapRatio(node, o) > 0.5,
    );
    if (hasRetriever) toRemove.add(node);
  }
  const groups = new Map<string, SpanNode[]>();
  for (const node of list) {
    if (spanKind(node) !== 'LLM' || subtreeHasError(node)) continue;
    const sig = llmSignature(node);
    if (!sig || sig === '::') continue;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(node);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const overlapping = group.filter((a) => group.some((b) => a !== b && overlapRatio(a, b) > 0.85));
    if (overlapping.length < 2) continue;
    let keep = overlapping[0]!;
    for (const node of overlapping.slice(1)) if (spanRichness(node) > spanRichness(keep)) keep = node;
    for (const node of overlapping) if (node !== keep) toRemove.add(node);
  }
  if (!toRemove.size) return;
  for (let i = list.length - 1; i >= 0; i--) if (toRemove.has(list[i]!)) list.splice(i, 1);
}

function collapseNoise(list: SpanNode[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const node = list[i]!;
    collapseNoise(node._children);
    if (subtreeHasError(node)) continue;
    if (isNoiseSpan(node) && node._children.length === 0) {
      list.splice(i, 1);
      continue;
    }
    if (isPassThrough(node)) {
      const child = node._children[0]!;
      child.parent_span_id = node.parent_span_id;
      list.splice(i, 1, child);
      continue;
    }
    if (isNoiseSpan(node)) {
      for (const child of node._children) child.parent_span_id = node.parent_span_id;
      list.splice(i, 1, ...node._children);
    }
  }
  dedupeSiblingSpans(list);
}

function setDepths(list: SpanNode[], depth: number): void {
  list.forEach((n) => {
    n._depth = depth;
    setDepths(n._children, depth + 1);
  });
}

export function buildTree(spans: Span[] | null | undefined): SpanTree {
  const byId = new Map<string, SpanNode>();
  const nodes: SpanNode[] = (spans ?? []).map((sp, i) => {
    const n: SpanNode = { ...sp, _i: i, _children: [], _depth: 0, _orphan: false };
    byId.set(n.span_id, n);
    return n;
  });
  const roots: SpanNode[] = [];
  nodes.forEach((n) => {
    const p = n.parent_span_id;
    if (p && byId.has(p)) byId.get(p)!._children.push(n);
    else {
      n._orphan = !!p;
      roots.push(n);
    }
  });
  const sortFn = (a: SpanNode, b: SpanNode) => {
    const as = a.start_time_ns == null ? Infinity : Number(a.start_time_ns);
    const bs = b.start_time_ns == null ? Infinity : Number(b.start_time_ns);
    return as !== bs ? as - bs : a._i - b._i;
  };
  const sortChildren = (n: SpanNode) => {
    n._children.sort(sortFn);
    n._children.forEach(sortChildren);
  };
  roots.sort(sortFn);
  roots.forEach(sortChildren);
  collapseNoise(roots);
  const tree: SpanTree = { roots, byId, nodes };
  dedupeGlobalLlmSpans(tree);
  setDepths(roots, 0);
  return tree;
}

/** Visible nodes after collapse (those reachable from the roots), in tree order. */
export function flattenTree(roots: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = [];
  const walk = (n: SpanNode) => {
    out.push(n);
    n._children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

export function computeBounds(
  summary: TraceSummary | null | undefined,
  spans: Span[] | null | undefined,
): TraceBounds {
  const s = summary?.started_at_ns;
  const e = summary?.ended_at_ns;
  if (s != null && e != null) return { start: s, end: e, total: Math.max(e - s, 1) };
  const ss = (spans ?? []).map((x) => x.start_time_ns).filter((x): x is number => x != null);
  const es = (spans ?? []).map((x) => x.end_time_ns).filter((x): x is number => x != null);
  if (!ss.length || !es.length) return { start: null, end: null, total: 1 };
  const start = Math.min(...ss);
  const end = Math.max(...es);
  return { start, end, total: Math.max(end - start, 1) };
}

/* ── retries ── */

export function attemptFailed(attempt: Pick<TraceAttempt, 'status'> | null | undefined): boolean {
  return ['failed', 'error', 'timeout'].includes(String(attempt?.status ?? '').toLowerCase());
}

/** The span a failed try died on: the deepest span that raised, else the deepest ERROR span. */
export function failingSpan(tree: SpanTree): SpanNode | null {
  const reachable = flattenTree(tree.roots);
  const errored = reachable.filter((n) => statusClass(n.status) === 'error');
  const raised = errored.filter(spanHasException);
  return (raised.length ? raised : errored).reduce<SpanNode | null>(
    (best, n) => (!best || n._depth > best._depth ? n : best),
    null,
  );
}

function ancestorNames(tree: SpanTree, node: SpanNode): string[] {
  const names: string[] = [];
  let cur = node.parent_span_id ? tree.byId.get(node.parent_span_id) : undefined;
  while (cur) {
    names.unshift(cur.name ?? '');
    cur = cur.parent_span_id ? tree.byId.get(cur.parent_span_id) : undefined;
  }
  return names;
}

export interface BuiltAttempt extends TraceAttempt {
  attempt_number: number;
  tree: SpanTree;
}

/** One tree for a retried item: the final try with each failed try's failing span inserted. */
export function buildRetriedTree(attempts: BuiltAttempt[]): CombinedTree {
  const finalAttempt = attempts.find((a) => a.is_last_attempt) ?? attempts[attempts.length - 1]!;
  const base = finalAttempt.tree;
  const nodes = [...base.nodes];
  base.nodes.forEach((n) => {
    n._attemptNumber = finalAttempt.attempt_number;
  });
  attempts
    .filter((a) => a !== finalAttempt)
    .forEach((attempt) => {
      const failed = failingSpan(attempt.tree);
      if (!failed) return;
      let parent: SpanNode | null = null;
      if (failed.parent_span_id && attempt.tree.byId.has(failed.parent_span_id)) {
        parent = base.roots[0] ?? null;
        for (const name of ancestorNames(attempt.tree, failed).slice(1)) {
          const next = parent?._children.find((c) => c.name === name);
          if (!next) break;
          parent = next;
        }
      }
      const siblings = parent ? parent._children : base.roots;
      const at = siblings.findIndex(
        (c) => c.name === failed.name && c._attemptNumber === finalAttempt.attempt_number,
      );
      siblings.splice(at < 0 ? siblings.length : at, 0, failed);
      failed._groupParent = parent;
      const collect = (n: SpanNode) => {
        n._attemptNumber = attempt.attempt_number;
        nodes.push(n);
        n._children.forEach(collect);
      };
      collect(failed);
    });
  setDepths(base.roots, 0);
  const byId = new Map(nodes.map((n) => [n.span_id, n]));
  const starts = nodes.map(spanStart).filter((v): v is number => v != null);
  const ends = nodes.map(spanEnd).filter((v): v is number => v != null);
  const start = starts.length ? Math.min(...starts) : null;
  const end = ends.length ? Math.max(...ends) : null;
  const failedCount = attempts.filter(attemptFailed).length;
  return {
    roots: base.roots,
    byId,
    nodes,
    bounds:
      start != null && end != null
        ? { start, end, total: Math.max(end - start, 1) }
        : { start: null, end: null, total: 1 },
    summary: {
      span_count: nodes.length,
      duration_ms: start != null && end != null ? (end - start) / 1e6 : null,
      error_count: failedCount,
    },
    attemptCount: attempts.length,
    failedCount,
  };
}

/** Same-name siblings where an earlier one errored: mark `try N` and failed groups. */
export function detectRetries(tree: SpanTree): void {
  tree.nodes.forEach((n) => {
    n._retry = 0;
    n._try = 0;
    n._failed = false;
  });
  const processChildren = (children: SpanNode[]) => {
    const seen = new Map<string, SpanNode[]>();
    children.forEach((c) => {
      const name = c.name ?? '';
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name)!.push(c);
    });
    seen.forEach((group) => {
      if (group.length <= 1) return;
      let retryNum = 0;
      for (const span of group) {
        if (retryNum > 0) span._retry = retryNum;
        if (statusClass(span.status) === 'error') {
          span._failed = true;
          retryNum++;
        }
      }
      if (retryNum > 0) group.forEach((span, index) => (span._try = index + 1));
    });
  };
  processChildren(tree.roots);
  tree.nodes.forEach((n) => n._children.length && processChildren(n._children));
  const propagate = (node: SpanNode) => {
    node._children.forEach((c) => {
      if (node._failed) c._failed = true;
      propagate(c);
    });
  };
  tree.roots.forEach(propagate);
}

export interface NormalizedTrace {
  item: TracePayload['item'];
  attempts: BuiltAttempt[];
  lastAttempt: BuiltAttempt;
  combined: CombinedTree | null;
}

/** normalizeAttempts: every payload becomes a list of attempts with trees; >1 attempts → combined tree. */
export function normalizeTrace(data: TracePayload): NormalizedTrace {
  const raw: TraceAttempt[] =
    Array.isArray(data.attempts) && data.attempts.length
      ? data.attempts
      : [
          {
            attempt_number: 1,
            status: data.item?.trace_id ? 'completed' : 'failed',
            latency_ms: data.item?.latency_ms ?? null,
            trace_id: data.item?.trace_id ?? '',
            trace_url: data.item?.trace_url ?? '',
            error: null,
            is_last_attempt: true,
            summary: data.summary ?? {},
            spans: Array.isArray(data.spans) ? data.spans : [],
          },
        ];
  const attempts: BuiltAttempt[] = raw.map((attempt, idx) => {
    const spans = Array.isArray(attempt.spans) ? attempt.spans : [];
    const tree = buildTree(spans);
    detectRetries(tree);
    return {
      ...attempt,
      attempt_number: Number(attempt.attempt_number || idx + 1),
      summary: attempt.summary ?? {},
      spans,
      tree,
    };
  });
  const lastAttempt = attempts.find((a) => a.is_last_attempt) ?? attempts[attempts.length - 1]!;
  const item = {
    ...data.item,
    retry_count: Number(data.item?.retry_count ?? Math.max(0, attempts.length - 1)),
    trace_id: lastAttempt.trace_id || data.item?.trace_id || '',
    trace_url: lastAttempt.trace_url || data.item?.trace_url || '',
  };
  // buildRetriedTree splices failed spans into the final attempt's tree, so it gets fresh copies:
  // a single-attempt view must keep showing only that attempt.
  const combined =
    attempts.length > 1 ? buildRetriedTree(attempts.map((a) => ({ ...a, tree: buildTree(a.spans) }))) : null;
  if (combined) detectRetries(combined);
  return { item, attempts, lastAttempt, combined };
}

export function aggregateStats(nodes: SpanNode[]): { totalTokens: number; totalCost: number } {
  let totalTokens = 0;
  let totalCost = 0;
  nodes.forEach((n) => {
    if (spanKind(n) === 'LLM') {
      totalTokens += spanTokens(n) ?? 0;
      totalCost += spanCost(n) ?? 0;
    }
  });
  return { totalTokens, totalCost };
}

/** Span ids matching a name search plus every ancestor (so matches stay reachable). */
export function searchVisible(tree: SpanTree, query: string): Set<string> | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const visible = new Set<string>();
  tree.nodes.forEach((n) => {
    if (n.name && n.name.toLowerCase().includes(q)) {
      visible.add(n.span_id);
      let cur = n._groupParent ?? (n.parent_span_id ? tree.byId.get(n.parent_span_id) : undefined);
      while (cur) {
        visible.add(cur.span_id);
        cur = cur._groupParent ?? (cur.parent_span_id ? tree.byId.get(cur.parent_span_id) : undefined);
      }
    }
  });
  return visible;
}

export function formatDuration(ms: unknown): string {
  if (ms == null) return '—';
  const n = Number(ms);
  if (!Number.isFinite(n)) return '—';
  return n >= 1000 ? (n / 1000).toFixed(1) + 's' : Math.round(n) + 'ms';
}

export function formatCost(n: unknown): string | null {
  if (n == null || n === 0) return null;
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  return '$' + (num < 0.01 ? num.toFixed(4) : num.toFixed(3));
}

/** Langfuse trace URL from the run's host/project (brief 04 §3k). */
export function buildLangfuseTraceUrl(
  host: string | null | undefined,
  projectId: string | null | undefined,
  traceId: string | null | undefined,
): string | null {
  if (!host || !projectId || !traceId) return null;
  const base = String(host).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
}
