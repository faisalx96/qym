/** Round 3 P5: default three passes, the oldest yields to a fourth, the selection is never empty. */
import { describe, expect, it } from 'vitest';
import { defaultSelection, shownPasses, togglePass } from './passSelection';

describe('passSelection', () => {
  it('defaults to passes 1 to 3, or all when fewer', () => {
    expect(defaultSelection(10)).toEqual([1, 2, 3]);
    expect(defaultSelection(2)).toEqual([1, 2]);
    expect(defaultSelection(1)).toEqual([1]);
  });

  it('selecting a fourth pass replaces the oldest selection', () => {
    expect(togglePass([1, 2, 3], 7)).toEqual([2, 3, 7]);
    expect(togglePass([2, 3, 7], 1)).toEqual([3, 7, 1]);
  });

  it('deselects a pass but never the last one', () => {
    expect(togglePass([1, 2, 3], 2)).toEqual([1, 3]);
    expect(togglePass([4], 4)).toEqual([4]);
  });

  it('shows the selected passes in order', () => {
    expect(shownPasses([7, 1, 3])).toEqual([1, 3, 7]);
  });
});
