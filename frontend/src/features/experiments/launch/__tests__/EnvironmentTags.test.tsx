import { describe, expect, it } from 'vitest';
import { shapeTag } from '../entry/EnvironmentPicker';

/** What a ticked environment's box says it receives (QD-20, QD-21). */
describe('shapeTag', () => {
  it('says nothing for a single dataset version', () => {
    expect(shapeTag(1, 'combined', true)).toBeNull();
    expect(shapeTag(1, 'one_each', false)).toBeNull();
  });
  it('a service that takes a list gets one combined run', () => {
    expect(shapeTag(4, 'combined', true)).toEqual({ text: '1 combined run', tone: 'info' });
  });
  it('an older service gets one run per dataset version, with a warning', () => {
    expect(shapeTag(4, 'combined', false)).toEqual({
      text: '4 runs, one per dataset version (older service)',
      tone: 'warning',
    });
  });
  it('One run each is the same for every service', () => {
    const expected = { text: '4 runs, one per dataset version', tone: 'info' };
    expect(shapeTag(4, 'one_each', true)).toEqual(expected);
    expect(shapeTag(4, 'one_each', false)).toEqual(expected);
  });
});
