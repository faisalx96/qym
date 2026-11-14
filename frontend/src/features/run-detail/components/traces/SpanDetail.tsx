/**
 * Right pane: the span's identity and facts, then its tabs (Messages, Input / Output, Documents, Scores, Raw).
 * The blocks, the JSON value view and the action tiles are the item pane's own, so a span reads as an item does.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  ClampedText,
  Dialog,
  Disclosure,
  Icon,
  JsonTree,
  StatStrip,
  TabPanel,
  Tabs,
  TextBlock,
  parseStructured,
  type StatStripItem,
  type TabItem,
  StateTag,
} from '@/ui';
import {
  formatDuration,
  formatCost,
  extractMessages,
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
import { bodyText } from '../../lib/itemText';
import { Act, CopyTile } from '../items/pane/actions';
import { Block, type BlockTone } from '../items/pane/blocks';
import { FieldList, JsonToggle, Value, isStructuredValue } from '../items/pane/values';
import { KIND_ICON, KIND_LABEL, KIND_TONE } from './spanKinds';
import styles from './TraceDrawer.module.css';

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
 * One titled part of a span in the item pane's block recipe (inset fill, tone rail, eyebrow head). Its actions are
 * tiles: the block's own switches, copy, and a full-size dialog.
 */
function TraceBlock({
  title,
  tone = 'neutral',
  text,
  after,
  switches,
  children,
  expanded,
  expand = true,
  role,
}: {
  title: string;
  tone?: BlockTone;
  /** What copy puts on the clipboard. */
  text: string;
  /** Right after the title: a short fact. */
  after?: ReactNode;
  /** Tiles before copy (the raw JSON switch of this block). */
  switches?: ReactNode;
  children: ReactNode;
  /** Content for the full-size dialog (defaults to `children`). */
  expanded?: ReactNode;
  /** A short block has no full-size dialog. */
  expand?: boolean;
  role?: string;
}) {
  const [open, setOpen] = useState(false);
  const name = title.toLowerCase();
  return (
    <>
      <Block
        title={title}
        tone={tone}
        part={role}
        after={after}
        actions={
          <>
            {switches}
            <CopyTile text={text} label={`Copy ${name}`} />
            {expand ? <Act label={`Expand ${name}`} icon="expand" onPress={() => setOpen(true)} /> : null}
          </>
        }
      >
        {children}
      </Block>
      {open ? (
        <Dialog open onOpenChange={setOpen} title={title} size="data">
          <div className={styles.expanded}>{expanded ?? children}</div>
        </Dialog>
      ) : null}
    </>
  );
}

/** The input or the output of a span: text is prose, JSON is the pane's fields view with a raw switch of its own. */
function PayloadBlock({
  title,
  tone,
  value,
  label,
}: {
  title: string;
  tone: BlockTone;
  value: unknown;
  label: string;
}) {
  const [raw, setRaw] = useState(false);
  return (
    <TraceBlock
      title={title}
      tone={tone}
      text={bodyText(value)}
      switches={isStructuredValue(value) ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
    >
      <Value value={value} label={label} raw={raw} />
    </TraceBlock>
  );
}

function ToolArguments({ args }: { args: string }) {
  return parseStructured(args).structured ? (
    <Value value={args} label="Tool arguments" />
  ) : (
    <TextBlock text={args} code />
  );
}

function ToolCall({ name, args }: { name: string; args: string }) {
  return (
    <div className={styles.toolCall}>
      <div className={styles.toolHead}>
        <span className={styles.glyph} style={{ ['--tone' as string]: KIND_TONE.TOOL }} aria-hidden="true">
          <Icon name={KIND_ICON.TOOL} size={12} />
        </span>
        <span className={styles.toolName}>{name}</span>
        <span className={styles.toolNote}>tool call</span>
      </div>
      <ToolArguments args={args} />
    </div>
  );
}

const ROLE_TITLE: Record<string, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool',
};

