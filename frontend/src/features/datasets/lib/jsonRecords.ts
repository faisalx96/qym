/**
 * JSON / JSONL upload validation with the server's rules: a `.json` file holding
 * an array is JSON, anything else is JSONL, every record must be an object.
 * Nothing is dropped silently — bad records come back as errors with their place.
 */
export interface JsonRecordError {
  where: string;
  message: string;
  /** A parse error: 1-based line and character, and the first 80 characters of that line (C120). */
  line?: number;
  character?: number;
  snippet?: string;
}

/** Where a JSON.parse error happened in `text`: 1-based line and character, when the engine says. */
export function jsonErrorPlace(error: unknown, text: string): { line: number; character: number } | null {
  const msg = error instanceof Error ? error.message : String(error);
  const lc = /line (\d+) column (\d+)/i.exec(msg);
  if (lc) return { line: Number(lc[1]), character: Number(lc[2]) };
  const pos = /position (\d+)/i.exec(msg);
  if (!pos) return null;
  const before = text.slice(0, Number(pos[1]));
  const line = before.split('\n').length;
  return { line, character: Number(pos[1]) - before.lastIndexOf('\n') };
}

/** One parse error in words: 'Not valid JSON at line 3, character 64' (C246), never the engine's own text. */
export function jsonErrorText(e: JsonRecordError): string {
  if (e.line && e.character) return `Not valid JSON at line ${e.line}, character ${e.character}`;
  if (e.line) return `Not valid JSON at line ${e.line}`;
  return `${e.where} ${e.message}`;
}

export interface JsonRecordsResult {
  format: 'json' | 'jsonl';
  rows: Record<string, unknown>[];
  errors: JsonRecordError[];
  total: number;
}

/** Keys the importer reads from a record (same aliases as the server). */
export const JSON_ITEM_KEYS = ['item_id', 'id', 'input', 'expected_output', 'expected', 'metadata', 'labels'];

export function jsonRecordProblem(obj: unknown): string {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return 'must be a JSON object';
  const meta = (obj as { metadata?: unknown }).metadata;
  if (meta != null && (typeof meta !== 'object' || Array.isArray(meta)))
    return 'metadata must be a JSON object';
  return '';
}

export function parseJSONRecords(text: string, fileName: string): JsonRecordsResult {
  const body = String(text ?? '').replace(/^\uFEFF/, '');
  const rows: Record<string, unknown>[] = [];
  const errors: JsonRecordError[] = [];
  if (fileName.toLowerCase().endsWith('.json') && body.trim().startsWith('[')) {
    let doc: unknown;
    try {
      doc = JSON.parse(body);
    } catch (e) {
      const place = jsonErrorPlace(e, body);
      const lineText = place ? (body.split('\n')[place.line - 1] ?? '') : '';
      return {
        format: 'json',
        rows,
        errors: [
          {
            where: 'File',
            message: 'is not valid JSON',
            ...(place ? { ...place, snippet: lineText.trim().slice(0, 80) } : {}),
          },
        ],
        total: 0,
      };
    }
    const list = doc as unknown[];
    list.forEach((obj, index) => {
      const problem = jsonRecordProblem(obj);
      if (problem) errors.push({ where: `Item ${index + 1}`, message: problem });
      else rows.push(obj as Record<string, unknown>);
    });
    return { format: 'json', rows, errors, total: list.length };
  }
  let total = 0;
  body.split('\n').forEach((line, index) => {
    const t = line.trim();
    if (!t) return;
    total += 1;
    let obj: unknown;
    try {
      obj = JSON.parse(t);
    } catch (e) {
      const place = jsonErrorPlace(e, t);
      // the character counts from the start of the line as the file has it (leading spaces included)
      const lead = line.length - line.trimStart().length;
      errors.push({
        where: `Line ${index + 1}`,
        message: 'is not valid JSON',
        line: index + 1,
        ...(place ? { character: place.character + lead } : {}),
        snippet: t.slice(0, 80),
      });
      return;
    }
    const problem = jsonRecordProblem(obj);
    if (problem) errors.push({ where: `Line ${index + 1}`, message: problem });
    else rows.push(obj as Record<string, unknown>);
  });
  return { format: 'jsonl', rows, errors, total };
}

/** Mirrors `_labels` on the server: comma string or list. */
export function importLabels(value: unknown): string[] {
  if (typeof value === 'string')
    return value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return value.map((p) => String(p).trim()).filter(Boolean);
  return [];
}

/** Record keys the importer will not read (shown as "Not imported"). */
export function unknownJsonKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 500)) {
    for (const key of Object.keys(row)) if (!JSON_ITEM_KEYS.includes(key)) seen.add(key);
  }
  return [...seen];
}

/** The keys a mapping can place, in first-seen order: every record key but metadata and labels, which import as such. */
export function jsonMappableKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 500))
    for (const key of Object.keys(row)) if (key !== 'metadata' && key !== 'labels') seen.add(key);
  return [...seen];
}
