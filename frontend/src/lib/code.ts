/**
 * Display helpers for code in a value: a one-line SQL query laid out by clause, SQL keywords, JSON tokens. Shared by
 * the run item pane and the dataset item pane / item page (feedback 17 Nov D4).
 */

const SQL_START = /^\s*(with|select|insert\s+into|update|delete\s+from|create|alter|drop)\b/i;

export function looksLikeSql(text: string): boolean {
  return text.length < 20_000 && SQL_START.test(text) && /\b(from|into|set|table|values)\b/i.test(text);
}

/**
 * What a plain string value holds: a SQL query, a JSON object or array written as text, or prose (null). A view shows
 * `sql` and `json` as a code block and keeps prose as prose.
 */
export function codeKind(text: string): 'sql' | 'json' | null {
  // A sentence ("Select the best answer from the list.") is prose: SQL has an operator or a further clause and
  // never ends like a sentence.
  if (
    looksLikeSql(text) &&
    !/[.?!]\s*$/.test(text) &&
    /[*,(=;]|\b(where|join|group\s+by|order\s+by|limit|values|set)\b/i.test(text)
  )
    return 'sql';
  const t = text.trim();
  if (t.length >= 2 && t.length < 200_000 && /^[[{]/.test(t) && /[\]}]$/.test(t)) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      return null;
    }
  }
  return null;
}

const SQL_TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][\w$]*|\s+|./gs;
const WORD = /^[A-Za-z_]/;
/** Clause starts, longest first: each begins a line. */
const CLAUSES = [
  'left outer join',
  'right outer join',
  'full outer join',
  'union all',
  'group by',
  'order by',
  'left join',
  'right join',
  'inner join',
  'full join',
  'cross join',
  'insert into',
  'delete from',
  'select',
  'from',
  'where',
  'having',
  'limit',
  'offset',
  'union',
  'except',
  'intersect',
  'values',
  'returning',
  'join',
].map((c) => c.split(' '));
const strip = (t: string) => t.replace(/\s+/g, '');

/** A SELECT line that is too long puts each selected expression on its own line. */
function splitSelect(line: string): string[] {
  const indent = line.match(/^ */)![0];
  const body = line.slice(indent.length);
  if (!/^select\b/i.test(body) || line.length <= 76) return [line];
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  if (parts.length < 2) return [line];
  return parts.map((p, i) => (i === 0 ? indent + p : `${indent}  ${p}`));
}

/**
 * Lays a one-line SQL query out by clause: each clause on its own line, a sub-query indented, AND / OR of a filter
 * under its clause. Only white space changes; when that cannot be shown to hold, the query is returned as recorded.
 */
