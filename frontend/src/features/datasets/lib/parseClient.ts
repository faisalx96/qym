/** Main-thread client for parse.worker.ts (falls back to inline parsing when Workers are unavailable). */
import type { CsvParseResult, JsonParseResult, ParseRequest, ParseResult } from './parse.worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: ParseResult) => void>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ParseResult>) => {
      const done = pending.get(e.data.id);
      if (done) {
        pending.delete(e.data.id);
        done(e.data);
      }
    };
    worker.onerror = () => {
      for (const done of pending.values())
        done({ id: -1, kind: 'csv', encoding: 'utf-8', detectedEncoding: 'utf-8', delimiter: ',', headers: [], rows: [], warnings: [], error: 'Could not read the file.' });
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export async function parseFile(file: File, encoding?: string): Promise<CsvParseResult | JsonParseResult> {
  const bytes = await file.arrayBuffer();
  const w = getWorker();
  if (!w) {
    const { parseUpload } = await import('./parse.worker');
    return parseUpload({ bytes, fileName: file.name, encoding });
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, (r) => resolve(r));
    const req: ParseRequest = { id, bytes, fileName: file.name, encoding };
    w.postMessage(req, [bytes]);
  });
}
