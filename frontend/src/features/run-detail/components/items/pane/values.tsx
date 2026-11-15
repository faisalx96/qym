/**
 * A recorded value in an item pane. Plain text is prose. A JSON value shows its structure: each key stands above its
 * value, short values share a line, a nested object is an indented group, a list of like objects is a table and a
 * query is a formatted code block. The raw JSON is one switch away (the app's Sections | Raw preference).
 * With `other` and `side`, the words that differ from the other value are marked (Expected against Output).
 */
import {
  Fragment,
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { diffSide, wordDiff } from '@/features/datasets/lib/wordDiff';
import { keyWithBreaks } from '@/lib/keyBreaks';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs, type TextMode } from '@/lib/text';
import { Button, DataTable, TextBlock, parseStructured, type Column, type SortState } from '@/ui';
import { TABLE_PAGE, TABLE_ROW_CAP, detectTable } from '../../../lib/metricTables';
import { Act } from './actions';
import { formatSql, jsonTokens, looksLikeSql, sqlWords } from './code';
import s from './pane.module.css';

export type Side = 'before' | 'after';
type Scalar = string | number | boolean | null;

const isScalar = (v: unknown): v is Scalar => v === null || typeof v !== 'object';
const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const CODE_KEY = /sql|query|code|script|regex/i;

/** Rendered or raw text, from the page that hosts the pane (the run page and the compare page each keep their own). */
export const PaneTextMode = createContext<TextMode | undefined>(undefined);

/* ---------- the difference marks preference (one for every pane) ---------- */

const DIFF_KEY = 'qym:item-pane:diff';
const diffSubs = new Set<() => void>();
let diffMemory: boolean | null = null;

export function useDiffMarks(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (f) => {
      diffSubs.add(f);
      return () => diffSubs.delete(f);
    },
    () => diffMemory ?? readLocal(DIFF_KEY) !== 'off',
  );
  const set = (next: boolean) => {
    diffMemory = next;
    writeLocal(DIFF_KEY, next ? null : 'off');
    diffSubs.forEach((f) => f());
  };
  return [on, set];
}

export function isStructuredValue(value: unknown): boolean {
  return parseStructured(value).structured;
}

/** Fields or raw JSON, for the one block the button is in. */
export function JsonToggle({ raw, onChange }: { raw: boolean; onChange: (raw: boolean) => void }) {
  return (
    <Act
      label={raw ? 'Show the fields' : 'Show the raw JSON'}
      icon="braces"
      active={raw}
      aria-pressed={raw}
      onPress={() => onChange(!raw)}
    />
  );
}

export function DiffToggle() {
  const [on, setOn] = useDiffMarks();
  return (
    <Act
      label={on ? 'Hide the difference marks' : 'Mark the words that differ from Expected'}
      icon="diff"
      active={on}
      aria-pressed={on}
      onPress={() => setOn(!on)}
    />
  );
}

/* ---------- difference marks ---------- */

interface Piece {
  text: string;
  mark: boolean;
}

/** This side of a word diff as runs of marked and plain text; null when nothing differs or nearly everything does. */
function pieces(text: string, other: string, side: Side): Piece[] | null {
  const ops = side === 'after' ? wordDiff(other, text) : wordDiff(text, other);
  if (!ops) return null;
  const kind = side === 'after' ? 'add' : 'del';
  const mine = diffSide(ops, side);
  if (!mine.some((o) => o.kind === kind && o.text.trim())) return null;
  // two texts with little in common: a mark on nearly every word says nothing (the same rule for both sides)
  const count = (k: string) => ops.filter((o) => o.kind === k && o.text.trim()).length;
  const same = count('same');
  if (!same || same / (same + Math.min(count('add'), count('del'))) < 0.34) return null;
  const out: Piece[] = [];
  mine.forEach((op, i) => {
    const blank = !op.text.trim();
    const mark = blank
      ? mine[i - 1]?.kind === kind && mine[i + 1]?.kind === kind && !op.text.includes('\n')
      : op.kind === kind;
    const last = out[out.length - 1];
    if (last && last.mark === mark) last.text += op.text;
    else out.push({ text: op.text, mark });
  });
  return out;
}

