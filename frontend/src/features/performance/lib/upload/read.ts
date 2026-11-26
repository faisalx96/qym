/**
 * Upload of a question file, part 1: finding the questions whatever the structure of the file. A list of
 * records, a list of texts, one record per line, a table, or a few named lists: every structure ends as
 * rows of flat fields (nested fields become dotted names). The text decoding, the table reader and the place
 * of a JSON error are the Datasets area's.
 */
import { csvParse, detectCSVDelimiter } from '@/features/datasets/lib/csv';
import { decodeBytes, detectCSVEncoding } from '@/features/datasets/lib/encoding';
import { jsonErrorPlace } from '@/features/datasets/lib/jsonRecords';

/** The field that stands for "the named list a record sits in" (the suite's own file: simple, medium, complex). */
export const GROUP_FIELD = '(the list it sits in)';

/** Files larger than this are not read in the browser. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ACCEPT = '.json,.jsonl,.ndjson,.csv,.tsv,.txt';

export type UploadRow = Record<string, unknown>;

export interface UploadFileInfo {
  format: 'JSON' | 'JSON Lines' | 'CSV' | 'TSV' | 'Text';
  /** One list inside a document: the name it sits under. */
  under?: string;
  /** Several named lists: their names, in the file's order. */
  groups?: string[];
  /** A table: its number of columns. */
  columns?: number;
  /** Plain text, one question per line. */
  lines?: boolean;
  /** A list of texts and nothing else. */
  texts?: boolean;
  /** Entries that are neither a record nor a text. */
  skipped: number;
}

export interface UploadData {
  rows: UploadRow[];
  /** Every field of any row, in the order first seen. */
  fields: string[];
  info: UploadFileInfo;
}

export type UploadRead = UploadData | { error: string };

export const isUploadError = (read: UploadRead): read is { error: string } => 'error' in read;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * A record as flat fields: a nested record becomes dotted names, a list of records gives the fields of its
 * first record ('followUpQuestions[0].question'), a list of plain values stays a list. Empty values are left out.
 */
export function flattenRecord(
  record: Record<string, unknown>,
  out: UploadRow = {},
  prefix = '',
  depth = 0,
): UploadRow {
  for (const [name, value] of Object.entries(record)) {
    const key = prefix + name;
    if (Array.isArray(value)) {
      if (value.length && isRecord(value[0]) && depth < 2)
        flattenRecord(value[0], out, `${key}[0].`, depth + 1);
      else if (value.length) out[key] = value;
    } else if (isRecord(value) && depth < 2) flattenRecord(value, out, `${key}.`, depth + 1);
    else if (value !== null && value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

function found(rows: UploadRow[], info: UploadFileInfo): UploadData {
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of rows)
    for (const key of Object.keys(row))
      if (!seen.has(key)) {
        seen.add(key);
        fields.push(key);
      }
  return { rows, fields, info };
}

function fromList(items: unknown[], info: Omit<UploadFileInfo, 'skipped' | 'texts'>): UploadRead {
  const records: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const item of items) {
    if (typeof item === 'string') records.push({ text: item });
    else if (isRecord(item)) records.push(item);
    else skipped += 1;
  }
  if (!records.length) return { error: 'There are no records in this file.' };
  return found(
    records.map((record) => flattenRecord(record)),
    { ...info, skipped, texts: items.every((item) => typeof item === 'string') },
  );
}

/** A list worth reading: it holds at least one record or text. */
const isQuestionList = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.some((item) => typeof item === 'string' || isRecord(item));

/** How deep under the top of a document lists are looked for: `{"suite": {"cases": [...]}}` is two levels. */
const LIST_DEPTH = 3;

/**
 * The lists of a document: those nearest the top, up to three levels down. A name that starts with '_' is a
 * note, not a list. Each list is named by its own key (its whole path when two keys are the same), and keeps its
 * path for saying where one list sits.
 */
function findLists(doc: Record<string, unknown>): { name: string; path: string; list: unknown[] }[] {
  let level: [string[], Record<string, unknown>][] = [[[], doc]];
  for (let depth = 1; depth <= LIST_DEPTH && level.length; depth += 1) {
    const found: [string[], unknown[]][] = [];
    const deeper: [string[], Record<string, unknown>][] = [];
    for (const [path, record] of level)
      for (const [name, value] of Object.entries(record)) {
        if (name.startsWith('_')) continue;
        if (isQuestionList(value)) found.push([[...path, name], value]);
        else if (isRecord(value)) deeper.push([[...path, name], value]);
      }
    if (found.length) {
      const last = found.map(([path]) => path[path.length - 1]!);
      const unique = new Set(last).size === last.length;
      return found.map(([path, list], index) => ({
        name: unique ? last[index]! : path.join('.'),
        path: path.join('.'),
        list,
      }));
    }
    level = deeper;
  }
  return [];
}

function fromDocument(doc: unknown): UploadRead {
  if (Array.isArray(doc)) return fromList(doc, { format: 'JSON' });
  if (isRecord(doc)) {
    const groups = findLists(doc);
    if (groups.length === 1) return fromList(groups[0]!.list, { format: 'JSON', under: groups[0]!.path });
    if (groups.length > 1) {
      const all: unknown[] = [];
      for (const { name, list } of groups)
        for (const item of list)
          all.push(
            typeof item === 'string'
              ? { text: item, [GROUP_FIELD]: name }
              : isRecord(item)
                ? { ...item, [GROUP_FIELD]: name }
                : item,
          );
      return fromList(all, { format: 'JSON', groups: groups.map(({ name }) => name) });
    }
  }
  return {
    error:
      'No list of questions was found. A file can hold a list of records, a list of texts, or a few named lists (for example simple, medium and complex), at the top or up to three levels down.',
  };
}

function fromTable(text: string, tab: boolean): UploadRead {
  const delimiter = tab ? '\t' : detectCSVDelimiter(text);
  const rows = csvParse(text, delimiter).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2)
    return { error: 'The table needs a first row with column names and at least one row under it.' };
  const head = rows[0]!.map((name, index) => name.trim() || `Column ${index + 1}`);
  return found(
    rows.slice(1).map((row) => {
      const out: UploadRow = {};
      head.forEach((name, index) => {
        const value = (row[index] ?? '').trim();
        if (value) out[name] = value;
      });
      return out;
    }),
    { format: delimiter === '\t' ? 'TSV' : 'CSV', columns: head.length, skipped: 0 },
  );
}

