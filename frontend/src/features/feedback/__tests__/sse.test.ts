import { describe, expect, it } from 'vitest';
import { SseParser } from '../sse';

describe('SseParser', () => {
  it('reads events split across chunks and ignores ping comments', () => {
    const p = new SseParser();
    expect(p.push('event: status\ndata: {"phase":"thi')).toEqual([]);
    expect(p.push('nking"}\n\n: ping\n\nevent: delta\ndata: {"text":"Hel')).toEqual([
      { event: 'status', data: { phase: 'thinking' } },
    ]);
    expect(p.push('lo"}\n\n')).toEqual([{ event: 'delta', data: { text: 'Hello' } }]);
  });

  it('handles CRLF and skips malformed blocks', () => {
    const p = new SseParser();
    const out = p.push('event: done\r\ndata: {"seq":3}\r\n\r\nevent: x\r\ndata: not json\r\n\r\nevent: delta\r\ndata: {"text":"a"}\r\n\r\n');
    expect(out.map((e) => e.event)).toEqual(['done', 'delta']);
  });

  it('keeps non-ASCII text intact', () => {
    const out = new SseParser().push('event: delta\ndata: {"text":"مرحبا"}\n\n');
    expect(out[0]!.data.text).toBe('مرحبا');
  });
});
