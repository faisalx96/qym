/**
 * Right pane: the span's identity and facts, its error, then its tabs (Messages, Response, Input / Output, Documents,
 * Scores, Raw). It brings back what the pre-React viewer did well, and its look (round 3 T2, owner: "the old
 * version's style and css looks better"): one quiet line of facts under the name, flat panels, the conversation as one
 * thread (Thread.tsx) with each tool call one click from its span, a tool's input and output as plain JSON
 * (JsonCode.tsx; a query and a table are parsed in the fields view), the usage and model facts of a call, the documents of a retriever first as compact
 * cards, the stack trace of an error.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Dialog,
  Disclosure,
  Eyebrow,
  Icon,
  JsonTree,
  KeyValueGrid,
  Tag,
  TabPanel,
  Tabs,
  TextBlock,
  type KeyValueItem,
  type TabItem,
  StateTag,
} from '@/ui';
import {
  formatDuration,
  formatCost,
  extractReasoning,
  extractScores,
  spanCost,
  spanKind,
  spanModel,
  spanReasoningTokens,
  spanTokens,
  statusClass,
  type SpanNode,
} from '../../lib/traceTree';
import {
  callerOf,
  lastConversation,
  parseJsonish,
  spanDocuments,
  spanErrors,
  spanInvocation,
  spanResponseMeta,
  spanThread,
  spanToolsOffered,
  spanUsage,
  toolCallIdOf,
  toolNameOf,
  type RetrievedDoc,
  type SpanThread,
} from '../../lib/spanMessages';
import { bodyText } from '../../lib/itemText';
import { Act, CopyAct } from '../items/pane/actions';
import type { BlockTone } from '../items/pane/blocks';
import { FieldList, JsonToggle, Value, isStructuredValue } from '../items/pane/values';
import { JsonView } from './JsonCode';
import { KIND_ICON, KIND_LABEL, KIND_TONE } from './spanKinds';
import { OpenSpan, ScrollBody, Thread, TraceLinks } from './Thread';
import styles from './SpanDetail.module.css';

/** Tabs that show what the step did; Scores and Raw describe it. */
const CONTENT_TABS = ['messages', 'response', 'io', 'docs'];
/** The content tab picked last in this page session; never persisted, never a metadata tab. */
let sessionContentTab: string | null = null;

/** The output of a span has the colour of its result, as the Output of an item: green passed, red failed. */
function outputTone(node: SpanNode): BlockTone {
  const cls = statusClass(node.status);
  return cls === 'error' ? 'danger' : cls === 'ok' ? 'success' : 'neutral';
}

/**
 * One titled part of a span, flat as in the pre-React viewer: a faint wash of its tone, a small label in the tone, a
 * short fact after it, the icon actions at the end. A region named by its title.
 */
