/**
 * The JSON of a tool call or a tool result as the pre-React viewer showed it (round 3 T2, owner: "i like it to have
 * defaults to json outputs for tool calls"): a code block with line numbers, a fold arrow on each group and the
 * platform's JSON colours (--json-*). It is the JSON and nothing else (owner: "we only shall render sql or tables
 * when its NOT a JSON view"): a query is its string and a list of records is its lines. The fields view (the { }
 * switch) is where a query is formatted and a list of records is a table.
 */
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, parseStructured } from '@/ui';
import { codeKind } from '../items/pane/code';
import { Code, Value } from '../items/pane/values';
import j from './JsonCode.module.css';

type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
}

interface Group {
  /** The path of the group: the key of its fold state. */
  path: string;
  /** The name of the group's fold arrow: its key, its index, or "root". */
  name: string;
  /** The index of the closing line. */
  end: number;
  /** What the folded line says: "3 keys", "2 items". */
  summary: string;
}

export interface JsonLine {
  /** The line number, from 1. */
  n: number;
  depth: number;
  tokens: Token[];
  /** An opening line: the group it opens. */
  group?: Group;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lines of a JSON value, two spaces a level, as `JSON.stringify(value, null, 2)` writes them. */
export function jsonLines(value: unknown): JsonLine[] {
  const out: JsonLine[] = [];
  const push = (line: Omit<JsonLine, 'n'>) => {
    out.push({ ...line, n: out.length + 1 });
    return out.length - 1;
  };
  const walk = (v: unknown, depth: number, key: string | null, path: string, comma: boolean) => {
    const head: Token[] =
      key === null
        ? []
        : [
            { kind: 'key', text: JSON.stringify(key) },
            { kind: 'punct', text: ': ' },
          ];
    const tail: Token[] = comma ? [{ kind: 'punct', text: ',' }] : [];
    if (v !== null && typeof v === 'object') {
      const list = Array.isArray(v);
      const entries: Array<[string, unknown]> = list
        ? (v as unknown[]).map((x, i) => [String(i), x])
        : Object.entries(v as Record<string, unknown>);
      const [open, close] = list ? ['[', ']'] : ['{', '}'];
      if (!entries.length) {
        push({ depth, tokens: [...head, { kind: 'punct', text: open + close }, ...tail] });
        return;
      }
      const at = push({
        depth,
        tokens: [...head, { kind: 'punct', text: open }],
        group: {
          path,
          name: key ?? (depth === 0 ? 'root' : path.slice(path.lastIndexOf('/') + 1)),
          end: -1,
          summary: list ? plural(entries.length, 'item', 'items') : plural(entries.length, 'key', 'keys'),
        },
      });
      entries.forEach(([k, x], i) =>
        walk(x, depth + 1, list ? null : k, `${path}/${k}`, i < entries.length - 1),
      );
      push({ depth, tokens: [{ kind: 'punct', text: close }, ...tail] });
      out[at]!.group!.end = out.length - 1;
      return;
    }
    const kind: TokenKind =
      v === null ? 'null' : typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : 'boolean';
    push({ depth, tokens: [...head, { kind, text: v === undefined ? 'null' : JSON.stringify(v) }, ...tail] });
  };
  walk(value, 0, null, '', false);
  return out;
}

function Tokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === 'punct' && !t.text.trim() ? (
          <Fragment key={i}>{t.text}</Fragment>
        ) : (
          <span key={i} data-t={t.kind}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

/** A JSON value as code: line numbers and a fold arrow per group. Every group opens. */
export function JsonCode({ data, label }: { data: unknown; label: string }) {
  const lines = useMemo(() => jsonLines(data), [data]);
  const [shutGroups, setShutGroups] = useState<ReadonlySet<string>>(() => new Set());
  const folded = (g: Group) => shutGroups.has(g.path);
  const toggle = (g: Group) =>
    setShutGroups((cur) => {
      const next = new Set(cur);
      if (next.has(g.path)) next.delete(g.path);
      else next.add(g.path);
      return next;
    });
  const rows: ReactNode[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const g = line.group;
    const shut = g ? folded(g) : false;
    const style = { '--depth': line.depth } as CSSProperties;
    rows.push(
      <div key={line.n} className={j.line} style={style}>
        <span className={j.num} aria-hidden="true">
          {line.n}
        </span>
        <span className={j.foldCell}>
          {g ? (
            <button
              type="button"
              className={j.fold}
              aria-expanded={!shut}
              aria-label={g.name}
              title={shut ? 'Show the lines of this group' : 'Fold this group'}
              onClick={() => toggle(g)}
            >
              <Icon name={shut ? 'chevron-right' : 'chevron-down'} size={12} />
            </button>
          ) : null}
        </span>
        <span className={j.text}>
          <Tokens tokens={line.tokens} />
          {g && shut ? (
            <>
              <span data-t="punct">{` … ${lines[g.end]!.tokens.map((t) => t.text).join('')}`}</span>
              <span className={j.note}>{g.summary}</span>
            </>
          ) : null}
        </span>
      </div>,
    );
    if (g && shut) i = g.end;
  }
  const digits = String(lines.length).length;
  return (
    <div className={j.code} dir="ltr" data-json={label} style={{ '--digits': digits } as CSSProperties}>
      {rows}
    </div>
  );
}

/**
 * A tool's arguments or result in the JSON view: JSON is the code block above. A text that is not JSON has no JSON
 * view: a query text is the formatted query, any other text the message text.
 */
export function JsonView({ value, label }: { value: unknown; label: string }) {
  const parsed = useMemo(() => parseStructured(value), [value]);
  if (!parsed.structured) {
    if (codeKind(parsed.text) === 'sql') return <Code text={parsed.text} sql />;
    return <Value value={value} label={label} />;
  }
  return <JsonCode data={parsed.data} label={label} />;
}