function Messages({ node, only }: { node: SpanNode; only?: 'input' | 'output' }) {
  const a = node.attributes ?? {};
  const input = only === 'output' ? [] : extractMessages(a, 'llm.input_messages');
  const output = only === 'input' ? [] : extractMessages(a, 'llm.output_messages');
  const reasoning = extractReasoning(node);
  const out = outputTone(node);
  const render = (msgs: ReturnType<typeof extractMessages>, key: string) =>
    msgs.map((m, i) => {
      // what went in is blue, what the model gave has the colour of the call's result
      const tone: BlockTone = m.role === 'user' ? 'info' : m.role === 'assistant' ? out : 'neutral';
      return (
        <TraceBlock
          key={`${key}${i}`}
          title={ROLE_TITLE[m.role] ?? m.role}
          tone={tone}
          role={m.role}
          text={m.content || m.toolCalls.map((t) => `${t.name} ${t.arguments}`).join('\n')}
          expanded={
            <>
              {m.content ? <TextBlock text={m.content} /> : null}
              {m.toolCalls.map((t, j) => (
                <ToolCall key={j} name={t.name} args={t.arguments} />
              ))}
            </>
          }
        >
          <div className={styles.stack}>
            {m.reasoning ? (
              <Disclosure className={styles.reasoning} title="Reasoning">
                <TextBlock text={m.reasoning} />
              </Disclosure>
            ) : null}
            {m.content ? <ClampedText text={m.content} lines={14} /> : null}
            {m.toolCalls.map((t, j) => (
              <ToolCall key={j} name={t.name} args={t.arguments} />
            ))}
          </div>
        </TraceBlock>
      );
    });
  return (
    <div className={styles.stack}>
      {render(input, 'in')}
      {render(output, 'out')}
      {reasoning && !output.some((m) => m.reasoning) ? (
        <Disclosure className={styles.reasoning} title="Reasoning">
          <TextBlock text={reasoning} />
        </Disclosure>
      ) : null}
    </div>
  );
}

function docsOf(a: Record<string, unknown>) {
  const docs: Array<{ content: string; score: number | null; meta: Record<string, unknown> | null }> = [];
  for (let i = 0; i < 100; i++) {
    const content = a[`retrieval.documents.${i}.document.content`];
    if (content == null) break;
    const score = a[`retrieval.documents.${i}.document.score`];
    let meta: Record<string, unknown> | null = null;
    const raw = a[`retrieval.documents.${i}.document.metadata`];
    if (raw) {
      try {
        meta =
          typeof raw === 'string'
            ? (JSON.parse(raw) as Record<string, unknown>)
            : (raw as Record<string, unknown>);
      } catch {
        meta = null;
      }
    }
    docs.push({ content: String(content), score: typeof score === 'number' ? score : null, meta });
  }
  return docs;
}

/** The span as ingested: the tree builder's own `_` bookkeeping fields are not part of it. */
export function rawSpan(node: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([k]) => !k.startsWith('_')));
}

