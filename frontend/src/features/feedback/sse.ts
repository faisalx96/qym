/** Server-sent events over `fetch` POST (EventSource cannot POST): spec-e section 4.8, QE-D16. */
import { ApiError } from '@/lib/http';
import { platformUrl } from '@/lib/runtime';

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Incremental parser: `push` any chunk, get the complete events; comments (`: ping`) are dropped. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const out: SseEvent[] = [];
    let at: number;
    while ((at = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      try {
        out.push({ event, data: JSON.parse(data.join('\n')) as Record<string, unknown> });
      } catch {
        /* a malformed block is skipped */
      }
    }
    return out;
  }
}

export interface StreamOptions {
  path: string;
  body?: unknown;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

/** POST and read the event stream until it ends. Throws `ApiError` for a non-2xx answer. */
export async function streamPost({ path, body, signal, onEvent }: StreamOptions): Promise<void> {
  const response = await fetch(platformUrl(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'text/event-stream', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) {
    let detail = '';
    let code: string | undefined;
    let headers: Headers | undefined;
    try {
      const j = (await response.json()) as { detail?: unknown; code?: string };
      detail = typeof j.detail === 'string' ? j.detail : '';
      code = j.code;
      headers = response.headers;
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, detail, { code, headers });
  }
  if (!response.body) throw new TypeError('network: no response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev);
  }
  for (const ev of parser.push(decoder.decode() + '\n\n')) onEvent(ev);
}
