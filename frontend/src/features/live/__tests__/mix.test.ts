import { describe, expect, it } from 'vitest';
import type { LiveMetricSpec } from '@/api/live';
import { mixSegments } from '../lib/mix';

const spec: LiveMetricSpec = {
  metric_name: 'diagnosis',
  group: 'diagnosis',
  label: 'Diagnosis',
  score_type: 'categorical',
  direction: null,
  pass_threshold: null,
  unit: null,
  precision: null,
  is_primary: false,
  position: 0,
  description: null,
  values: [
    { value: 'ok', label: 'OK', tone: 'accent' },
    { value: 'problem', label: 'Problem', tone: 'danger' },
    { value: 'other', label: 'Other', tone: 'neutral' },
  ],
};

describe('mixSegments', () => {
  it('uses spec order, labels and tones with shares totaling one', () => {
    const segments = mixSegments({ problem: 2, ok: 6 }, spec);
    expect(segments).toEqual([
      { value: 'ok', label: 'OK', tone: 'accent', n: 6, share: 0.75 },
      { value: 'problem', label: 'Problem', tone: 'danger', n: 2, share: 0.25 },
      { value: 'other', label: 'Other', tone: 'neutral', n: 0, share: 0 },
    ]);
    expect(segments.reduce((total, segment) => total + segment.share, 0)).toBe(1);
  });

  it('puts unknown labels last with neutral tone and includes them in the denominator', () => {
    const segments = mixSegments({ new_label: 2, ok: 2 }, spec);
    expect(segments.at(-1)).toEqual({
      value: 'new_label',
      label: 'new_label',
      tone: 'neutral',
      n: 2,
      share: 0.5,
    });
    expect(segments.reduce((total, segment) => total + segment.share, 0)).toBe(1);
    expect(mixSegments({ new_label: 2 }, null)[0]?.tone).toBe('neutral');
  });

  it('has no segments when the total is zero', () => {
    expect(mixSegments({}, spec)).toEqual([]);
    expect(mixSegments({ ok: 0 }, spec)).toEqual([]);
  });
});
