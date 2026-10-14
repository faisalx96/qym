import { describe, expect, it } from 'vitest';
import { defaultPageSize } from '../itemsPaging';

describe('defaultPageSize', () => {
  it('keeps 20 rows for ordinary runs and opens a thousand-item run at 100', () => {
    expect(defaultPageSize(0)).toBe(20);
    expect(defaultPageSize(240)).toBe(20);
    expect(defaultPageSize(999)).toBe(20);
    expect(defaultPageSize(2747)).toBe(100);
  });
});