export function formatSql(text: string): string {
  if (text.includes('\n') || !looksLikeSql(text)) return text;
  const tokens = text.trim().match(SQL_TOKEN) ?? [];
  const wordAt = (from: number): [string, number] | null => {
    for (let j = from; j < tokens.length; j++) {
      if (/^\s+$/.test(tokens[j]!)) continue;
      return [tokens[j]!, j];
    }
    return null;
  };
  let out = '';
  let space = false;
  let between = false;
  let prevWord = '';
  // a sub-query is indented one level under the line that opens it
  let lineLevel = 0;
  const levels: Array<{ base: number; opened: number }> = [{ base: 0, opened: 0 }];
  const parens: boolean[] = [];
  const clause: string[] = [''];
  const lineStart = () => out === '' || /\n *$/.test(out);
  const lineAt = (level: number) => {
    lineLevel = level;
    out = `${out.replace(/[ \t]+$/, '')}\n${'  '.repeat(level)}`;
  };
  const newline = (extra = 0) => lineAt(levels[levels.length - 1]!.base + extra);
  const emit = (t: string) => {
    out += (space && !lineStart() ? ' ' : '') + t;
    space = false;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (/^\s+$/.test(t)) {
      space = true;
      continue;
    }
    if (t === '(') {
      const next = wordAt(i + 1);
      const sub = !!next && /^(select|with)$/i.test(next[0]);
      parens.push(sub);
      emit('(');
      if (sub) {
        levels.push({ base: lineLevel + 1, opened: lineLevel });
        clause.push('');
        newline();
      }
      prevWord = '(';
      continue;
    }
    if (t === ')') {
      const sub = parens.pop();
      if (sub && levels.length > 1) {
        const closed = levels.pop()!;
        clause.pop();
        lineAt(closed.opened);
        space = false;
      }
      emit(')');
      prevWord = ')';
      continue;
    }
    const inCall = parens.length > 0 && parens[parens.length - 1] === false;
    if (WORD.test(t) && !inCall) {
      const low = t.toLowerCase();
      if (low === 'with' && (prevWord === '' || prevWord === '(')) {
        if (!lineStart()) newline();
        emit(t);
        clause[clause.length - 1] = 'with';
        prevWord = low;
        continue;
      }
      // the longest clause start that begins at this word
      let hit: { words: string[]; end: number } | null = null;
      for (const c of CLAUSES) {
        if (c[0] !== low) continue;
        const words = [t];
        let at = i;
        let ok = true;
        for (let k = 1; k < c.length; k++) {
          const next = wordAt(at + 1);
          if (!next || next[0].toLowerCase() !== c[k]) {
            ok = false;
            break;
          }
          words.push(next[0]);
          at = next[1];
        }
        if (ok) {
          hit = { words, end: at };
          break;
        }
      }
      if (hit) {
        if (!lineStart()) newline();
        space = false;
        emit(hit.words.join(' '));
        clause[clause.length - 1] = hit.words.join(' ').toLowerCase();
        i = hit.end;
        prevWord = low;
        between = false;
        continue;
      }
      if (low === 'between') between = true;
      else if (low === 'and' || low === 'or') {
        const cur = clause[clause.length - 1] ?? '';
        if (low === 'and' && between) between = false;
        else if (cur === 'where' || cur === 'having' || cur.endsWith('join')) {
          newline(1);
          space = false;
        }
      }
      prevWord = low;
    } else if (WORD.test(t)) prevWord = t.toLowerCase();
    else prevWord = t;
    emit(t);
  }
  const laid = out.split('\n').flatMap(splitSelect).join('\n');
  return strip(laid) === strip(text) ? laid : text;
}

const KEYWORDS = new Set(
  (
    'select from where join left right inner outer full cross on using group by having order limit offset union all ' +
    'except intersect with as and or not in is null like ilike between case when then else end distinct over ' +
    'partition filter asc desc insert into values update set delete create table exists interval returning'
  ).split(' '),
);

export interface SqlWord {
  text: string;
  keyword: boolean;
}

/** The words of a piece of SQL; `state` carries the open quote from one piece to the next. */
export function sqlWords(text: string, state: { inString: boolean }): SqlWord[] {
  const out: SqlWord[] = [];
  for (const m of text.matchAll(/'|[A-Za-z_][\w$]*|[^'A-Za-z_]+/g)) {
    const t = m[0];
    let keyword = false;
    if (t === "'") state.inString = !state.inString;
    else keyword = !state.inString && KEYWORDS.has(t.toLowerCase());
    const last = out[out.length - 1];
    if (last && !last.keyword && !keyword) last.text += t;
    else out.push({ text: t, keyword });
  }
  return out;
}

export interface JsonToken {
  text: string;
  kind?: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;

/** Pretty-printed JSON as coloured tokens (the JSON viewer's palette). */
export function jsonTokens(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  let at = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: m[2] ? 'key' : 'string' });
      if (m[2]) out.push({ text: m[2], kind: 'punct' });
    } else if (m[3] !== undefined) out.push({ text: m[3], kind: 'boolean' });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: 'null' });
    else if (m[5] !== undefined) out.push({ text: m[5], kind: 'number' });
    else out.push({ text: m[0], kind: 'punct' });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
