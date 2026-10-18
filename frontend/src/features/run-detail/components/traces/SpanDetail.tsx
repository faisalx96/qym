/** Right pane: per-span tabs (Messages, Input/Output, Documents, Metrics, Scores, Raw). */
import { useMemo, useState } from 'react';
import {
  Badge,
  ClampedText,
  CopyButton,
  Dialog,
  Icon,
  IconButton,
  JsonTree,
  StructuredValue,
  TabPanel,
  Tabs,
  Tag,
  TextBlock,
  parseStructured,
  type TabItem,
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
import { KIND_ICON, KIND_LABEL, KIND_TONE } from './spanKinds';
import styles from './TraceDrawer.module.css';

/** Tabs that show what the step did; the others (Metrics, Scores, Raw) describe it. */
const CONTENT_TABS = ['messages', 'response', 'io', 'docs'];
/** The content tab picked last in this page session; never persisted, never a metadata tab. */
let sessionContentTab: string | null = null;

type LabelTone = 'info' | 'success' | 'muted';

/** Labelled block: the label row carries copy and expand-to-dialog; the body is hairline separated, never boxed. */
function Block({
  label,
  tone = 'muted',
  text,
  children,
  expanded,
  role,
}: {
  label: string;
  tone?: LabelTone;
  /** What copy puts on the clipboard. */
  text: string;
  children: React.ReactNode;
  /** Content for the full-size dialog (defaults to `children`). */
  expanded?: React.ReactNode;
  role?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.block} data-role={role} aria-label={label}>
      <header className={styles.blockHead}>
        <span className={styles.blockLabel} data-tone={tone}>
          {label}
        </span>
        <span className={styles.blockActions}>
          <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
          <IconButton
            label={`Expand ${label.toLowerCase()}`}
            icon={<Icon name="expand" size={14} />}
            onPress={() => setOpen(true)}
          />
        </span>
      </header>
      <div className={styles.blockBody}>{children}</div>
      {open ? (
        <Dialog open onOpenChange={setOpen} title={label} size="data">
          <div className={styles.expanded}>{expanded ?? children}</div>
        </Dialog>
      ) : null}
    </section>
  );
}

/** Text or JSON payload of a span: JSON gets per-key sections, text clamps with Show more. */
function Payload({ value, label }: { value: unknown; label: string }) {
  return <StructuredValue value={value} label={label} defaultOpen="auto" />;
}

function ToolArguments({ args }: { args: string }) {
  const parsed = parseStructured(args);
  return parsed.structured ? (
    <JsonTree data={parsed.data} expandDepth={2} label="Tool arguments" toolbar={false} />
  ) : (
    <TextBlock text={args} code />
  );
}

