/** The parts of an item pane: the titled block, Input / Expected / the Output row, a named section, item metadata, execution facts, the passes in view. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Eyebrow,
  Icon,
  InlineNotice,
  SegmentedControl,
  StatStrip,
  StateTag,
  Subsection,
  TextBlock,
  ToggleChips,
} from '@/ui';
import type { Row } from '../../../types';
import { verdictTone } from '../../../lib/verdictMark';
import { MetricAnalysisCards } from '../../analysis/MetricAnalysisCards';
import { withFactIcons } from '../../traces/factIcons';
import { Act, CopyAct } from './actions';
import {
  OPEN_PASSES,
  analysisWarnings,
  bodyText,
  latencyLabel,
  passReplacedBy,
  pickPass,
  restrictedReason,
  type ItemData,
  type ItemPass,
} from './model';
import { usePartOpen } from './prefs';
import {
  DiffToggle,
  FieldList,
  FoldActs,
  JsonToggle,
  PaneFold,
  Value,
  isStructuredValue,
  useValueFold,
} from './values';
import s from './pane.module.css';

/** Expected is gold: green belongs to an output that passed. */
export type BlockTone = 'info' | 'success' | 'danger' | 'gold' | 'neutral';

/** The arrow of a part that opens and closes; it leads the title (a button never ends with an arrow). */
function Arrow({ open }: { open: boolean }) {
  return (
    <span className={s.arrow} aria-hidden="true">
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    </span>
  );
}

/**
 * How high a text body grows before it scrolls, by part (`CAPS`): a share of the viewport, so a
 * tall screen shows more, with a floor for a short one. Input is read once (25vh), Expected is the reference (30vh),
 * an Output is what the reader came for (45vh). On a laptop screen the whole box of an output, its scrollbar and its
 * bottom edge stay on the screen under the head of the pane, so the reader sees that it scrolls.
 */
export type CapKind = 'input' | 'expected' | 'output';

const CAPS: Record<CapKind, string> = {
  input: 'max(160px, 25vh)',
  expected: 'max(160px, 30vh)',
  output: 'max(240px, 45vh)',
};

/**
 * The body of a text block: as tall as its value up to the cap of its part, then it scrolls inside the block (the
 * platform scrollbar; the keyboard too: the scrolling body takes the focus and is a named region). No button lifts the
 * cap (feedback round 2: "instead of show full height i prefer scrollable containers"). A value never stretches its
 * neighbour.
 */
function CappedBody({ label, kind, children }: { label: string; kind: CapKind; children: ReactNode }) {
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
    // a scrolling region takes the focus, so the keyboard can scroll it (WCAG 2.1.1)
    <div
      ref={ref}
      className={s.blockBody}
      data-cap={kind}
      style={{ maxBlockSize: CAPS[kind] }}
      data-scrolls={over ? '' : undefined}
      role={over ? 'region' : undefined}
      aria-label={over ? `${label}, scrolls` : undefined}
      tabIndex={over ? 0 : undefined}
    >
      {/* the block scrolls: a long text shows in full inside it, with no "Show more" of its own */}
      <PaneFold.Provider value={false}>{children}</PaneFold.Provider>
    </div>
  );
}

/** One titled part of the pane: an inset fill, the meaning of the part on a 3px start rail. */
export function Block({
  title,
  tone = 'neutral',
  after,
  actions,
  label,
  fill,
  part,
  busy,
  collapsible,
  defaultOpen = true,
  cap,
  children,
}: {
  /** The name of the part. Text, or (the output of one run among several) the run it belongs to. */
  title: ReactNode;
  tone?: BlockTone;
  /** Right after the title: the pass and its result, a short fact. */
  after?: ReactNode;
  actions?: ReactNode;
  label?: string;
  /** The block takes the free height of its row (two blocks side by side end on one line). */
  fill?: boolean;
  part?: string;
  /** The loading frame: the block is there, its value is not yet. */
  busy?: boolean;
  /** The title opens and closes the block; the choice is kept for the session, for every item (by `part`). */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** The body grows up to the cap of its part, then scrolls (a text that can be very long: Input, Expected, Output). */
  cap?: CapKind;
  children: ReactNode;
}) {
  const bodyId = useId();
  const [stored, setOpen] = usePartOpen(part ?? 'block', defaultOpen);
  const open = !collapsible || stored;
  const name = label ?? (typeof title === 'string' ? title : 'Block');
  const heading = typeof title === 'string' ? <Eyebrow className={s.eyebrow}>{title}</Eyebrow> : title;
  return (
    <section
      className={s.block}
      data-tone={tone}
      data-fill={fill ? '' : undefined}
      data-part={part}
      data-closed={open ? undefined : ''}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      aria-busy={busy || undefined}
    >
      <header className={s.blockHead}>
        {/* a fixed UI label is the platform Eyebrow; a name (the run of an output) is shown as written */}
        <h4 className={s.blockTitle}>
          {collapsible ? (
            <button
              type="button"
              className={s.partToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen(!open)}
            >
              <Arrow open={open} />
              {heading}
            </button>
          ) : (
            heading
          )}
        </h4>
        {after ? <span className={s.blockAfter}>{after}</span> : null}
        {actions && open ? <span className={s.blockActions}>{actions}</span> : null}
      </header>
      <div id={bodyId} className={s.blockFrame} hidden={!open}>
        {!open ? null : cap ? (
          <CappedBody label={name} kind={cap}>
            {children}
          </CappedBody>
        ) : (
          <div className={s.blockBody}>{children}</div>
        )}
      </div>
    </section>
  );
}