function useMarks(text: string, other: string | undefined, side: Side | undefined): Piece[] | null {
  const [on] = useDiffMarks();
  return useMemo(
    () => (on && side && other !== undefined && other !== text ? pieces(text, other, side) : null),
    [on, side, other, text],
  );
}

function Marked({ parts }: { parts: Piece[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className={s.mark}>
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/* ---------- a very long text folds ---------- */

/** Lines of a text or a code value in view before "Show more". */
export const FOLD_LINES = 40;

/** True when a text is longer than the fold: more lines, or more characters than the lines hold (the ClampedText rule). */
export function isLongText(text: string, lines = FOLD_LINES): boolean {
  return text.length > lines * 60 || text.split('\n').length > lines;
}

/**
 * The platform's fold of a long text (`ui/ClampedText`: the first lines, then a neutral "Show more" / "Show less"
 * button), for a value that is not one plain TextBlock (text with difference marks, code). A value up to the fold
 * shows in full: the reader opened the item to read it. A longer one must not make the pane endless.
 */
function Fold({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!isLongText(text)) return <>{children}</>;
  return (
    <div className={s.fold}>
      <div
        className={open ? undefined : s.folded}
        style={open ? undefined : ({ '--lines': FOLD_LINES } as CSSProperties)}
        data-folded={open ? undefined : ''}
      >
        {children}
      </div>
      <Button variant="neutral" size="sm" aria-expanded={open} onPress={() => setOpen(!open)}>
        {open ? 'Show less' : 'Show more'}
      </Button>
    </div>
  );
}

/* ---------- leaves ---------- */

export function Prose({ text, other, side }: { text: string; other?: string; side?: Side }) {
  const mode = useContext(PaneTextMode);
  const parts = useMarks(text, other, side);
  // right-to-left text starts at the right edge of its block
  const rtl = textDirAttrs(text).dir === 'rtl';
  return (
    <div className={s.prose} data-rtl={rtl ? '' : undefined}>
      <Fold text={text}>
        {parts ? (
          <div className={s.marked} {...textDirAttrs(text)}>
            <Marked parts={parts} />
          </div>
        ) : (
          <TextBlock text={text} mode={mode} code={false} />
        )}
      </Fold>
    </div>
  );
}

interface Seg {
  text: string;
  mark?: boolean;
  /** Token class: a SQL keyword or a JSON token kind. */
  kind?: string;
}

/**
 * Code as lines. A line that wraps continues one step in from its own start (a hanging indent), so a wrapped
 * clause never reads as a new one.
 */
function CodeLines({ segs, lang, label }: { segs: Seg[]; lang?: string; label?: string }) {
  const lines = useMemo(() => {
    const out: Seg[][] = [[]];
    for (const seg of segs) {
      seg.text.split('\n').forEach((part, i) => {
        if (i > 0) out.push([]);
        if (part) out[out.length - 1]!.push({ ...seg, text: part });
      });
    }
    return out.map((line) => {
      const text = line.map((x) => x.text).join('');
      const indent = text.length - text.trimStart().length;
      // the indent becomes the line's own inset: drop the leading spaces from its first parts
      let drop = indent;
      const body: Seg[] = [];
      for (const seg of line) {
        if (drop >= seg.text.length) {
          drop -= seg.text.length;
          continue;
        }
        body.push(drop ? { ...seg, text: seg.text.slice(drop) } : seg);
        drop = 0;
      }
      // neighbours with the same mark draw as one mark
      const groups: Array<{ mark: boolean; segs: Seg[] }> = [];
      for (const seg of body) {
        const last = groups[groups.length - 1];
        if (last && last.mark === !!seg.mark) last.segs.push(seg);
        else groups.push({ mark: !!seg.mark, segs: [seg] });
      }
      return { indent, groups };
    });
  }, [segs]);
  return (
    <pre className={s.code} dir="ltr" data-lang={lang} aria-label={label}>
      {lines.map((line, i) => (
        <span key={i} className={s.codeLine} style={{ paddingInlineStart: `${line.indent + 2}ch` }}>
          {line.groups.length
            ? line.groups.map((g, j) => {
                const body = g.segs.map((seg, k) =>
                  seg.kind ? (
                    <span key={k} data-t={seg.kind}>
                      {seg.text}
                    </span>
                  ) : (
                    <Fragment key={k}>{seg.text}</Fragment>
                  ),
                );
                return g.mark ? (
                  <mark key={j} className={s.mark}>
                    {body}
                  </mark>
                ) : (
                  <Fragment key={j}>{body}</Fragment>
                );
              })
            : '\u200b'}
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </pre>
  );
}

/** A query or code string. A one-line SQL query is laid out by clause; only the white space changes. */
export function Code({
  text,
  other,
  side,
  sql,
}: {
  text: string;
  other?: string;
  side?: Side;
  sql: boolean;
}) {
  const shown = useMemo(() => (sql ? formatSql(text) : text), [sql, text]);
  const base = useMemo(
    () => (other === undefined ? undefined : sql ? formatSql(other) : other),
    [other, sql],
  );
  const marks = useMarks(shown, base, side);
  // keyword emphasis reads the query from its start, so a keyword inside a quoted string stays plain
  const segs = useMemo<Seg[]>(() => {
    const state = { inString: false };
    return (marks ?? [{ text: shown, mark: false }]).flatMap((p) =>
      sql
        ? sqlWords(p.text, state).map((w) => ({
            text: w.text,
            mark: p.mark,
            kind: w.keyword ? 'keyword' : undefined,
          }))
        : [{ text: p.text, mark: p.mark }],
    );
  }, [marks, shown, sql]);
  return (
    <Fold text={shown}>
      <CodeLines segs={segs} lang={sql ? 'sql' : undefined} />
    </Fold>
  );
}

function ScalarText({ v, changed }: { v: Scalar; changed?: boolean }) {
  const kind = v === null ? 'null' : typeof v;
  const text = v === null ? 'null' : v === '' ? '""' : String(v);
  const inner = (
    <span
      className={s.scalar}
      data-kind={v === '' ? 'null' : kind}
      {...(kind === 'string' ? textDirAttrs(text) : {})}
    >
      {text}
    </span>
  );
  return changed ? <mark className={s.mark}>{inner}</mark> : inner;
}

/* ---------- shapes ---------- */

type Shape = 'data' | 'prose' | 'code' | 'list' | 'table' | 'group' | 'items' | 'empty';

/** A short string that reads as one value (an id, a label, a code), not as a sentence. */
function isShort(text: string): boolean {
  return text.length <= 28 && !text.includes('\n') && text.trim().split(/\s+/).length <= 3;
}

function isTable(v: unknown[]): v is Record<string, Scalar>[] {
  return v.length > 0 && v.every((x) => isPlain(x) && Object.values(x).every(isScalar));
}

export interface TableData {
  columns: string[];
  rows: Array<Record<string, Scalar>>;
  /** Rows in the value before the cap. */
  total: number;
}

/**
 * The table a value stands for, or null. The shapes a scorer records: `{columns, rows}` (rows as arrays or objects),
 * a list of lists, and a list of like objects.
 */
export function tableOf(v: unknown): TableData | null {
  const detected = detectTable(v);
  if (detected) return detected;
  if (Array.isArray(v) && isTable(v)) {
    const columns: string[] = [];
    for (const r of v) for (const key of Object.keys(r)) if (!columns.includes(key)) columns.push(key);
    return { columns, rows: v.slice(0, TABLE_ROW_CAP), total: v.length };
  }
  return null;
}

const longestIn = (t: TableData, c: string) =>
  Math.max(c.length, ...t.rows.map((r) => String(r[c] ?? '').length));

/** A table of short values is as wide as its columns; one with a text column takes the line. */
function tableFits(t: TableData): boolean {
  return !t.columns.some((c) => longestIn(t, c) > 28);
}

function shapeOf(key: string, v: unknown): Shape {
  if (typeof v === 'string') {
    if (v !== '' && (CODE_KEY.test(key) || looksLikeSql(v))) return 'code';
    return isShort(v) ? 'data' : 'prose';
  }
  if (isScalar(v)) return 'data';
  if (Array.isArray(v)) {
    if (!v.length) return 'empty';
    if (v.every(isScalar)) return 'list';
    return tableOf(v) ? 'table' : 'items';
  }
  if (tableOf(v)) return 'table';
  return Object.keys(v as object).length ? 'group' : 'empty';
}

/** A list of short values stays on the line of its key. */
function shortList(v: unknown[]): boolean {
  return v.length <= 8 && v.map(String).join(', ').length <= 48;
}

interface NodeProps {
  k: string;
  v: unknown;
  other?: unknown;
  side?: Side;
}

function Node({ k, v, other, side }: NodeProps) {
  const [marks] = useDiffMarks();
  const compare = marks && side !== undefined && other !== undefined;
  const shape = shapeOf(k, v);
  switch (shape) {
    case 'data':
      return <ScalarText v={v as Scalar} changed={compare && other !== v} />;
    case 'prose':
      return <Prose text={v as string} other={typeof other === 'string' ? other : undefined} side={side} />;
    case 'code':
      return (
        <Code
          text={v as string}
          other={typeof other === 'string' ? other : undefined}
          side={side}
          sql={looksLikeSql(v as string) || /sql|query/i.test(k)}
        />
      );
    case 'list': {
      const items = v as Scalar[];
      const base = compare && Array.isArray(other) ? new Set(other.map(String)) : null;
      return (
        <ul className={s.list} data-long={shortList(items) ? undefined : ''}>
          {items.map((x, i) => (
            <li key={i}>
              <ScalarText v={x} changed={!!base && !base.has(String(x))} />
            </li>
          ))}
        </ul>
      );
    }
    case 'table':
      return <Table table={tableOf(v)!} other={other} side={side} label={k || 'Rows'} />;
    case 'group':
      return <FieldList data={v as Record<string, unknown>} other={other} side={side} nested />;
    case 'items':
      return (
        <ol className={s.items}>
          {(v as unknown[]).map((x, i) => (
            <li key={i} className={s.item}>
              <span className={s.index}>{i}</span>
              <div className={s.itemBody}>
                <Node k={k} v={x} other={Array.isArray(other) ? other[i] : undefined} side={side} />
              </div>
            </li>
          ))}
        </ol>
      );
    default:
      return (
        <span className={s.scalar} data-kind="null">
          {Array.isArray(v) ? '[]' : '{}'}
        </span>
      );
  }
}

interface TableRow {
  i: number;
  values: Record<string, Scalar>;
}

/**
 * A table value in the app's embedded table: one column per key, a click on a column title sorts by it. A long table
 * shows its first rows and a button for the rest.
 */
export function Table({
  table,
  other,
  side,
  label,
}: {
  table: TableData;
  other?: unknown;
  side?: Side;
  label: string;
}) {
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const base = useMemo(() => (other === undefined ? undefined : tableOf(other)?.rows), [other]);
  const data = useMemo<TableRow[]>(() => table.rows.map((values, i) => ({ i, values })), [table]);
  const columns = useMemo<Column<TableRow>[]>(() => {
    const keys = table.columns;
    const longest = (c: string) => longestIn(table, c);
    // the column with the longest text takes the free width; the others are as wide as their values
    const widest = keys.reduce((best, c) => (longest(c) > longest(best) ? c : best), keys[0]!);
    return keys.map((c): Column<TableRow> => {
      const numeric =
        table.rows.some((r) => typeof r[c] === 'number') &&
        table.rows.every((r) => r[c] == null || typeof r[c] === 'number');
      const long = c === widest && longest(c) > 28;
      return {
        id: c,
        header: keyWithBreaks(c),
        label: c,
        sort: c,
        accessor: (r) => r.values[c],
        align: numeric ? 'center' : 'start',
        flex: long,
        minWidth: long ? 200 : 64,
        // room for the text, the cell padding and the sort mark of the title
        width: long ? undefined : Math.min(240, Math.max(84, Math.round(longest(c) * 8.2) + 44)),
        resizable: false,
        cell: (r) => {
          const v = r.values[c];
          if (v === undefined || v === null)
            return (
              <span className={s.scalar} data-kind="null">
                —
              </span>
            );
          return <Node k={c} v={v} other={base?.[r.i]?.[c]} side={side} />;
        },
      };
    });
  }, [table, base, side]);
  // the table gives the sort back to its owner: the rows are put in order here, the empty cells last
  const sorted = useMemo(() => {
    if (!sort) return data;
    const dir = sort.direction === 'asc' ? 1 : -1;
    const rank = (v: Scalar | undefined) => (v === null || v === undefined || v === '' ? 1 : 0);
    return [...data].sort((x, y) => {
      const a = x.values[sort.key];
      const b = y.values[sort.key];
      if (rank(a) || rank(b)) return rank(a) - rank(b) || x.i - y.i;
      const order =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
      return order * dir || x.i - y.i;
    });
  }, [data, sort]);
  const fit = tableFits(table);
  const paged = data.length > TABLE_PAGE && !all;
  return (
    <div
      className={s.tableWrap}
      style={fit ? { inlineSize: columns.reduce((sum, c) => sum + (c.width ?? 0), 0) } : undefined}
    >
      <DataTable<TableRow>
        aria-label={label}
        columns={columns}
        rows={paged ? sorted.slice(0, TABLE_PAGE) : sorted}
        rowKey={(r) => r.i}
        density="compact"
        densityLocked
        columnMenu={false}
        stripe="report"
        variant="embedded"
        stickyHeader={false}
        responsive="scroll"
        sort={sort}
        // a sort reads every row: the rest of a long table comes into view with it
        onSortChange={(next) => {
          setSort(next);
          setAll(true);
        }}
      >
        {/* the platform's place for "Show N more": the centre of the table footer (§3.4) */}
        {paged ? (
          <DataTable.Footer
            center={
              <Button size="sm" variant="neutral" onPress={() => setAll(true)}>
                {`Show ${data.length - TABLE_PAGE} more`}
              </Button>
            }
          />
        ) : null}
      </DataTable>
      {table.total > table.rows.length && !paged ? (
        <p className={s.tableNote}>{`The first ${table.rows.length} of ${table.total} rows`}</p>
      ) : null}
    </div>
  );
}

const inlineShape = (shape: Shape, v: unknown) =>
  shape === 'data' ||
  shape === 'empty' ||
  (shape === 'list' && shortList(v as unknown[])) ||
  (shape === 'prose' && (v as string).length <= 64 && !(v as string).includes('\n'));

/** True when the details of a metric are short facts only: no text, no table, no nested group. */
export function detailIsCompact(data: Record<string, unknown>): boolean {
  return Object.entries(data).every(([k, v]) => inlineShape(shapeOf(k, v), v));
}

/** The reading order of a metric's details: the short facts, then the text, then the tables, then the nested groups. */
const DETAIL_RANK: Record<Shape, number> = {
  data: 0,
  empty: 0,
  list: 0,
  prose: 1,
  code: 2,
  table: 3,
  group: 4,
  items: 4,
};

/**
 * The keys of an object, each above its value. Short values share a line; long text, groups and tables take a line each.
 * With `detail` (what a scorer recorded for a metric) the keys are put in reading order and a small table is as wide
 * as its columns, so two small tables stand side by side.
 */
export function FieldList({
  data,
  other,
  side,
  nested,
  label,
  detail,
}: {
  data: Record<string, unknown>;
  other?: unknown;
  side?: Side;
  nested?: boolean;
  label?: string;
  detail?: boolean;
}) {
  const base = isPlain(other) ? other : undefined;
  const entries = Object.entries(data).map(([k, v]) => {
    const shape = shapeOf(k, v);
    // a value that fits on part of a line shares the line: a short value, a short list, one short sentence
    // right-to-left text takes the line, so it starts at the right edge of the block
    const inline = inlineShape(shape, v) && !(shape === 'prose' && textDirAttrs(v).dir === 'rtl');
    return { k, v, shape, inline, rank: shape === 'list' && !inline ? 1 : DETAIL_RANK[shape] };
  });
  const field = ({ k, v, shape, inline }: (typeof entries)[number]) => {
    const table = shape === 'table' ? tableOf(v) : null;
    const members = shape === 'group' ? Object.keys(v as object).length : 0;
    // short values stand on one rhythm: a field is one, two or three steps wide by its longest text
    const chars = inline
      ? Math.max(k.length, shape === 'list' ? (v as unknown[]).join(', ').length : String(v).length)
      : 0;
    const steps = Math.min(4, Math.max(1, Math.ceil((chars * 8.2) / 116)));
    return (
      <div
        key={k}
        className={s.field}
        style={inline ? { flexBasis: steps * 116 + (steps - 1) * 24 } : undefined}
        data-flow={inline ? 'inline' : 'block'}
        data-shape={shape}
        data-fit={table && tableFits(table) ? '' : undefined}
      >
        <dt className={s.key} data-part="key" {...textDirAttrs(k)}>
          {keyWithBreaks(k)}
          {table ? (
            <span className={s.keyCount}>{table.total === 1 ? '1 row' : `${table.total} rows`}</span>
          ) : null}
          {members ? (
            <span className={s.keyCount}>{members === 1 ? '1 field' : `${members} fields`}</span>
          ) : null}
        </dt>
        <dd className={s.fieldValue}>
          <Node k={k} v={v} other={base?.[k]} side={side} />
        </dd>
      </div>
    );
  };
  if (detail) {
    // the short facts on their own line, then the text, the tables and the groups under them
    entries.sort((a, b) => a.rank - b.rank);
    const facts = entries.filter((e) => e.rank === 0);
    const rest = entries.filter((e) => e.rank > 0);
    return (
      <div className={s.detailStack} role="group" aria-label={label}>
        {facts.length ? <dl className={s.fields}>{facts.map(field)}</dl> : null}
        {rest.length ? (
          <dl className={s.fields} data-detail="">
            {rest.map(field)}
          </dl>
        ) : null}
      </div>
    );
  }
  return (
    <dl className={s.fields} data-nested={nested ? '' : undefined} aria-label={label}>
      {entries.map(field)}
    </dl>
  );
}

function RawJson({ data, label }: { data: unknown; label: string }) {
  const segs = useMemo<Seg[]>(() => jsonTokens(JSON.stringify(data, null, 2)), [data]);
  const text = useMemo(() => segs.map((x) => x.text).join(''), [segs]);
  return (
    <Fold text={text}>
      <CodeLines segs={segs} lang="json" label={`${label}, raw JSON`} />
    </Fold>
  );
}

/** The text an object stands for when it holds one text field ({"answer": "…"}): it can be compared with plain text. */
function loneText(data: Record<string, unknown> | unknown[]): string | undefined {
  if (Array.isArray(data)) return undefined;
  const values = Object.values(data);
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined;
}

export function Value({
  value,
  label,
  other,
  side,
  raw,
}: {
  value: unknown;
  label: string;
  /** The value this one is read against (Expected for an output, the output for Expected). */
  other?: unknown;
  side?: Side;
  /** Show a JSON value as its raw text (the switch of the block). */
  raw?: boolean;
}) {
  const parsed = useMemo(() => parseStructured(value), [value]);
  const against = useMemo(() => (other === undefined ? undefined : parseStructured(other)), [other]);
  if (!parsed.structured) {
    if (!parsed.text) return <p className={s.note}>Nothing was recorded</p>;
    const base = against ? (against.structured ? loneText(against.data) : against.text) : undefined;
    return <Prose text={parsed.text} other={base} side={side} />;
  }
  if (raw) return <RawJson data={parsed.data} label={label} />;
  const data = parsed.data;
  if (Array.isArray(data)) {
    return <Node k="" v={data} other={against?.structured ? against.data : undefined} side={side} />;
  }
  // an object with one text field read against plain text: the texts are compared
  const lone = loneText(data);
  const base = against
    ? against.structured
      ? against.data
      : lone !== undefined
        ? { [Object.keys(data)[0]!]: against.text }
        : undefined
    : undefined;
  return <FieldList data={data} other={base} side={side} label={label} />;
}
