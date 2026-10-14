import { describe, expect, it } from 'vitest';
import { uniqueBestRun } from '../rowCells';

const ok = ['pass', 'pass', 'fail'] as const;

describe('uniqueBestRun', () => {
  it('picks the unique highest score for maximize and the lowest for minimize', () => {
    expect(uniqueBestRun([0.2, 0.9, 0.5], ok, 'maximize')).toBe(1);
    expect(uniqueBestRun([0.2, 0.9, 0.5], ok, 'minimize')).toBe(0);
  });
  it('returns null on ties, errors, one score or no direction', () => {
    expect(uniqueBestRun([0.9, 0.9, 0.5], ok, 'maximize')).toBeNull();
    expect(uniqueBestRun([0.2, 0.9, 0.5], ['pass', 'error', 'pass'], 'maximize')).toBeNull();
    expect(uniqueBestRun([0.2, null, null], ok, 'maximize')).toBeNull();
    expect(uniqueBestRun([0.2, 0.9], ok, null)).toBeNull();
  });
});
