import { useId, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { Collapse } from '../Collapse';
import { DataTable, type Column } from '../DataTable';
import { CopyButton } from '../CopyButton';
import { Icon } from '../Icon';
import { JsonTree } from '../JsonViewer';
import { SegmentedControl } from '../SegmentedControl';
import { Tag } from '../Tag';
import { TextBlock } from '../TextBlock';
import { type TextMode } from '@/lib/text';
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
import { KeyTree } from './KeyTree';
import { allPaths } from './keyTree';
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
  /**
   * `sections` (default): one section per top-level key. `keys`: collapsed key rows with previews, recursive
   * Expand all / Collapse all and depth guides (round 3 P5); nothing is open unless `defaultExpanded`.
   */
  variant?: 'sections' | 'keys';
  defaultExpanded?: boolean;
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

interface TableRow {
  i: number;
  values: Record<string, unknown>;
}

function TableBody({ rows, label }: { rows: Record<string, unknown>[]; label: string }) {
  const [all, setAll] = useState(false);
  const cols = useMemo(() => tableColumns(rows), [rows]);
  const data = useMemo<TableRow[]>(() => rows.map((values, i) => ({ i, values })), [rows]);
  const shown = all ? data : data.slice(0, TABLE_LIMIT);
  const columns = useMemo<Column<TableRow>[]>(
    () =>
      cols.map((c, ci) => ({
        id: c,
        header: c,
        label: c,
        type: rows.some((r) => typeof r[c] === 'number') ? 'number' : 'text',
        accessor: (r) => r.values[c],
        flex: ci === 0,
        minWidth: 48,
        width: ci === 0 ? undefined : 72,
        priority: ci === 0 ? 1 : 2,
        cardTitle: ci === 0,
        cell: (r) => <span dir="auto">{r.values[c] === undefined ? '' : scalarText(r.values[c])}</span>,
      })),
    [cols, rows],
  );
  return (
    <div className={styles.tableWrap}>
      <DataTable<TableRow>
        aria-label={label}
        columns={columns}
        rows={shown}
        rowKey={(r) => r.i}
        density="compact"
        densityLocked
        columnMenu={false}
        zebra={false}
        variant="embedded"
        stickyHeader={false}
      />
      {rows.length > TABLE_LIMIT && !all ? (
        <Button size="sm" variant="ghost" onPress={() => setAll(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </div>
  );
}

function SectionBody({
  value,
  label,
  textMode,
  lines,
}: {
  value: unknown;
  label: string;
  textMode?: TextMode;
  lines: number;
}) {
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
  if (kind === 'table' && isUniformObjectArray(value)) return <TableBody rows={value} label={label} />;
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
          <SectionBody value={value} label={name} textMode={textMode} lines={lines} />
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
  variant = 'sections',
  defaultExpanded = false,
}: StructuredValueProps) {
  const uid = useId();
  const parsed = useMemo(() => parseStructured(value), [value]);
  const [stored, setStored] = useJsonView();
  const view = viewProp ?? stored;
  const entries = useMemo(() => (parsed.structured ? entriesOf(parsed.data) : []), [parsed]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const [openKeys, setOpenKeys] = useState<Set<string> | null>(null);

  if (!parsed.structured) {
    return parsed.text ? (
      <ClampedText text={parsed.text} mode={textMode} lines={lines} />
    ) : (
      <TextBlock text="" mode={textMode} />
    );
  }
  if (variant === 'keys') {
    const open = openKeys ?? (defaultExpanded ? new Set(allPaths(parsed.data, uid)) : new Set<string>());
    return (
      <div className={[styles.root, className].filter(Boolean).join(' ')} data-variant="keys">
        {toolbar ? (
          <div className={styles.toolbar}>
            <span className={styles.spacer} />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Expand all keys"
              onPress={() => setOpenKeys(new Set(allPaths(parsed.data, uid)))}
            >
              Expand all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Collapse all keys"
              onPress={() => setOpenKeys(new Set())}
            >
              Collapse all
            </Button>
          </div>
        ) : null}
        <KeyTree
          value={parsed.data}
          idPrefix={uid}
          open={open}
          onOpenChange={setOpenKeys}
          textMode={textMode}
        />
      </div>
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
