import { useId, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { Collapse } from '../Collapse';
import { CopyButton } from '../CopyButton';
import { Icon } from '../Icon';
import { JsonTree } from '../JsonViewer';
import { SegmentedControl } from '../SegmentedControl';
import { Tag } from '../Tag';
import { TextBlock } from '../TextBlock';
import type { TextMode } from '@/lib/text';
import { ClampedText } from './ClampedText';
import {
  classifySection,
  copyValue,
  entriesOf,
  isUniformObjectArray,
  parseStructured,
  scalarText,
  sectionSummary,
  startsOpen,
  tableColumns,
} from './structured';
import { useJsonView, type JsonView } from './useJsonView';
import styles from './StructuredValue.module.css';

export interface StructuredValueProps {
  /** object | array | JSON string | plain string. */
  value: unknown;
  /** Names the region for assistive tech ("Output, pass 2"). */
  label?: string;
  /** Rendering of string leaves. */
  textMode?: TextMode;
  /** `auto`: the first 6 keys, strings up to 600 characters. */
  defaultOpen?: 'auto' | 'all' | 'none';
  /** Controlled view; default is the stored preference (`localStorage qym:json-view`). */
  view?: JsonView;
  onViewChange?: (v: JsonView) => void;
  /** Hide the Sections | Raw / expand / copy toolbar (the parent supplies its own). */
  toolbar?: boolean;
  /** Lines before a text leaf clamps (default 12). */
  lines?: number;
  className?: string;
}

const TABLE_LIMIT = 50;

function Scalar({ value }: { value: unknown }) {
  const kind = value === null ? 'null' : typeof value;
  return (
    <span className={styles.scalar} data-kind={kind}>
      {scalarText(value)}
    </span>
  );
}

function TableBody({ rows }: { rows: Record<string, unknown>[] }) {
  const [all, setAll] = useState(false);
  const cols = useMemo(() => tableColumns(rows), [rows]);
  const shown = all ? rows : rows.slice(0, TABLE_LIMIT);
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} scope="col" dir="ltr">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} dir="auto" data-kind={typeof r[c] === 'number' ? 'number' : undefined}>
                    {r[c] === undefined ? '' : scalarText(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_LIMIT && !all ? (
        <Button size="sm" variant="ghost" onPress={() => setAll(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </div>
  );
}

function SectionBody({ value, textMode, lines }: { value: unknown; textMode?: TextMode; lines: number }) {
  const kind = classifySection(value);
  if (kind === 'string') return <ClampedText text={value as string} mode={textMode} lines={lines} />;
  if (kind === 'scalars') {
    return (
      <div className={styles.chips}>
        {(value as unknown[]).map((v, i) => (
          <Tag key={i} kind="data" dir="auto">
            {scalarText(v)}
          </Tag>
        ))}
      </div>
    );
  }
  if (kind === 'table' && isUniformObjectArray(value)) return <TableBody rows={value} />;
  return <JsonTree data={value} expandDepth={1} label="Value" toolbar={false} />;
}

interface SectionProps {
  id: string;
  name: string;
  value: unknown;
  open: boolean;
  onToggle: () => void;
  textMode?: TextMode;
  lines: number;
}

function Section({ id, name, value, open, onToggle, textMode, lines }: SectionProps) {
  const kind = classifySection(value);
  const summary = sectionSummary(value);
  const bodyId = `${id}-body`;
  if (kind === 'scalar') {
    return (
      <div className={styles.section} id={id} data-kind="scalar" role="group" aria-label={name}>
        <div className={styles.head}>
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.key} dir="ltr">
            {name}
          </span>
          <Scalar value={value} />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.section} id={id} data-kind={kind} data-open={open} role="group" aria-label={name}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <Icon name="chevron-right" size={12} className={styles.chevron} />
          <span className={styles.key} dir="ltr">
            {name}
          </span>
          {summary ? <span className={styles.summary}>{summary}</span> : null}
        </button>
        <CopyButton text={() => copyValue(value)} label={`Copy ${name}`} className={styles.copy} />
      </div>
      <Collapse open={open} id={bodyId}>
        <div className={styles.body}>
          <SectionBody value={value} textMode={textMode} lines={lines} />
        </div>
      </Collapse>
    </div>
  );
}

/**
 * Structured value recipe: an object, array or JSON string becomes one hairline-separated section per top-level
 * key (collapsible, copyable, typed body: text, chips, table, tree), with a Sections | Raw switch, expand/collapse
 * all, copy and a key index for more than four keys. Plain strings and scalars fall back to a TextBlock.
 */
export function StructuredValue({
  value,
  label,
  textMode,
  defaultOpen = 'auto',
  view: viewProp,
  onViewChange,
  toolbar = true,
  lines = 12,
  className,
}: StructuredValueProps) {
  const uid = useId();
  const parsed = useMemo(() => parseStructured(value), [value]);
  const [stored, setStored] = useJsonView();
  const view = viewProp ?? stored;
  const entries = useMemo(() => (parsed.structured ? entriesOf(parsed.data) : []), [parsed]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);

  if (!parsed.structured) {
    return parsed.text ? (
      <ClampedText text={parsed.text} mode={textMode} lines={lines} />
    ) : (
      <TextBlock text="" mode={textMode} />
    );
  }
  const isOpen = (i: number, k: string, v: unknown) => overrides[k] ?? startsOpen(i, v, defaultOpen);
  const anyOpen = entries.some((e, i) => classifySection(e.value) !== 'scalar' && isOpen(i, e.key, e.value));
  const setAll = (open: boolean) =>
    setOverrides(Object.fromEntries(entries.map((e) => [e.key, open] as const)));
  const setView = (v: JsonView) => {
    setStored(v);
    onViewChange?.(v);
  };
  const jump = (key: string, index: number) => {
    setOverrides((o) => ({ ...o, [key]: true }));
    const target = root.current?.querySelector<HTMLElement>(`[id="${uid}-${index}"]`);
    requestAnimationFrame(() => target?.scrollIntoView({ block: 'nearest' }));
  };
  const json = copyValue(parsed.data);
  return (
    <div
      ref={root}
      className={[styles.root, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label ?? 'Structured value'}
      data-view={view}
    >
      {toolbar ? (
        <div className={styles.toolbar}>
          <SegmentedControl<JsonView>
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'sections', label: 'Sections' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
          <span className={styles.spacer} />
          {view === 'sections' ? (
            <Button size="sm" variant="ghost" onPress={() => setAll(!anyOpen)}>
              {anyOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          ) : null}
          <CopyButton text={json} label="Copy JSON" />
        </div>
      ) : null}
      {view === 'raw' ? (
        <TextBlock text={json} code />
      ) : (
        <>
          {entries.length > 4 ? (
            <nav className={styles.index} aria-label="Keys">
              {entries.map((e, i) => (
                <Button
                  key={e.key}
                  size="sm"
                  variant="ghost"
                  aria-label={`Go to ${e.key}`}
                  onPress={() => jump(e.key, i)}
                >
                  {e.key}
                </Button>
              ))}
            </nav>
          ) : null}
          <div className={styles.sections}>
            {entries.map((e, i) => (
              <Section
                key={e.key}
                id={`${uid}-${i}`}
                name={e.key}
                value={e.value}
                open={isOpen(i, e.key, e.value)}
                onToggle={() => setOverrides((o) => ({ ...o, [e.key]: !isOpen(i, e.key, e.value) }))}
                textMode={textMode}
                lines={lines}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
