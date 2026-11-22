/**
 * The conversation of a span, as the pre-React trace viewer showed it and in its look (round 3 T2, owner: "the old
 * version's style and css looks better"): one thread, input then output; a message is a flat row with a faint wash of
 * its role's colour and a small role label in that colour, its copy and expand icons at the end; the tool calls sit
 * inside the message that made them (name, a CALL tag, the call id) and the tool results are named by their call (name,
 * a RESULT tag, the call id). A tool's arguments and result open as JSON (`JsonCode`), the { } switch shows the fields.
 * A tool call and a tool result open the tool span in one click. The model's thinking is folded in its message.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Button, Dialog, Disclosure, Eyebrow, Icon, StateTag, Tag, TextBlock, parseStructured } from '@/ui';
import { statusClass, type SpanNode } from '../../lib/traceTree';
import {
  messageText,
  toolSpanFor,
  type SpanThread,
  type ThreadMessage,
  type ThreadPart,
} from '../../lib/spanMessages';
import { Act, CopyAct } from '../items/pane/actions';
import { codeKind } from '../items/pane/code';
import type { BlockTone } from '../items/pane/blocks';
import { JsonToggle, PaneFold, PaneTextMode, Value, isStructuredValue } from '../items/pane/values';
import { JsonView } from './JsonCode';
import { KIND_TONE } from './spanKinds';
import t from './Thread.module.css';

/** The spans of the trace in view and the way to open one: a tool call links to the span that ran it. */
export interface TraceLinksValue {
  nodes: SpanNode[];
  open: (spanId: string) => void;
}

export const TraceLinks = createContext<TraceLinksValue | null>(null);

/**
 * Opens another span of the trace in the details (the tree selects it too). In a message row it is a small icon with
 * a tooltip, like Copy and Expand next to it (owner: the text button was too large); with a text (the "Called by"
 * link of a tool span) it is a button that shows the span's name.
 */
export function OpenSpan({ target, children }: { target: SpanNode; children?: ReactNode }) {
  const links = useContext(TraceLinks);
  if (!links) return null;
  // one accessible name for both forms
  const label = `Open span ${target.name}`;
  if (children == null) return <Act label={label} icon="trace" onPress={() => links.open(target.span_id)} />;
  return (
    <Button
      size="sm"
      variant="neutral"
      icon={<Icon name="trace" size={12} />}
      aria-label={label}
      onPress={() => links.open(target.span_id)}
    >
      {children}
    </Button>
  );
}

/**
 * A box that grows with its content up to `max`, then scrolls inside itself (the item pane's capped body): while it
 * scrolls it is a named region that takes the focus, so the keyboard can scroll it (WCAG 2.1.1).
 */
