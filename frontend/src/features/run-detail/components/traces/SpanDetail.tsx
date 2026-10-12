/** Right pane: per-span tabs (Messages, Input/Output, Documents, Metrics, Scores, Raw). */
import { useMemo, useState } from 'react';
import { CopyButton, JsonTree, TabPanel, Tabs, Tag, TextBlock, type TabItem } from '@/ui';
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
import { KIND_LABEL } from './spanKinds';
import styles from './TraceDrawer.module.css';

function LongText({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 1200 || text.split('\n').length > 14;
  return (
    <div className={styles.longText}>
      <div className={styles.longHead}>
        <CopyButton text={text} label={`Copy ${label}`} />
      </div>
      <div className={long && !open ? styles.clamp : undefined}>
        <TextBlock text={text} />
      </div>
      {long ? (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function Messages({ node }: { node: SpanNode }) {
  const a = node.attributes ?? {};
  const input = extractMessages(a, 'llm.input_messages');
  const output = extractMessages(a, 'llm.output_messages');
  const reasoning = extractReasoning(node);
  const render = (msgs: ReturnType<typeof extractMessages>, key: string) =>
    msgs.map((m, i) => (
      <div key={`${key}${i}`} className={styles.msg} data-role={m.role}>
        <div className={styles.role}>{m.role}</div>
        {m.reasoning ? (
          <details className={styles.reasoning}>
            <summary>Reasoning</summary>
            <TextBlock text={m.reasoning} />
          </details>
        ) : null}
        {m.content ? <LongText text={m.content} label={`${m.role} message`} /> : null}
        {m.toolCalls.map((t, j) => (
          <div key={j} className={styles.toolCall}>
            <Tag kind="data">{t.name}</Tag>
            <TextBlock text={t.arguments} code />
          </div>
        ))}
      </div>
    ));
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
    if (inputMsgs) t.push({ id: 'messages', label: 'Messages' });
    if (a['input.value'] != null || a['output.value'] != null) t.push({ id: 'io', label: 'Input / Output' });
    if (docs.length) t.push({ id: 'docs', label: 'Documents', count: docs.length });
    t.push({ id: 'metrics', label: 'Metrics' });
    if (scores.length) t.push({ id: 'scores', label: 'Scores', count: scores.length });
    t.push({ id: 'raw', label: 'Raw' });
    return t;
  }, [a, docs.length, inputMsgs, scores.length]);
  const [pick, setPick] = useState('messages');
  const current = tabs.some((t) => t.id === pick) ? pick : tabs[0]!.id;
  const errorEvents = (node.events ?? []).filter((e) => e?.name === 'exception');
  const tokens = spanTokens(node);
  const cost = formatCost(spanCost(node));
  const content = (id: string) => {
    if (id !== current) return null;
    if (id === 'messages') return <Messages node={node} />;
    if (id === 'io') {
      return (
        <div className={styles.stack}>
          {a['input.value'] != null ? (
            <section>
              <div className={styles.label}>Input</div>
              <LongText text={bodyText(a['input.value'])} label="input" />
            </section>
          ) : null}
          {a['output.value'] != null ? (
            <section>
              <div className={styles.label}>Output</div>
              <LongText text={bodyText(a['output.value'])} label="output" />
            </section>
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
                <span className={styles.label}>Document {i + 1}</span>
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
              <LongText text={d.content} label={`document ${i + 1}`} />
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
        <h3 className={styles.spanName}>{node.name}</h3>
        <Tag
          tone={
            statusClass(node.status) === 'error'
              ? 'danger'
              : statusClass(node.status) === 'ok'
                ? 'success'
                : undefined
          }
        >
          {node.status ?? 'UNSET'}
        </Tag>
        <span className={styles.meta}>{formatDuration(node.duration_ms)}</span>
      </header>
      {errorEvents.map((e, i) => (
        <div key={i} className={styles.exception} role="alert">
          <b>{String(e.attributes?.['exception.type'] ?? 'Exception')}</b>:{' '}
          {String(e.attributes?.['exception.message'] ?? '')}
        </div>
      ))}
      <Tabs label="Span details" items={tabs} selected={current} onSelect={setPick}>
        {tabs.map((t) => (
          <TabPanel key={t.id} id={t.id} forceMount>
            <div className={styles.pane}>{content(t.id)}</div>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
