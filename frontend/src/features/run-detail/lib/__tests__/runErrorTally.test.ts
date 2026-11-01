/** RF2 (C097): the task errors a failed run's notice counts. */
import { describe, expect, it } from 'vitest';
import type { Row } from '../../types';
import { runErrorTally } from '../overviewModel';

const row = (over: Partial<Row>) => ({ item_id: 'i', status: 'completed', ...over }) as Row;

describe('runErrorTally', () => {
  it('counts items with an error in at least one pass, and the errored passes of a repeat run', () => {
    const rows = [
      row({ item_id: 'a', execution_error_count: 3 }),
      row({ item_id: 'b', execution_error_count: 0 }),
      row({ item_id: 'c', execution_error_count: 1 }),
    ];
    expect(runErrorTally(rows, true)).toEqual({ items: 2, total: 3, passes: 4, repeat: true });
  });

  it('a single-pass run counts its errored rows', () => {
    const rows = [row({ item_id: 'a', status: 'error', error: 'boom' }), row({ item_id: 'b' })];
    expect(runErrorTally(rows, false)).toMatchObject({ items: 1, total: 2, passes: 1, repeat: false });
  });
});