export function ScrollBody({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setOver(el.scrollHeight > el.clientHeight + 1);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div
      ref={ref}
      className={[t.scroll, className].filter(Boolean).join(' ')}
      data-scrolls={over ? '' : undefined}
      role={over ? 'region' : undefined}
      aria-label={over ? `${label}, scrolls` : undefined}
      tabIndex={over ? 0 : undefined}
    >
      <PaneFold.Provider value={false}>{children}</PaneFold.Provider>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool result',
};

type Tone = BlockTone | 'warning';

/** The colour of a role: what went in is blue, the model green (red for the answer of a failed call), a tool amber. */
function roleTone(m: ThreadMessage, output: boolean, failed: boolean): Tone {
  if (m.role === 'user') return 'info';
  if (m.role === 'assistant') return output && failed ? 'danger' : 'success';
  if (m.role === 'tool') return m.isError ? 'danger' : 'warning';
  return 'neutral';
}

function roleName(m: ThreadMessage) {
  return ROLE_LABEL[m.role] ?? m.role.charAt(0).toUpperCase() + m.role.slice(1);
}

/** The arguments or the result of a tool: JSON first (the pre-React viewer), the fields on the { } switch. */
function ToolValue({ value, label, fields }: { value: unknown; label: string; fields: boolean }) {
  return fields ? <Value value={value} label={label} /> : <JsonView value={value} label={label} />;
}

/** The { } switch of a tool value, only when it is JSON: on (pressed) is the JSON, off the fields. */
function useJsonSwitch(value: unknown): [boolean, ReactNode] {
  const [json, setJson] = useState(true);
  const toggle = isStructuredValue(value) ? <JsonToggle raw={json} onChange={setJson} /> : null;
  return [!!toggle && !json, toggle];
}

function ToolCallTile({ call, span }: { call: Extract<ThreadPart, { type: 'tool_call' }>; span: SpanNode }) {
  const links = useContext(TraceLinks);
  const [open, setOpen] = useState(false);
  const [fields, toggle] = useJsonSwitch(call.args);
  const target = links ? toolSpanFor(call, links.nodes, span) : null;
  const name = call.name || 'tool';
  const body = call.args.trim() ? (
    <ToolValue value={call.args} label="Tool arguments" fields={fields} />
  ) : (
    <p className={t.quiet}>No arguments.</p>
  );
  return (
    <div
      className={t.call}
      role="group"
      aria-label={`Tool call ${name}`}
      style={{ '--tone': KIND_TONE.TOOL } as CSSProperties}
    >
      <div className={t.callHead}>
        <span className={t.callName}>{name}</span>
        <Tag>CALL</Tag>
        {call.id ? (
          <span className={t.callId} title="Tool call id">
            {call.id}
          </span>
        ) : null}
        <span className={t.actions}>
          {target ? <OpenSpan target={target} /> : null}
          {toggle}
          <CopyAct text={call.args} label="Copy arguments" />
          <Act label="Expand arguments" icon="expand" onPress={() => setOpen(true)} />
        </span>
      </div>
      {body}
      {open ? (
        <Dialog open onOpenChange={setOpen} title={`Tool call ${name}`} size="data">
          {body}
        </Dialog>
      ) : null}
    </div>
  );
}

function Part({
  part,
  span,
  fields,
  tool,
}: {
  part: ThreadPart;
  span: SpanNode;
  fields: boolean;
  tool: boolean;
}) {
  const mode = useContext(PaneTextMode);
  // a tool message's text is the tool's result (OpenAI, OpenInference): JSON or a query opens as the tool value
  if (part.type === 'text' && tool && isToolText(part.text))
    return <ToolValue value={part.text} label="Tool result" fields={fields} />;
  if (part.type === 'text')
    return parseStructured(part.text).structured ? (
      <Value value={part.text} label="Message text" />
    ) : (
      <TextBlock text={part.text} mode={mode} code={false} />
    );
  if (part.type === 'thinking')
    return (
      <Disclosure className={t.thinking} title="Thinking">
        <TextBlock text={part.text} />
      </Disclosure>
    );
  if (part.type === 'tool_call') return <ToolCallTile call={part} span={span} />;
  if (part.type === 'tool_result') {
    if (part.content == null || part.content === '')
      return <p className={t.quiet}>The tool returned nothing.</p>;
    return <ToolValue value={part.content} label="Tool result" fields={fields} />;
  }
  return <Value value={part.value} label="Message part" />;
}

/** A tool message's text that reads as a tool value: JSON or a SQL query. */
const isToolText = (text: string) => parseStructured(text).structured || codeKind(text) === 'sql';

/**
 * The value a tool message answers with (one result part, or the one text part of a tool message): its { } switch
 * sits in the message head.
 */
function resultOf(m: ThreadMessage): unknown {
  if (m.parts.length !== 1) return undefined;
  const p = m.parts[0]!;
  if (p.type === 'tool_result') return p.content;
  return p.type === 'text' && isToolText(p.text) ? p.text : undefined;
}

function Message({
  m,
  tone,
  span,
  capped,
}: {
  m: ThreadMessage;
  tone: Tone;
  span: SpanNode;
  capped: boolean;
}) {
  const links = useContext(TraceLinks);
  const [open, setOpen] = useState(false);
  const role = roleName(m);
  const tool = m.role === 'tool';
  const [fields, toggle] = useJsonSwitch(tool ? resultOf(m) : undefined);
  const target =
    tool && links && (m.toolCallId || m.name)
      ? toolSpanFor({ id: m.toolCallId, name: m.name }, links.nodes)
      : null;
  const label = tool ? `${role}${m.name ? ` ${m.name}` : ''}` : `${role} message`;
  const what = tool ? 'tool result' : `${m.role} message`;
  const body = m.parts.length ? (
    m.parts.map((p, i) => <Part key={i} part={p} span={span} fields={fields} tool={tool} />)
  ) : (
    <p className={t.quiet}>This message is empty.</p>
  );
  return (
    <article className={t.msg} data-tone={tone} data-role={m.role} aria-label={label}>
      <header className={t.msgHead}>
        {tool ? (
          // a tool result reads as the old viewer's: the tool, a RESULT tag, the call it answers
          <>
            <span className={t.resultName}>{m.name || 'Tool'}</span>
            <Tag>RESULT</Tag>
          </>
        ) : (
          <Eyebrow className={t.role}>{role}</Eyebrow>
        )}
        {m.name && !tool ? <span className={t.name}>{m.name}</span> : null}
        {m.toolCallId ? (
          <span className={t.callId} title="Tool call id">
            {m.toolCallId}
          </span>
        ) : null}
        {m.isError ? <StateTag tone="danger">Error</StateTag> : null}
        <span className={t.actions}>
          {target ? <OpenSpan target={target} /> : null}
          {toggle}
          <CopyAct text={messageText(m)} label={`Copy ${what}`} />
          <Act label={`Expand ${what}`} icon="expand" onPress={() => setOpen(true)} />
        </span>
      </header>
      {capped ? (
        <ScrollBody label={label} className={t.msgBody}>
          {body}
        </ScrollBody>
      ) : (
        <div className={t.msgBody}>{body}</div>
      )}
      {open ? (
        <Dialog open onOpenChange={setOpen} title={label} size="data">
          <div className={t.msgBody}>{body}</div>
        </Dialog>
      ) : null}
    </article>
  );
}

function Section({
  title,
  tone,
  msgs,
  output,
  span,
}: {
  title: 'Input' | 'Output';
  tone: BlockTone;
  msgs: ThreadMessage[];
  output: boolean;
  span: SpanNode;
}) {
  const [open, setOpen] = useState(false);
  const failed = statusClass(span.status) === 'error';
  const name = title.toLowerCase();
  const list = (capped: boolean) => (
    <ol className={t.list}>
      {msgs.map((m, i) => (
        <li key={i}>
          <Message m={m} tone={roleTone(m, output, failed)} span={span} capped={capped} />
        </li>
      ))}
    </ol>
  );
  return (
    <section className={t.section} data-tone={tone} aria-label={`${title} messages`}>
      <header className={t.sectionHead}>
        <Eyebrow className={t.sectionTitle}>{title}</Eyebrow>
        <span className={t.count}>
          {msgs.length} {msgs.length === 1 ? 'message' : 'messages'}
        </span>
        <span className={t.actions}>
          <CopyAct
            text={msgs.map((m) => `${roleName(m)}:\n${messageText(m)}`).join('\n\n')}
            label={`Copy ${name} messages`}
          />
          <Act label={`Expand ${name} messages`} icon="expand" onPress={() => setOpen(true)} />
        </span>
      </header>
      {list(true)}
      {open ? (
        <Dialog open onOpenChange={setOpen} title={`${title} messages`} size="data">
          {list(false)}
        </Dialog>
      ) : null}
    </section>
  );
}

/** The thread of one span: its input messages, then what the model answered. */
export function Thread({
  thread,
  span,
  outputTone,
}: {
  thread: SpanThread;
  span: SpanNode;
  outputTone: BlockTone;
}) {
  return (
    // a model's text is shown as it reads (code fences, lists), as the rendered prompt of an item
    <PaneTextMode.Provider value="rendered">
      <div className={t.thread} data-testid="span-thread">
        {thread.input.length ? (
          <Section title="Input" tone="info" msgs={thread.input} output={false} span={span} />
        ) : null}
        {thread.output.length ? (
          <Section title="Output" tone={outputTone} msgs={thread.output} output span={span} />
        ) : null}
      </div>
    </PaneTextMode.Provider>
  );
}