function Messages({ node, only }: { node: SpanNode; only?: 'input' | 'output' }) {
  const a = node.attributes ?? {};
  const input = only === 'output' ? [] : extractMessages(a, 'llm.input_messages');
  const output = only === 'input' ? [] : extractMessages(a, 'llm.output_messages');
  const reasoning = extractReasoning(node);
  const render = (msgs: ReturnType<typeof extractMessages>, key: string) =>
    msgs.map((m, i) => {
      const tone: LabelTone = m.role === 'user' ? 'info' : m.role === 'assistant' ? 'success' : 'muted';
      return (
        <Block
          key={`${key}${i}`}
          label={m.role.toUpperCase()}
          tone={tone}
          role={m.role}
          text={m.content || m.toolCalls.map((t) => `${t.name} ${t.arguments}`).join('\n')}
          expanded={
            <>
              {m.content ? <TextBlock text={m.content} /> : null}
              {m.toolCalls.map((t, j) => (
                <div key={j} className={styles.toolCall}>
                  <ToolArguments args={t.arguments} />
                </div>
              ))}
            </>
          }
        >
          {m.reasoning ? (
            <details className={styles.reasoning}>
              <summary>Reasoning</summary>
              <TextBlock text={m.reasoning} />
            </details>
          ) : null}
          {m.content ? <ClampedText text={m.content} lines={14} /> : null}
          {m.toolCalls.map((t, j) => (
            <div key={j} className={styles.toolCall}>
              <div className={styles.toolHead}>
                <span className={styles.toolName}>{t.name}</span>
                <Tag kind="data" tone="meta">
                  CALL
                </Tag>
              </div>
              <ToolArguments args={t.arguments} />
            </div>
          ))}
        </Block>
      );
    });
  return (
    <div className={styles.stack}>
      {render(input, 'in')}
      {render(output, 'out')}
      {reasoning && !output.some((m) => m.reasoning) ? (
        <details className={styles.reasoning}>
          <summary>Reasoning</summary>
          <TextBlock text={reasoning} />
        </details>
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
    // a step with no recorded content still opens on a content tab (with an empty state), never on its metadata
    if (!t.length) t.push({ id: 'io', label: 'Input / Output' });
    t.push({ id: 'metrics', label: 'Metrics' });
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
  const cost = formatCost(spanCost(node));
  const content = (id: string) => {
    if (id !== current) return null;
    if (id === 'messages') return <Messages node={node} />;
    if (id === 'response') {
      const out = extractMessages(a, 'llm.output_messages');
      if (out.length) return <Messages node={node} only="output" />;
      return (
        <Block label="OUTPUT" tone="success" text={bodyText(a['output.value'])}>
          <Payload value={a['output.value']} label="Response" />
        </Block>
      );
    }
    if (id === 'io' && a['input.value'] == null && a['output.value'] == null) {
      return <p className={styles.empty}>No input or output was recorded for this step.</p>;
    }
    if (id === 'io') {
      return (
        <div className={styles.stack}>
          {a['input.value'] != null ? (
            <Block label="INPUT" tone="info" text={bodyText(a['input.value'])}>
              <Payload value={a['input.value']} label="Span input" />
            </Block>
          ) : null}
          {a['output.value'] != null ? (
            <Block label="OUTPUT" tone="success" text={bodyText(a['output.value'])}>
              <Payload value={a['output.value']} label="Span output" />
            </Block>
          ) : null}
        </div>
      );
    }
    if (id === 'docs') {
      return (
        <div className={styles.stack}>
          {docs.map((d, i) => (
            <article key={i} className={styles.doc}>
              <header className={styles.docHead}>
                <span className={styles.blockLabel}>Document {i + 1}</span>
                {d.score !== null ? <Tag kind="data">score {d.score.toFixed(2)}</Tag> : null}
                {d.meta
                  ? Object.entries(d.meta)
                      .slice(0, 4)
                      .map(([k, v]) => (
                        <Tag key={k} kind="data">
                          {k}: {String(v)}
                        </Tag>
                      ))
                  : null}
              </header>
              <ClampedText text={d.content} lines={14} />
            </article>
          ))}
        </div>
      );
    }
    if (id === 'metrics') {
      const rt = spanReasoningTokens(node);
      const rows: Array<[string, string]> = [
        ['Kind', KIND_LABEL[kind]],
        ['Status', node.status ?? 'UNSET'],
        ['Duration', formatDuration(node.duration_ms)],
        ['Model', spanModel(node) || '—'],
        ['Tokens', tokens ? tokens.toLocaleString('en-US') : '—'],
        ['Reasoning tokens', rt ? rt.toLocaleString('en-US') : '—'],
        ['Cost', cost ?? '—'],
        ['Span id', node.span_id],
      ];
      return (
        <dl className={styles.kv}>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      );
    }
    if (id === 'scores') {
      return (
        <div className={styles.stack}>
          {scores.map((s, i) => (
            <div key={i} className={styles.doc}>
              <b>{s.name}</b> <Tag kind="data">{String(s.value)}</Tag> {s.label ? <Tag>{s.label}</Tag> : null}
              {s.explanation ? <TextBlock text={s.explanation} /> : null}
            </div>
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
          <div className={styles.metaLine}>
            {[
              spanModel(node),
              formatDuration(node.duration_ms),
              tokens ? `${tokens.toLocaleString('en-US')} tokens` : '',
              cost ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <Badge
          tone={
            statusClass(node.status) === 'error'
              ? 'danger'
              : statusClass(node.status) === 'ok'
                ? 'success'
                : 'neutral'
          }
        >
          {statusClass(node.status) === 'ok' ? 'OK' : (node.status ?? 'UNSET')}
        </Badge>
      </header>
      {errorEvents.map((e, i) => (
        <div key={i} className={styles.exception} role="alert">
          <b>{String(e.attributes?.['exception.type'] ?? 'Exception')}</b>:{' '}
          {String(e.attributes?.['exception.message'] ?? '')}
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
  );
}
