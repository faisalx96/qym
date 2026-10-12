/**
 * Upload parsing off the main thread: encoding detection, CSV delimiter +
 * parse, JSON/JSONL validation. Receives the file bytes, answers with the
 * table/records and the warnings the wizard shows.
 */
import { csvTable } from './csv';
import { decodeBytes, detectCSVEncoding, looksGarbled } from './encoding';
import { parseJSONRecords, unknownJsonKeys } from './jsonRecords';

export interface ParseRequest {
  id: number;
  bytes: ArrayBuffer;
  fileName: string;
  /** Explicit encoding (wizard select); undefined = detect. */
  encoding?: string;
}

export interface CsvParseResult {
  kind: 'csv';
  encoding: string;
  detectedEncoding: string;
  delimiter: string;
  headers: string[];
  rows: string[][];
  warnings: string[];
  error?: string;
}

export interface JsonParseResult {
  kind: 'json';
  format: 'json' | 'jsonl';
  rows: Record<string, unknown>[];
  errors: { where: string; message: string }[];
  total: number;
  unknownKeys: string[];
  warnings: string[];
  error?: string;
}

export type ParseResult = (CsvParseResult | JsonParseResult) & { id: number };

export function isJsonFile(name: string): boolean {
  return /\.(json|jsonl|ndjson)$/i.test(name);
}

export function parseUpload(req: Omit<ParseRequest, 'id'>): CsvParseResult | JsonParseResult {
  const bytes = new Uint8Array(req.bytes);
  if (isJsonFile(req.fileName)) {
    let text: string;
    try {
      text = decodeBytes(bytes, 'utf-8');
    } catch {
      return {
        kind: 'json',
        format: 'jsonl',
        rows: [],
        errors: [],
        total: 0,
        unknownKeys: [],
        warnings: [],
        error: 'JSON and JSONL files must be UTF-8.',
      };
    }
    const parsed = parseJSONRecords(text, req.fileName);
    return { kind: 'json', ...parsed, unknownKeys: unknownJsonKeys(parsed.rows), warnings: [] };
  }
  const detected = detectCSVEncoding(bytes);
  const encoding = req.encoding ?? detected;
  let text: string;
  try {
    text = decodeBytes(bytes, encoding);
  } catch {
    return {
      kind: 'csv',
      encoding,
      detectedEncoding: detected,
      delimiter: ',',
      headers: [],
      rows: [],
      warnings: [],
      error: `The file is not valid ${encoding.toUpperCase()}. Choose the file's real encoding.`,
    };
  }
  const warnings: string[] = [];
  if (looksGarbled(text)) warnings.push('Some text looks garbled. Try another encoding before importing.');
  const table = csvTable(text);
  if (!table.headers.length) {
    return { kind: 'csv', encoding, detectedEncoding: detected, delimiter: table.delimiter, headers: [], rows: [], warnings, error: 'The CSV file has no header row.' };
  }
  return { kind: 'csv', encoding, detectedEncoding: detected, delimiter: table.delimiter, headers: table.headers, rows: table.rows, warnings };
}

// Only inside a worker (the main-thread fallback imports this module too).
const inWorker = typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function';
if (inWorker) {
  self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, ...req } = event.data;
  const result = parseUpload(req);
    (self as unknown as Worker).postMessage({ id, ...result } satisfies ParseResult);
  };
}