/** Reads the text of a file by its name and content. Never throws: a file that cannot be read gives `error`. */
export function readQuestionFile(name: string, content: string): UploadRead {
  const text = String(content ?? '').replace(/^\uFEFF/, '');
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const trimmed = text.trim();
  if (!trimmed) return { error: 'The file is empty.' };
  if (ext === 'csv' || ext === 'tsv') return fromTable(text, ext === 'tsv');
  const lines = () =>
    trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  if (ext === 'txt' && !/^[[{]/.test(trimmed))
    return found(
      lines().map((line) => ({ text: line })),
      { format: 'Text', lines: true, skipped: 0 },
    );
  let doc: unknown;
  try {
    doc = JSON.parse(trimmed);
  } catch (error) {
    // Not one document: maybe one record per line.
    const records: unknown[] = [];
    let bad = 0;
    let badLine = 0;
    lines().forEach((line, index) => {
      try {
        records.push(JSON.parse(line));
      } catch {
        if (!bad) badLine = index + 1;
        bad += 1;
      }
    });
    if (bad) {
      if (ext === 'json' || trimmed.startsWith('[') || !records.length) {
        const place = jsonErrorPlace(error, trimmed);
        return {
          error: `Not valid JSON${place ? ` at line ${place.line}, character ${place.character}` : ''}.`,
        };
      }
      return {
        error: `Line ${badLine} is not valid JSON${bad > 1 ? `, and ${plural(bad - 1, 'more line')} like it` : ''}.`,
      };
    }
    return fromList(records, { format: 'JSON Lines' });
  }
  return fromDocument(doc);
}

/** The bytes of a file as text, with the Datasets area's detection of the encoding. */
export function decodeUploadBytes(bytes: Uint8Array): string {
  try {
    return decodeBytes(bytes, detectCSVEncoding(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** What was found, in one sentence: '139 records in 3 named lists (simple, medium, complex)'. */
export function describeStructure(data: UploadData): string {
  const { info } = data;
  const n = data.rows.length;
  if (info.groups)
    return `${plural(n, 'record')} in ${info.groups.length} named lists (${info.groups.join(', ')})`;
  if (info.columns) return `A table with ${plural(n, 'row')} and ${plural(info.columns, 'column')}`;
  if (info.lines) return `${plural(n, 'line')} of text, one question per line`;
  if (info.texts) return `A list of ${plural(n, 'text')}`;
  if (info.format === 'JSON Lines') return `${plural(n, 'record')}, one per line`;
  return info.under
    ? `${plural(n, 'record')} in the list “${info.under}”`
    : `${plural(n, 'record')} in one list`;
}
