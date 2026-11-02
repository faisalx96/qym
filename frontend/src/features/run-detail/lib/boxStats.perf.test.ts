/** Round 3 P7-16: computing the box statistics of 26 metrics x 5,200 values stays far inside the 50 ms budget. */
import { describe, expect, it } from 'vitest';
import { boxStats } from './boxStats';

describe('boxStats cost', () => {
  it('26 x 5,200 values in under 50 ms', () => {
    let seed = 1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const columns = Array.from({ length: 26 }, () => Array.from({ length: 5200 }, rnd));
    const t0 = performance.now();
    const out = columns.map((c) => boxStats(c));
    const ms = performance.now() - t0;
    expect(out).toHaveLength(26);
    expect(ms).toBeLessThan(50);
  });
});
