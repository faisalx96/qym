/** The parts of an item pane: the titled block, Input / Expected / Output, a named section, item metadata, execution facts, the pass switch. */
import { useState, type ReactNode } from 'react';
import { Icon, SegmentedControl, StatStrip, Subsection, TextBlock } from '@/ui';
import type { Row } from '../../../types';
import { MetricAnalysisCards } from '../../analysis/MetricAnalysisCards';
import { Act, CopyTile } from './actions';
import { bodyText, latencyLabel, type ItemData, type ItemPass } from './model';
import { DiffToggle, FieldList, JsonToggle, Value, isStructuredValue } from './values';
import s from './pane.module.css';

/** Expected is gold: green belongs to an output that passed. */
export type BlockTone = 'info' | 'success' | 'danger' | 'gold' | 'neutral';

/** One titled part of the pane: an inset fill, the meaning of the part on a 3px start rail. */
export function Block({
  title,
  tone = 'neutral',
  after,
  actions,
  label,
  fill,
  part,
  children,
}: {
  /** The name of the part. Text, or (the output of one run among several) the run it belongs to. */
  title: ReactNode;
  tone?: BlockTone;
  /** Right after the title: the pass switch, a short fact. */
  after?: ReactNode;
  actions?: ReactNode;
  label?: string;
  /** The block takes the free height of its row (two blocks side by side end on one line). */
  fill?: boolean;
  part?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={s.block}
      data-tone={tone}
      data-fill={fill ? '' : undefined}
      data-part={part}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
    >
      <header className={s.blockHead}>
        <h4 className={s.eyebrow}>{title}</h4>
        {after ? <span className={s.blockAfter}>{after}</span> : null}
        {actions ? <span className={s.blockActions}>{actions}</span> : null}
      </header>
      <div className={s.blockBody}>{children}</div>
    </section>
  );
}

/**
 * A named part of the pane under the texts (Metrics, Execution, Metadata, Root cause): the page's own subsection head
 * (the accent bar and the title), then the content.
 */
export function PaneSection({
  title,
  description,
  aside,
  part,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  part?: string;
  children: ReactNode;
}) {
  return (
    <div className={s.section} data-part={part}>
      <Subsection title={title} description={description} aside={aside}>
        {children}
      </Subsection>
    </div>
  );
}

/* ---------- Input, Expected, Output ---------- */

export function InputBlock({ item }: { item: ItemData }) {
  const [raw, setRaw] = useState(false);
  return (
    <Block
      title="Input"
      tone="info"
      part="input"
      actions={
        <>
          {isStructuredValue(item.rawInput) ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
          <CopyTile text={bodyText(item.rawInput)} label="Copy input" />
        </>
      }
    >
      <Value value={item.rawInput} label="Input" raw={raw} />
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
}: {
  row: Row;
  item: ItemData;
  /** The pass in view: the words of Expected that its output does not have are marked. */
  pass: ItemPass;
  fill?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  if (!item.hasExpected) return null;
  return (
    <Block
      title="Expected"
      tone="gold"
      part="expected"
      fill={fill}
      actions={
        <>
          {isStructuredValue(item.rawExpected) ? <JsonToggle raw={raw} onChange={setRaw} /> : null}
          <CopyTile text={bodyText(item.rawExpected)} label="Copy expected output" />
        </>
      }
    >
      <Value
        value={item.rawExpected}
        label="Expected output"
        other={outputOf(row, pass)}
        side="before"
        raw={raw}
      />
    </Block>
  );
}

export function OutputBlock({
  row,
  item,
  pass,
  onFocus,
  fill,
}: {
  row: Row;
  item: ItemData;
  pass: ItemPass;
  onFocus: (pass: number) => void;
  fill?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  const sc = pass.scoped;
  const bad = pass.kind === 'fail' || pass.kind === 'error';
  const good = pass.kind === 'pass';
  const value = outputOf(row, pass);
  const errorText = String(sc.error || sc.__execution_error || 'The task failed');
  const retries = Number(sc.retry_count ?? 0);
  return (
    <Block
      title="Output"
      tone={bad ? 'danger' : good ? 'success' : 'neutral'}
      part="output"
      fill={fill}
      label={item.multi ? `Output of pass ${pass.pass}` : 'Output'}
      after={
        item.multi ? (
          <>
            <PassSwitch item={item} focus={pass.pass} onFocus={onFocus} />
            {sc.latency_ms != null ? <span className={s.metaNum}>{latencyLabel(sc.latency_ms)}</span> : null}
          </>
        ) : undefined
      }
      actions={
        <>
          {item.hasExpected && value !== undefined ? <DiffToggle /> : null}
          {value !== undefined && isStructuredValue(value) ? (
            <JsonToggle raw={raw} onChange={setRaw} />
          ) : null}
          <CopyTile
            text={pass.taskError ? errorText : bodyText(value)}
            label={item.multi ? `Copy the output of pass ${pass.pass}` : 'Copy output'}
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
        />
      )}
    </Block>
  );
}

/* ---------- item metadata and execution facts ---------- */

/** The item's own metadata, in the fields recipe of a JSON value. */
export function MetadataBlock({ item }: { item: ItemData }) {
  if (!Object.keys(item.metadata).length) return null;
  return (
    <PaneSection title="Metadata" part="metadata">
      <div className={s.block} data-tone="neutral">
        <div className={s.blockBody} data-top="">
          <FieldList data={item.metadata} label="Item metadata" />
        </div>
      </div>
    </PaneSection>
  );
}

/** Latency, tokens, cost and calls: the platform's stat strip. */
export function ExecutionBlock({ item }: { item: ItemData }) {
  if (!item.facts.length) return null;
  return (
    <PaneSection title="Execution" part="execution">
      <div className={s.stats}>
        <StatStrip
          variant="compact"
          aria-label="Execution"
          items={item.facts.map((f) => ({
            key: f.key,
            label: f.label,
            value: f.value,
            tone: f.bad ? ('danger' as const) : undefined,
          }))}
        />
      </div>
    </PaneSection>
  );
}

/* ---------- passes ---------- */

/** The one control that picks the pass in view; a pass has no colour of its own, the glyph is its verdict. */
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
  const n = item.passes.length;
  if (n > 6) {
    const at = item.passes.findIndex((p) => p.pass === focus);
    return (
      <span className={s.passStep}>
        <Act
          label="Previous pass"
          icon="chevron-left"
          isDisabled={at <= 0}
          onPress={() => onFocus(item.passes[at - 1]!.pass)}
        />
        <span className={s.passName}>
          Pass {focus} of {n}
        </span>
        <Act
          label="Next pass"
          icon="chevron-right"
          isDisabled={at >= n - 1}
          onPress={() => onFocus(item.passes[at + 1]!.pass)}
        />
      </span>
    );
  }
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
            <span className={s.passGlyph} data-kind={p.kind} aria-hidden="true">
              <Icon name={p.kind === 'pass' ? 'check' : 'close'} size={12} />
            </span>
          </span>
        ),
      }))}
    />
  );
}

/* ---------- root cause ---------- */

export function RootCause({ row }: { row: Row }) {
  return (
    <div className={s.rootCause}>
      <MetricAnalysisCards row={row} />
    </div>
  );
}