function Panel({
  title,
  tone = 'neutral',
  after,
  actions,
  children,
}: {
  title: string;
  tone?: BlockTone;
  after?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel} data-tone={tone} aria-label={title}>
      <header className={styles.panelHead}>
        <h4 className={styles.panelTitle}>
          <Eyebrow className={styles.panelLabel}>{title}</Eyebrow>
        </h4>
        {after}
        {actions ? <span className={styles.actions}>{actions}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** A panel with its actions: the panel's own switches, copy, and a full-size dialog. */
function TraceBlock({
  title,
  tone = 'neutral',
  text,
  after,
  switches,
  children,
  expanded,
  expand = true,
}: {
  title: string;
  tone?: BlockTone;
  /** What copy puts on the clipboard. */
  text: string;
  /** Right after the title: a short fact. */
  after?: ReactNode;
  /** Icons before copy (the { } switch of this panel). */
  switches?: ReactNode;
  children: ReactNode;
  /** Content for the full-size dialog (defaults to `children`). */
  expanded?: ReactNode;
  /** A short panel has no full-size dialog. */
  expand?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const name = title.toLowerCase();
  return (
    <>
      <Panel
        title={title}
        tone={tone}
        after={after}
        actions={
          <>
            {switches}
            <CopyAct text={text} label={`Copy ${name}`} />
            {expand ? <Act label={`Expand ${name}`} icon="expand" onPress={() => setOpen(true)} /> : null}
          </>
        }
      >
        {children}
      </Panel>
      {open ? (
        <Dialog open onOpenChange={setOpen} title={title} size="data">
          <div className={styles.expanded}>{expanded ?? children}</div>
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * The input or the output of a span. Text is prose. JSON has a { } switch of its own: a tool span opens on the JSON
 * (plain JSON, the pre-React viewer's default for a tool; the fields view parses SQL and tables), any other span on the fields.
 */
function PayloadBlock({
  title,
  tone,
  value,
  label,
  json = false,
}: {
  title: string;
  tone: BlockTone;
  value: unknown;
  label: string;
  /** Open on the JSON (a tool's arguments and result). */
  json?: boolean;
}) {
  const [raw, setRaw] = useState(json);
  const structured = isStructuredValue(value);
  // a tool's value that is not JSON still goes through the JSON view: a query text there is the formatted query
  const asJson = structured ? raw : json;
  const body = asJson ? <JsonView value={value} label={label} /> : <Value value={value} label={label} />;
  return (
    <TraceBlock
      title={title}
      tone={tone}
      text={bodyText(value)}
      switches={structured ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
      expanded={body}
    >
      {asJson ? <ScrollBody label={label}>{body}</ScrollBody> : body}
    </TraceBlock>
  );
}

/** The span as ingested: the tree builder's own `_` bookkeeping fields are not part of it. */
export function rawSpan(node: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([k]) => !k.startsWith('_')));
}

/** The usage, the model facts, the settings and the tools of an LLM call, then its full response and request. */
function Response({ node }: { node: SpanNode }) {
  const a = node.attributes ?? {};
  const usage = spanUsage(node);
  const meta = spanResponseMeta(node);
  const settings = spanInvocation(node);
  const tools = spanToolsOffered(node);
  const cost = formatCost(spanCost(node));
  const n = (v: number | undefined) => (v === undefined ? null : v.toLocaleString('en-US'));
  const usageItems: KeyValueItem[] = [
    { key: 'in', label: 'Input tokens', value: n(usage.input), mono: true },
    { key: 'out', label: 'Output tokens', value: n(usage.output), mono: true },
    { key: 'total', label: 'Total tokens', value: n(usage.total), mono: true },
    { key: 'cached', label: 'Cached input tokens', value: n(usage.cached), mono: true },
    { key: 'write', label: 'Cache write tokens', value: n(usage.cacheWrite), mono: true },
    { key: 'reasoning', label: 'Reasoning tokens', value: n(usage.reasoning), mono: true },
    { key: 'cost', label: 'Cost', value: cost, mono: true },
    { key: 'duration', label: 'Duration', value: formatDuration(node.duration_ms), mono: true },
  ].filter((i) => i.value != null && i.value !== '' && i.value !== '—');
  const metaItems: KeyValueItem[] = [
    ...Object.entries(meta).map(([k, v]) => ({
      key: k,
      label: k,
      value: v,
      mono: k !== 'Provider' && k !== 'Finish reason',
    })),
    { key: 'span', label: 'Span id', value: node.span_id, mono: true },
  ];
  const out = outputTone(node);
  return (
    <div className={styles.stack}>
      {usageItems.length ? (
        <Panel title="Usage">
          <KeyValueGrid items={usageItems} columns={4} dense aria-label="Usage" />
        </Panel>
      ) : null}
      <Panel title="Model">
        <KeyValueGrid items={metaItems} columns={3} dense aria-label="Model" />
      </Panel>
      {settings ? (
        <Panel title="Settings">
          <FieldList data={settings} label="Settings" />
        </Panel>
      ) : null}
      {tools.length ? (
        <Panel title="Tools offered" after={<span className={styles.fact}>{tools.length}</span>}>
          <ul className={styles.toolList}>
            {tools.map((tool, i) => (
              <li key={i}>
                <span className={styles.toolName}>{tool.name}</span>
                {tool.description ? <span className={styles.toolNote}>{tool.description}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {a['output.value'] != null ? (
        <PayloadBlock title="Output" tone={out} value={a['output.value']} label="Response" />
      ) : null}
      {a['input.value'] != null ? (
        <PayloadBlock title="Input" tone="info" value={a['input.value']} label="Request" />
      ) : null}
    </div>
  );
}

/** The query of a retriever: its input, or the one text field of its input ({"query": "…"}). */
function retrieverQuery(value: unknown): unknown {
  const v = parseJsonish(value);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const q = o.query ?? o.question ?? o.input ?? o.q;
    if (typeof q === 'string') return q;
  }
  return value;
}

/** A metadata value as a chip shows it: text as written, anything else as compact JSON. */
const chipText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** One retrieved document: a compact card (its title, its place and score, the text, the metadata as chips). */
function DocumentCard({ doc, n }: { doc: RetrievedDoc; n: number }) {
  const [open, setOpen] = useState(false);
  const name = `Document ${n}`;
  const meta = Object.entries(doc.meta ?? {});
  if (doc.id && !meta.some(([k]) => k.toLowerCase() === 'id')) meta.push(['id', doc.id]);
  return (
    <li className={styles.doc} aria-label={doc.title ? `${name}, ${doc.title}` : name}>
      <div className={styles.docHead}>
        <span className={styles.docIcon} aria-hidden="true">
          <Icon name={KIND_ICON.RETRIEVER} size={14} />
        </span>
        <div className={styles.docText}>
          <h4 className={styles.docTitle}>{doc.title ?? name}</h4>
          <span className={styles.docSub}>
            {doc.title ? name : null}
            {doc.title && doc.score !== undefined ? ' · ' : null}
            {doc.score !== undefined ? `score ${doc.score.toFixed(2)}` : null}
          </span>
        </div>
        <span className={styles.actions}>
          <CopyAct text={doc.content} label={`Copy document ${n}`} />
          <Act label={`Expand document ${n}`} icon="expand" onPress={() => setOpen(true)} />
        </span>
      </div>
      <div className={styles.docBody}>
        <ScrollBody label={name}>
          <Value value={doc.content} label={name} />
        </ScrollBody>
      </div>
      {meta.length ? (
        <ul className={styles.chips} aria-label={`Metadata of document ${n}`}>
          {meta.map(([k, v]) => (
            <li key={k} className={styles.chip}>
              <span className={styles.chipKey}>{k}</span>
              <span className={styles.chipValue}>{chipText(v)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <Dialog open onOpenChange={setOpen} title={doc.title ?? name} size="data">
          <TextBlock text={doc.content} />
        </Dialog>
      ) : null}
    </li>
  );
}

/** A retriever's documents as the pre-React viewer showed them: a head with the count, the query, a card per document. */
function Documents({ node, docs }: { node: SpanNode; docs: RetrievedDoc[] }) {
  const [open, setOpen] = useState(false);
  const query = node.attributes?.['input.value'];
  const all = docs
    .map((d, i) => `Document ${i + 1}${d.title ? `: ${d.title}` : ''}\n${d.content}`)
    .join('\n\n');
  return (
    <div className={styles.docs} style={{ '--tone': KIND_TONE.RETRIEVER } as CSSProperties}>
      <header className={styles.docsHead}>
        <div className={styles.docText}>
          <h4 className={styles.docsTitle}>Retrieved Documents</h4>
          <p className={styles.docsSub}>
            Context returned by this retriever span
            <Tag>{`${docs.length} retrieved`}</Tag>
          </p>
        </div>
        <span className={styles.actions}>
          <CopyAct text={all} label="Copy documents" />
          <Act label="Expand documents" icon="expand" onPress={() => setOpen(true)} />
        </span>
      </header>
      {query != null ? (
        <section className={styles.query} data-tone="info" aria-label="Query">
          <Eyebrow className={styles.queryLabel}>Query</Eyebrow>
          <div className={styles.queryBox}>
            <Value value={retrieverQuery(query)} label="Query" />
          </div>
        </section>
      ) : null}
      <ol className={styles.docList}>
        {docs.map((d, i) => (
          <DocumentCard key={i} doc={d} n={i + 1} />
        ))}
      </ol>
      {open ? (
        <Dialog open onOpenChange={setOpen} title="Retrieved Documents" size="data">
          <TextBlock text={all} />
        </Dialog>
      ) : null}
    </div>
  );
}

/** The thread with the model's reasoning recorded beside it (not in a message) folded into its first answer. */
function withReasoning(thread: SpanThread, node: SpanNode): SpanThread {
  const reasoning = extractReasoning(node);
  if (
    !reasoning ||
    [...thread.input, ...thread.output].some((m) => m.parts.some((p) => p.type === 'thinking'))
  )
    return thread;
  const at = thread.output.findIndex((m) => m.role === 'assistant');
  if (at < 0)
    return {
      ...thread,
      output: [...thread.output, { role: 'assistant', parts: [{ type: 'thinking', text: reasoning }] }],
    };
  return {
    ...thread,
    output: thread.output.map((m, i) =>
      i === at ? { ...m, parts: [{ type: 'thinking' as const, text: reasoning }, ...m.parts] } : m,
    ),
  };
}

export interface SpanDetailProps {
  node: SpanNode;
  /** The spans of the trace in view: a tool call opens the span that ran it, a tool span the call that asked. */
  nodes?: SpanNode[];
  /** Open another span of the trace (the tree selects it). */
  onOpenSpan?: (spanId: string) => void;
}

export function SpanDetail({ node, nodes, onOpenSpan }: SpanDetailProps) {
  const a = useMemo(() => node.attributes ?? {}, [node.attributes]);
  const kind = spanKind(node);
  const own = useMemo(() => {
    const th = spanThread(node);
    return th ? withReasoning(th, node) : null;
  }, [node]);
  // an agent shows the conversation of its last model call (the pre-React viewer did the same)
  const borrowed = useMemo(
    () => (own || kind !== 'AGENT' ? null : lastConversation(node)),
    [own, kind, node],
  );
  const borrowedThread = useMemo(() => {
    const th = borrowed ? spanThread(borrowed) : null;
    return th && borrowed ? withReasoning(th, borrowed) : null;
  }, [borrowed]);
  const docs = useMemo(() => spanDocuments(node), [node]);
  const scores = extractScores(node);
  const links = useMemo(
    () => (nodes && onOpenSpan ? { nodes, open: onOpenSpan } : null),
    [nodes, onOpenSpan],
  );
  const caller = useMemo(
    () => (kind === 'TOOL' && nodes ? callerOf(node, nodes) : null),
    [kind, node, nodes],
  );
  const tabs: TabItem[] = useMemo(() => {
    const t: TabItem[] = [];
    if (kind === 'LLM' && own) {
      t.push({ id: 'messages', label: 'Messages' });
      t.push({ id: 'response', label: 'Response' });
    } else {
      if (kind === 'RETRIEVER' && docs.length) t.push({ id: 'docs', label: 'Documents', count: docs.length });
      // a step with no recorded content still opens on a content tab (with an empty state), never on its metadata.
      // There is no Metrics tab: the facts of the span stand above the tabs (the meta line under the name), for every tab.
      t.push({ id: 'io', label: 'Input / Output' });
      if (own || borrowedThread) t.push({ id: 'messages', label: 'Messages' });
      if (kind !== 'RETRIEVER' && docs.length) t.push({ id: 'docs', label: 'Documents', count: docs.length });
    }
    if (scores.length) t.push({ id: 'scores', label: 'Scores', count: scores.length });
    t.push({ id: 'raw', label: 'Raw' });
    return t;
  }, [kind, own, borrowedThread, docs.length, scores.length]);
  // Round 5 R4-3: a span opens on its content (messages, response, input / output, documents), never on its metadata.
  // The last content tab picked is remembered for the session (module scope, not storage); a metadata pick is not.
  const firstContent = tabs.find((t) => CONTENT_TABS.includes(t.id))?.id ?? tabs[0]!.id;
  const [pick, setPick] = useState<string | null>(sessionContentTab);
  const current = pick && tabs.some((t) => t.id === pick) ? pick : firstContent;
  const select = (id: string) => {
    setPick(id);
    if (CONTENT_TABS.includes(id)) sessionContentTab = id;
  };
  const errors = spanErrors(node);
  const usage = spanUsage(node);
  const tokens = spanTokens(node);
  const reasoningTokens = spanReasoningTokens(node);
  const cost = formatCost(spanCost(node));
  const model = spanModel(node);
  const out = outputTone(node);
  const n = (v: number) => v.toLocaleString('en-US');
  const tokenSplit = [
    usage.input !== undefined ? `${n(usage.input)} in` : '',
    usage.output !== undefined ? `${n(usage.output)} out` : '',
  ]
    .filter(Boolean)
    .join(' / ');
  // the old viewer's one quiet line: model · duration · tokens (the in / out split small) · reasoning · cost
  const facts: ReactNode[] = [
    model ? (
      <span key="model" className={styles.model}>
        {model}
      </span>
    ) : null,
    <span key="duration">{formatDuration(node.duration_ms)}</span>,
    tokens ? (
      <span key="tokens">
        {`${n(tokens)} tokens`}
        {tokenSplit ? <span className={styles.split}>{tokenSplit}</span> : null}
      </span>
    ) : null,
    reasoningTokens ? <span key="reasoning">{`${n(reasoningTokens)} reasoning`}</span> : null,
    cost ? <span key="cost">{cost}</span> : null,
  ].filter(Boolean);
  const toolCallId = kind === 'TOOL' ? toolCallIdOf(node) : '';
  const content = (id: string) => {
    if (id !== current) return null;
    if (id === 'messages') {
      if (own) return <Thread thread={own} span={node} outputTone={out} />;
      if (borrowed && borrowedThread)
        return (
          <div className={styles.stack}>
            <p className={styles.linkLine}>
              <span>
                The conversation of the last model call in this step, <strong>{borrowed.name}</strong>.
              </span>
              <OpenSpan target={borrowed} />
            </p>
            <Thread thread={borrowedThread} span={borrowed} outputTone={outputTone(borrowed)} />
          </div>
        );
      return null;
    }
    if (id === 'response') return <Response node={node} />;
    if (id === 'docs') return <Documents node={node} docs={docs} />;
    if (id === 'io') {
      const call =
        kind === 'TOOL' ? (
          <p className={styles.linkLine}>
            <span className={styles.toolName}>{toolNameOf(node)}</span>
            {toolCallId ? (
              <span className={styles.fact} title="Tool call id">
                {toolCallId}
              </span>
            ) : null}
            {caller ? (
              <>
                <span>Called by</span>
                <OpenSpan target={caller}>{caller.name}</OpenSpan>
              </>
            ) : null}
          </p>
        ) : null;
      if (a['input.value'] == null && a['output.value'] == null)
        return (
          <div className={styles.stack}>
            {call}
            <p className={styles.empty}>No input or output was recorded for this step.</p>
          </div>
        );
      return (
        <div className={styles.stack}>
          {call}
          {a['input.value'] != null ? (
            <PayloadBlock
              title="Input"
              tone="info"
              value={a['input.value']}
              label="Span input"
              json={kind === 'TOOL'}
            />
          ) : (
            <p className={styles.note}>No input was recorded for this step.</p>
          )}
          {a['output.value'] != null ? (
            <PayloadBlock
              title="Output"
              tone={out}
              value={a['output.value']}
              label="Span output"
              json={kind === 'TOOL'}
            />
          ) : (
            <p className={styles.note}>No output was recorded for this step.</p>
          )}
        </div>
      );
    }
    if (id === 'scores') {
      return (
        <div className={styles.stack}>
          {scores.map((s, i) => (
            <TraceBlock
              key={i}
              title={s.name}
              text={[String(s.value), s.label, s.explanation].filter(Boolean).join('\n')}
              after={
                <>
                  <span className={styles.fact}>{String(s.value)}</span>
                  {s.label ? <StateTag tone="neutral">{s.label}</StateTag> : null}
                </>
              }
            >
              {s.explanation ? (
                <TextBlock text={s.explanation} />
              ) : (
                <p className={styles.note}>No explanation was recorded.</p>
              )}
            </TraceBlock>
          ))}
        </div>
      );
    }
    return <JsonTree data={rawSpan(node)} expandDepth={2} label="Span JSON" />;
  };
  return (
    <TraceLinks.Provider value={links}>
      <div className={styles.detail} data-testid="span-detail">
        <header className={styles.head}>
          <span
            className={styles.kindIcon}
            style={{ ['--tone' as string]: KIND_TONE[kind] }}
            role="img"
            aria-label={KIND_LABEL[kind]}
            title={KIND_LABEL[kind]}
          >
            <Icon name={KIND_ICON[kind]} size={16} />
          </span>
          <div className={styles.headText}>
            <h3 className={styles.spanName} tabIndex={-1}>
              {node.name}
            </h3>
            <p className={styles.metaLine} data-testid="span-facts">
              {facts}
            </p>
          </div>
          <span className={styles.headEnd}>
            <SpanStatusTag status={node.status} />
            <CopyAct text={node.span_id} label="Copy span id" />
          </span>
        </header>
        {errors.map((e, i) => (
          <div key={i} role="alert">
            <TraceBlock
              title="Error"
              tone="danger"
              text={[`${e.type}: ${e.message}`, e.stack].filter(Boolean).join('\n\n')}
              expanded={
                <div className={styles.stack}>
                  <p className={styles.errorType}>{e.type}</p>
                  {e.message ? <TextBlock text={e.message} dir="ltr" /> : null}
                  {e.stack ? <TextBlock text={e.stack} code dir="ltr" /> : null}
                </div>
              }
            >
              <p className={styles.errorType}>{e.type}</p>
              {e.message ? <TextBlock text={e.message} dir="ltr" /> : null}
              {e.from ? (
                <p className={styles.linkLine}>
                  <span>Raised in a step under this one,</span>
                  <OpenSpan target={e.from}>{e.from.name}</OpenSpan>
                </p>
              ) : null}
              {e.stack ? (
                <Disclosure className={styles.reasoning} title="Stack trace">
                  <ScrollBody label="Stack trace">
                    <TextBlock text={e.stack} code dir="ltr" />
                  </ScrollBody>
                </Disclosure>
              ) : null}
            </TraceBlock>
          </div>
        ))}
        <Tabs label="Span details" items={tabs} selected={current} onSelect={select}>
          {tabs.map((t) => (
            <TabPanel key={t.id} id={t.id} forceMount>
              <div className={styles.pane}>{content(t.id)}</div>
            </TabPanel>
          ))}
        </Tabs>
      </div>
    </TraceLinks.Provider>
  );
}

/**
 * A span's status is the result of a call, so a StateTag (status rules 2026-11-12): OK success, Error danger, any
 * other value (Unset when missing) neutral, in sentence case.
 */
function SpanStatusTag({ status }: { status: unknown }) {
  const cls = statusClass(status);
  const raw = cls === 'ok' ? 'OK' : String(status ?? 'unset').toLowerCase();
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return (
    <StateTag tone={cls === 'error' ? 'danger' : cls === 'ok' ? 'success' : 'neutral'}>{label}</StateTag>
  );
}