export function SpanDetail({ node }: { node: SpanNode }) {
  const a = useMemo(() => node.attributes ?? {}, [node.attributes]);
  const kind = spanKind(node);
  const inputMsgs =
    extractMessages(a, 'llm.input_messages').length + extractMessages(a, 'llm.output_messages').length;
  const docs = docsOf(a);
  const scores = extractScores(node);
  const tabs: TabItem[] = useMemo(() => {
    const t: TabItem[] = [];
    const hasIo = a['input.value'] != null || a['output.value'] != null;
    if (kind === 'LLM' && inputMsgs) {
      t.push({ id: 'messages', label: 'Messages' });
      if (extractMessages(a, 'llm.output_messages').length || a['output.value'] != null)
        t.push({ id: 'response', label: 'Response' });
    } else {
      if (hasIo) t.push({ id: 'io', label: 'Input / Output' });
      if (inputMsgs) t.push({ id: 'messages', label: 'Messages' });
    }
    if (docs.length) t.push({ id: 'docs', label: 'Documents', count: docs.length });
    // a step with no recorded content still opens on a content tab (with an empty state), never on its metadata.
    // There is no Metrics tab: the facts of the span stand above the tabs (the stat strip), for every tab.
    if (!t.length) t.push({ id: 'io', label: 'Input / Output' });
    if (scores.length) t.push({ id: 'scores', label: 'Scores', count: scores.length });
    t.push({ id: 'raw', label: 'Raw' });
    return t;
  }, [a, kind, docs.length, inputMsgs, scores.length]);
  // Round 5 R4-3: a span opens on its content (messages, response, input / output, documents), never on its metadata.
  // The last content tab picked is remembered for the session (module scope, not storage); a metadata pick is not.
  const firstContent = tabs.find((t) => CONTENT_TABS.includes(t.id))?.id ?? tabs[0]!.id;
  const [pick, setPick] = useState<string | null>(sessionContentTab);
  const current = pick && tabs.some((t) => t.id === pick) ? pick : firstContent;
  const select = (id: string) => {
    setPick(id);
    if (CONTENT_TABS.includes(id)) sessionContentTab = id;
  };
  const errorEvents = (node.events ?? []).filter((e) => e?.name === 'exception');
  const tokens = spanTokens(node);
  const reasoningTokens = spanReasoningTokens(node);
  const cost = formatCost(spanCost(node));
  const model = spanModel(node);
  const out = outputTone(node);
  const facts: StatStripItem[] = [
    { key: 'duration', label: 'Duration', value: formatDuration(node.duration_ms) },
    ...(tokens ? [{ key: 'tokens', label: 'Tokens', value: tokens.toLocaleString('en-US') }] : []),
    ...(reasoningTokens
      ? [{ key: 'reasoning', label: 'Reasoning tokens', value: reasoningTokens.toLocaleString('en-US') }]
      : []),
    ...(cost ? [{ key: 'cost', label: 'Cost', value: cost }] : []),
  ];
  const content = (id: string) => {
    if (id !== current) return null;
    if (id === 'messages') return <Messages node={node} />;
    if (id === 'response') {
      if (extractMessages(a, 'llm.output_messages').length) return <Messages node={node} only="output" />;
      return <PayloadBlock title="Output" tone={out} value={a['output.value']} label="Response" />;
    }
    if (id === 'io' && a['input.value'] == null && a['output.value'] == null) {
      return <p className={styles.empty}>No input or output was recorded for this step.</p>;
    }
    if (id === 'io') {
      return (
        <div className={styles.stack}>
          {a['input.value'] != null ? (
            <PayloadBlock title="Input" tone="info" value={a['input.value']} label="Span input" />
          ) : null}
          {a['output.value'] != null ? (
            <PayloadBlock title="Output" tone={out} value={a['output.value']} label="Span output" />
          ) : null}
        </div>
      );
    }
    if (id === 'docs') {
      return (
        <div className={styles.stack}>
          {docs.map((d, i) => (
            <TraceBlock
              key={i}
              title={`Document ${i + 1}`}
              text={d.content}
              after={
                d.score !== null ? <span className={styles.fact}>score {d.score.toFixed(2)}</span> : undefined
              }
              expanded={<TextBlock text={d.content} />}
            >
              <div className={styles.stack}>
                <ClampedText text={d.content} lines={14} />
                {d.meta && Object.keys(d.meta).length ? (
                  <FieldList data={d.meta} label={`Metadata of document ${i + 1}`} />
                ) : null}
              </div>
            </TraceBlock>
          ))}
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
    <div className={styles.detail} data-testid="span-detail">
      <header className={styles.detailHead}>
        <span
          className={styles.kindTile}
          style={{ ['--tone' as string]: KIND_TONE[kind] }}
          aria-hidden="true"
        >
          <Icon name={KIND_ICON[kind]} size={14} />
        </span>
        <div className={styles.headText}>
          <h3 className={styles.spanName}>{node.name}</h3>
          <div className={styles.metaLine}>{[KIND_LABEL[kind], model].filter(Boolean).join(' · ')}</div>
        </div>
        <SpanStatusTag status={node.status} />
        <CopyTile text={node.span_id} label="Copy span id" />
      </header>
      <div className={styles.stats} data-fit="" style={{ ['--n' as string]: facts.length }}>
        <StatStrip variant="compact" aria-label="Span facts" items={facts} />
      </div>
      {errorEvents.map((e, i) => {
        const type = String(e.attributes?.['exception.type'] ?? 'Exception');
        const message = String(e.attributes?.['exception.message'] ?? '');
        return (
          <div key={i} role="alert">
            <TraceBlock title="Error" tone="danger" text={`${type}: ${message}`} expand={false}>
              <p className={styles.errorLead}>{type}</p>
              {message ? <TextBlock text={message} code dir="ltr" /> : null}
            </TraceBlock>
          </div>
        );
      })}
      <Tabs label="Span details" items={tabs} selected={current} onSelect={select}>
        {tabs.map((t) => (
          <TabPanel key={t.id} id={t.id} forceMount>
            <div className={styles.pane}>{content(t.id)}</div>
          </TabPanel>
        ))}
      </Tabs>
    </div>
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
