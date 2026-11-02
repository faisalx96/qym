/** RFC-4180-ish CSV parsing and delimiter sniffing (pure; runs inside the worker). */

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export function csvParse(text: string, delimiter: string = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function detectCSVDelimiter(text: string): CsvDelimiter {
  let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ',', score: -1 };
  for (const delimiter of CSV_DELIMITERS) {
    const rows = csvParse(text.slice(0, 65536), delimiter)
      .filter((r) => r.some((c) => String(c ?? '').trim()))
      .slice(0, 20);
    const first = rows[0];
    if (!first || first.length < 2) continue;
    const width = first.length;
    const matching = rows.filter((r) => r.length === width).length;
    const score = matching * 100 - (rows.length - matching) * 100 + width;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: CsvDelimiter;
}

/** Headers + data rows (blank rows dropped; short rows padded). */
export function csvTable(text: string, delimiter?: CsvDelimiter): CsvTable {
  const d = delimiter ?? detectCSVDelimiter(text);
  const all = csvParse(text.replace(/^\uFEFF/, ''), d).filter((r) => r.some((c) => String(c ?? '').trim()));
  const headers = (all[0] ?? []).map((h) => h.trim());
  const rows = all.slice(1).map((r) => {
    if (r.length >= headers.length) return r.slice(0, headers.length);
    return [...r, ...new Array<string>(headers.length - r.length).fill('')];
  });
  return { headers, rows, delimiter: d };
}
