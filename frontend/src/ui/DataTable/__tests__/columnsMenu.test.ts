import { describe, expect, it } from 'vitest';
import { moveItem } from '../ColumnsMenu';

const LINE = '\u0000line';

describe('moveItem (columns menu drag)', () => {
  it('moves an item to an index of the resulting list', () => {
    expect(moveItem(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
  it('crossing the freeze line changes which side an item is on', () => {
    const list = ['run', 'status', LINE, 'date', 'task'];
    const down = moveItem(list, 'status', 2);
    expect(down.indexOf('status')).toBeGreaterThan(down.indexOf(LINE));
    const up = moveItem(list, 'date', 1);
    expect(up.indexOf('date')).toBeLessThan(up.indexOf(LINE));
  });
  it('ignores unknown ids and clamps the index', () => {
    expect(moveItem(['a', 'b'], 'x', 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 'a', 9)).toEqual(['b', 'a']);
  });
});
