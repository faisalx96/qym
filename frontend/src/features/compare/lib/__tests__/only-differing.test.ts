import { describe, expect, it } from 'vitest';
import type { Row } from '@/features/run-detail/types';
import { visibleWhenOnlyDiffering } from '../filters';

const row = (output: string) => ({ item_id: 'i', output }) as unknown as Row;

describe('visibleWhenOnlyDiffering', () => {
  it('hides runs that answer like the baseline and keeps the baseline and the others', () => {
    const rows = [row('a'), row('a'), row('b'), null];
    expect(visibleWhenOnlyDiffering(rows, 0)).toEqual([true, false, true, true]);
  });
  it('follows a baseline that is not first', () => {
    expect(visibleWhenOnlyDiffering([row('a'), row('b'), row('b')], 2)).toEqual([true, false, true]);
  });
});
