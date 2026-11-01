/** C175: the nav's Errors badge counts items with a task or metric error, not every trace error. */
import { describe, expect, it } from 'vitest';
import type { Row } from '../../types';
import { navErrorCount } from '../panelCounts';

const row = (extra: Partial<Row>): Row => ({ item_id: 'x', index: 0, ...extra }) as Row;

describe('navErrorCount', () => {
  it('counts one failed item once, and keeps trace errors out of the badge', () => {
    const rows = [
      row({ item_id: 'a', status: 'error', error: 'boom', trace_stats: { tool_errors: 11 } }),
      row({ item_id: 'b', status: 'completed' }),
    ];
    const n = navErrorCount(rows);
    expect(n.items).toBe(1);
    expect(n.traceErrors).toBe(11);
    expect(n.tip).toBe('1 item with a task or metric error · 11 tool or provider errors inside traces');
  });

  it('counts metric errors too (owner note)', () => {
    const rows = [
      row({
        item_id: 'a',
        status: 'completed',
        metric_meta: { relevance: { status: 'error', error: 'judge down' } },
      }),
      row({ item_id: 'b', status: 'completed' }),
    ];
    expect(navErrorCount(rows)).toMatchObject({
      items: 1,
      traceErrors: 0,
      tip: '1 item with a task or metric error',
    });
  });
});