/**
 * A named part of the pane under the texts (Metrics, Execution, Metadata, Root cause): the page's own subsection head
 * (the accent bar and the title), then the content. A collapsible section has its title as the button that opens it.
 */
export function PaneSection({
  title,
  description,
  aside,
  part,
  collapsible,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  part?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const bodyId = useId();
  const [stored, setOpen] = usePartOpen(part ?? title, defaultOpen);
  const open = !collapsible || stored;
  return (
    <div className={s.section} data-part={part} data-closed={open ? undefined : ''}>
      <Subsection
        size="compact"
        title={
          collapsible ? (
            <button
              type="button"
              className={s.partToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen(!open)}
            >
              <Arrow open={open} />
              {title}
            </button>
          ) : (
            title
          )
        }
        description={description}
        aside={open ? aside : undefined}
      >
        <div id={bodyId} hidden={!open} className={s.sectionBody}>
          {open ? children : null}
        </div>
      </Subsection>
    </div>
  );
}

/* ---------- Input, Expected, Output ---------- */

export function InputBlock({ item }: { item: ItemData }) {
  const [raw, setRaw] = useState(false);
  const fold = useValueFold(item.rawInput);
  return (
    <Block
      title="Input"
      tone="info"
      part="input"
      collapsible
      cap="input"
      actions={
        <>
          <FoldActs fold={fold} raw={raw} />
          {isStructuredValue(item.rawInput) ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
          <CopyAct text={bodyText(item.rawInput)} label="Copy input" />
        </>
      }
    >
      <Value value={item.rawInput} label="Input" raw={raw} fold={fold} />
    </Block>
  );
}

/** The output of a pass, or undefined when the pass gave none (the Expected block then shows no difference marks). */
function outputOf(row: Row, pass: ItemPass): unknown {
  if (pass.taskError || row.output_received === false) return undefined;
  return pass.scoped.output_full ?? pass.scoped.output ?? undefined;
}

export function ExpectedBlock({
  row,
  item,
  pass,
  fill,
  against,
}: {
  row: Row;
  item: ItemData;
  /** The pass whose output Expected is read against: the words of Expected that its output does not have are marked. */
  pass: ItemPass;
  fill?: boolean;
  /** Several outputs are in view: name the one the marks are read against. */
  against?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  const fold = useValueFold(item.rawExpected);
  if (!item.hasExpected) return null;
  return (
    <Block
      title="Expected"
      tone="gold"
      part="expected"
      fill={fill}
      collapsible
      cap="expected"
      after={against ? <span className={s.blockNote}>Marks against pass {pass.pass}</span> : undefined}
      actions={
        <>
          <FoldActs fold={fold} raw={raw} />
          {isStructuredValue(item.rawExpected) ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
          <CopyAct text={bodyText(item.rawExpected)} label="Copy expected output" />
        </>
      }
    >
      <Value
        value={item.rawExpected}
        label="Expected output"
        other={outputOf(row, pass)}
        side="before"
        raw={raw}
        fold={fold}
      />
    </Block>
  );
}

/**
 * The output of a pass. On its own (a single-pass item) it is titled "Output" like Input and Expected. In the Output
 * row of a multi-pass item the row says "Output" once, so the block is headed by its pass: "Pass N", the verdict, the
 * latency, then its actions (feedback round 2: the repeated "Output" gave the head controls no room).
 */
/** The tone of the output of one pass: its result (no result: neutral, its label then reads bright). */
export function outputTone(pass: ItemPass): BlockTone {
  if (pass.kind === 'fail' || pass.kind === 'error') return 'danger';
  return pass.kind === 'pass' ? 'success' : 'neutral';
}

export function OutputBlock({
  row,
  item,
  pass,
  onTrace,
  fill,
}: {
  row: Row;
  item: ItemData;
  pass: ItemPass;
  /** Open the trace of this pass (a multi-pass item: each output in view has its own). */
  onTrace?: () => void;
  fill?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  const sc = pass.scoped;
  const value = outputOf(row, pass);
  const fold = useValueFold(value);
  const errorText = String(sc.error || sc.__execution_error || 'The task failed');
  const retries = Number(sc.retry_count ?? 0);
  const multi = item.multi;
  return (
    <Block
      title={multi ? <span className={s.passName}>Pass {pass.pass}</span> : 'Output'}
      tone={outputTone(pass)}
      part="output"
      fill={fill}
      // in the Output row the row opens and closes; a block of its own does it from its title
      collapsible={!multi}
      cap="output"
      label={multi ? `Output of pass ${pass.pass}` : 'Output'}
      after={
        multi ? (
          // the head of a column: its result and its time after the pass
          <>
            <StateTag tone={verdictTone(pass.kind)}>{pass.label}</StateTag>
            {sc.latency_ms != null ? <span className={s.metaNum}>{latencyLabel(sc.latency_ms)}</span> : null}
          </>
        ) : undefined
      }
      actions={
        <>
          {item.hasExpected && value !== undefined ? <DiffToggle /> : null}
          {row.output_received === false || pass.taskError ? null : <FoldActs fold={fold} raw={raw} />}
          {value !== undefined && isStructuredValue(value) ? (
            <JsonToggle raw={raw} onChange={setRaw} />
          ) : null}
          {onTrace ? (
            <Act
              label={`Open the trace of pass ${pass.pass}`}
              icon="trace"
              isDisabled={!sc.trace_id}
              disabledReason="No trace was recorded for this pass"
              onPress={onTrace}
            />
          ) : null}
          <CopyAct
            text={pass.taskError ? errorText : bodyText(value)}
            label={multi ? `Copy the output of pass ${pass.pass}` : 'Copy output'}
          />
        </>
      }
    >
      {row.output_received === false ? (
        <p className={s.note}>Output not received: the outcome of this item never reached the platform</p>
      ) : pass.taskError ? (
        <div className={s.taskError} role="note">
          <p className={s.taskErrorLead}>
            <Icon name="warning" size={12} />
            The task failed before it gave an output
            {retries > 0 ? ` (${retries} ${retries === 1 ? 'retry' : 'retries'})` : ''}
          </p>
          <TextBlock text={errorText} code dir="ltr" className={s.errorText} />
        </div>
      ) : (
        <Value
          value={value}
          label="Output"
          other={item.hasExpected ? item.rawExpected : undefined}
          side="after"
          raw={raw}
          fold={fold}
        />
      )}
    </Block>
  );
}

/**
 * The Output row (feedback round 2): the outputs in view side by side under one head that says "Output" once and holds
 * the controls of the row (the passes in view on the run page; the runs in view and the difference marks on the compare
 * page). One output takes the full width; columns that no longer fit go to the next line. Shared with the compare pane.
 */
export function OutputRow({
  title = 'Output',
  tone,
  collapsible,
  controls,
  count,
  gridClassName,
  children,
}: {
  title?: string;
  /** The tone of the title: the result of the one output in view. Several in view have no single tone: it reads bright. */
  tone?: BlockTone;
  /** The title opens and closes the row; kept for the session with the Output block of a single-pass item. */
  collapsible?: boolean;
  /** The row's own controls, after the title. */
  controls?: ReactNode;
  /** The outputs in the row. */
  count: number;
  /** The grid of the outputs, when a host lays them out its own way (the compare pane). */
  gridClassName?: string;
  children: ReactNode;
}) {
  const headId = useId();
  const bodyId = useId();
  const [stored, setOpen] = usePartOpen('output', true);
  const open = !collapsible || stored;
  const heading = <Eyebrow className={s.eyebrow}>{title}</Eyebrow>;
  return (
    <section
      className={s.outRow}
      data-part="output-row"
      data-tone={tone}
      data-closed={open ? undefined : ''}
      aria-labelledby={headId}
    >
      <header className={s.outRowHead}>
        <h4 id={headId} className={s.blockTitle}>
          {collapsible ? (
            <button
              type="button"
              className={s.partToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen(!open)}
            >
              <Arrow open={open} />
              {heading}
            </button>
          ) : (
            heading
          )}
        </h4>
        {controls && open ? <div className={s.outRowControls}>{controls}</div> : null}
      </header>
      <div id={bodyId} className={gridClassName ?? s.outs} data-count={count} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

/**
 * The texts of the item, each on a row of its own (feedback round 2): Expected under Input, then the output. A
 * multi-pass item has the Output row: its head picks the passes in view (at most three), and each pass in view is a
 * column. Expected marks the words that the first output in view does not have, and says which pass that is.
 */
export function ItemTexts({
  row,
  item,
  open,
  order,
  onPick,
  onTrace,
}: {
  row: Row;
  item: ItemData;
  /** The passes in view, in pass order (one for a single-pass item). */
  open: number[];
  /** The same passes in the order they were picked. */
  order?: number[];
  onPick?: (passes: number[]) => void;
  onTrace?: (pass: number) => void;
}) {
  const passes = open.map((n) => item.passes.find((p) => p.pass === n)).filter((p): p is ItemPass => !!p);
  if (!passes.length) passes.push(item.passes[0]!);
  const expected = item.hasExpected ? (
    <ExpectedBlock row={row} item={item} pass={passes[0]!} against={item.multi && passes.length > 1} />
  ) : null;
  if (!item.multi)
    return (
      <>
        {expected}
        <OutputBlock row={row} item={item} pass={passes[0]!} />
      </>
    );
  return (
    <>
      {expected}
      <OutputRow
        collapsible
        tone={passes.length === 1 ? outputTone(passes[0]!) : undefined}
        count={passes.length}
        controls={
          onPick ? <PassToggles item={item} open={open} order={order ?? open} onChange={onPick} /> : undefined
        }
      >
        {passes.map((p) => (
          <OutputBlock
            key={p.pass}
            row={row}
            item={item}
            pass={p}
            onTrace={onTrace ? () => onTrace(p.pass) : undefined}
          />
        ))}
      </OutputRow>
    </>
  );
}

/* ---------- item metadata and execution facts ---------- */

/** The item's own metadata, in the fields recipe of a JSON value. Closed at first: it is read less than the rest. */
export function MetadataBlock({ item }: { item: ItemData }) {
  if (!Object.keys(item.metadata).length) return null;
  const count = Object.keys(item.metadata).length;
  return (
    <PaneSection
      title="Metadata"
      part="metadata"
      collapsible
      defaultOpen={false}
      description={count === 1 ? '1 field' : `${count} fields`}
    >
      <div className={s.block} data-tone="neutral">
        <div className={s.blockBody} data-top="">
          <FieldList data={item.metadata} label="Item metadata" />
        </div>
      </div>
    </PaneSection>
  );
}

/** Latency, tokens, cost and calls: the platform's stat strip with the trace view's glyphs (as the trace drawer). */
export function ExecutionBlock({ item }: { item: ItemData }) {
  if (!item.facts.length) return null;
  return (
    <PaneSection title="Execution" part="execution" collapsible>
      <div className={s.stats}>
        <StatStrip
          variant="compact"
          aria-label="Execution"
          items={withFactIcons(
            item.facts.map((f) => ({
              key: f.key,
              label: f.label,
              value: f.value,
              tone: f.bad ? ('danger' as const) : undefined,
            })),
          )}
        />
      </div>
    </PaneSection>
  );
}

/* ---------- passes ---------- */

/** The verdict of a pass as a glyph, named for a screen reader (a pass has no colour of its own). */
export function PassGlyph({ pass }: { pass: ItemPass }) {
  return (
    <span className={s.passGlyph} data-kind={pass.kind} role="img" aria-label={pass.label}>
      <Icon name={pass.kind === 'pass' ? 'check' : 'close'} size={12} />
    </span>
  );
}

/** The tone of a pass chip: the Pass green, the Fail red (a task error too); none for a pass with no verdict yet. */
function passTone(p: ItemPass): 'success' | 'danger' | undefined {
  if (p.kind === 'pass') return 'success';
  return p.kind === 'fail' || p.kind === 'error' ? 'danger' : undefined;
}

/**
 * The passes in view of a multi-pass item, in the head of the Output row: one toggle chip per pass (its verdict glyph
 * in the label, no check box, no edge: an on chip takes the soft wash and the text colour of its verdict, green for a
 * passed pass and red for a failed one), at least one and at most three on. A fourth
 * pick replaces the pass picked earliest, and the chip's hint names it before the press. With more than three passes,
 * a muted hint says the rule and one shortcut puts the passes that did not pass in view (the first three of them).
 */
export function PassToggles({
  item,
  open,
  order,
  onChange,
}: {
  item: ItemData;
  /** The passes in view, in pass order. */
  open: number[];
  /** The same passes in the order they were picked (the oldest first). */
  order: number[];
  /** The next passes in view, in pick order. */
  onChange: (passes: number[]) => void;
}) {
  if (!item.multi) return null;
  const many = item.passes.length > OPEN_PASSES;
  const bad = item.passes.filter((p) => p.kind !== 'pass').map((p) => p.pass);
  const badView = bad.slice(0, OPEN_PASSES);
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return (
    <>
      <ToggleChips
        aria-label="Passes in view"
        size="sm"
        variant="plain"
        min={1}
        value={open.map(String)}
        onChange={(next) => {
          const on = next.map(Number);
          const added = on.find((n) => !open.includes(n));
          const removed = open.find((n) => !on.includes(n));
          if (added !== undefined) onChange(pickPass(order, added, true));
          else if (removed !== undefined) onChange(pickPass(order, removed, false));
        }}
        options={item.passes.map((p) => {
          const out = passReplacedBy(order, p.pass);
          return {
            value: String(p.pass),
            label: (
              <span className={s.passOpt}>
                Pass {p.pass}
                <PassGlyph pass={p} />
              </span>
            ),
            title: out !== undefined ? `Show pass ${p.pass} in place of pass ${out}` : undefined,
            // round 3: an on chip takes the colour of its verdict (the Pass green, the Fail red), no edge
            tone: passTone(p),
          };
        })}
      />
      {many ? <span className={s.passHint}>Up to {OPEN_PASSES} at a time</span> : null}
      {many && bad.length && bad.length < item.passes.length ? (
        <span className={s.passShortcuts}>
          <Button
            size="sm"
            variant="neutral"
            isDisabled={same(open, badView)}
            onPress={() => onChange(badView)}
          >
            {bad.length > OPEN_PASSES ? `First ${OPEN_PASSES} not passed` : 'Not passed only'}
          </Button>
        </span>
      ) : null}
    </>
  );
}

/**
 * The old one-pass switch, kept for hosts that show one pass at a time; the item pane shows `PassToggles`.
 * @deprecated
 */
export function PassSwitch({
  item,
  focus,
  onFocus,
}: {
  item: ItemData;
  focus: number;
  onFocus: (pass: number) => void;
}) {
  if (!item.multi) return null;
  return (
    <SegmentedControl
      label="Pass in view"
      value={String(focus)}
      onChange={(v) => onFocus(Number(v))}
      options={item.passes.map((p) => ({
        value: String(p.pass),
        title: `Pass ${p.pass}: ${p.label}`,
        label: (
          <span className={s.passOpt}>
            Pass {p.pass}
            <PassGlyph pass={p} />
          </span>
        ),
      }))}
    />
  );
}

/* ---------- root cause ---------- */

/**
 * The root causes of the item. A multi-pass item reviews its causes per pass: one review for each pass in view, side by
 * side, each saved to its own pass (no links away to the pass views).
 */
export function RootCause({ row, item, open }: { row: Row; item?: ItemData; open?: number[] }) {
  const warnings = analysisWarnings(row);
  const passes =
    item?.multi && open?.length
      ? open.map((n) => item.passes.find((p) => p.pass === n)).filter((p): p is ItemPass => !!p)
      : null;
  return (
    <div className={s.rootCause}>
      {warnings.length ? (
        // what the analysis could not do for this item: one notice line (§3.7 "Inline notice")
        <InlineNotice
          tone="warning"
          lead={/taxonom/i.test(warnings.join('; ')) ? 'No taxonomy.' : 'Analysis warning.'}
          data-testid="analysis-warning"
        >
          {warnings.join('; ')}
        </InlineNotice>
      ) : null}
      {passes ? (
        <div className={s.passCols} data-part="root-cause-passes">
          {passes.map((p) => (
            <div key={p.pass} className={s.passCol}>
              <MetricAnalysisCards row={p.scoped} pass={p.pass} />
            </div>
          ))}
        </div>
      ) : (
        <MetricAnalysisCards row={row} />
      )}
    </div>
  );
}

/** The texts of the item are hidden from this reader: the neutral lock notice, in place of a silent empty block. */
export function RestrictedNote({ item }: { item: ItemData }) {
  if (!item.restricted) return null;
  return (
    <InlineNotice tone="neutral" icon="lock" data-testid="run-item-redacted">
      {restrictedReason(item.run.items_restricted_reason)}
    </InlineNotice>
  );
}
