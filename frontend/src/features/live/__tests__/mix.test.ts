import { describe, expect, it } from 'vitest';
import type { LiveMetricSpec } from '@/api/live';
import { diagnosisColors, mixSegments, verdictOf } from '../lib/mix';

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
      {
        value: 'ok',
        label: 'OK',
        tone: 'success',
        color: 'var(--success)',
        specTone: 'accent',
        dark: false,
        n: 6,
        share: 0.75,
      },
      {
        value: 'problem',
        label: 'Problem',
        tone: 'danger',
        color: 'var(--error)',
        specTone: 'danger',
        dark: false,
        n: 2,
        share: 0.25,
      },
      {
        value: 'other',
        label: 'Other',
        tone: 'neutral',
        color: 'var(--text-muted)',
        specTone: 'neutral',
        dark: false,
        n: 0,
        share: 0,
      },
    ]);
    expect(segments.reduce((total, segment) => total + segment.share, 0)).toBe(1);
  });

  it('uses blue and purple for info and meta distributions without changing verdict styling', () => {
    const segments = mixSegments(
      { r: 1, u: 1 },
      {
        ...spec,
        values: [
          { value: 'r', label: 'Refused', tone: 'info' },
          { value: 'u', label: 'Unanswerable', tone: 'meta' },
        ],
      },
    );
    expect(segments.map(({ value, tone, dark }) => ({ value, tone, dark }))).toEqual([
      { value: 'r', tone: 'neutral', dark: false },
      { value: 'u', tone: 'neutral', dark: true },
    ]);
    expect(segments.map((segment) => segment.color)).toEqual(['var(--chart-1)', 'var(--accent-tertiary)']);
  });

  it('maps Refused and Unanswerable to grey state tags', () => {
    expect(verdictOf('info')).toEqual({ tone: 'neutral', dark: false });
    expect(verdictOf('meta')).toEqual({ tone: 'neutral', dark: true });
  });

  it('puts unknown labels last with neutral tone and includes them in the denominator', () => {
    const segments = mixSegments({ new_label: 2, ok: 2 }, spec);
    expect(segments.at(-1)).toEqual({
      value: 'new_label',
      label: 'new_label',
      tone: 'neutral',
      specTone: undefined,
      dark: false,
      color: 'var(--text-muted)',
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

describe('diagnosisColors', () => {
  it('assigns the six spec tones distinct colours in fixed value order', () => {
    const values = ['accent', 'warning', 'danger', 'info', 'meta', 'neutral'].map((tone) => ({
      value: tone,
      tone,
    }));
    const six = { ...spec, values };
    expect([...diagnosisColors(six).values()]).toEqual([
      'var(--success)',
      'var(--warning)',
      'var(--error)',
      'var(--chart-1)',
      'var(--accent-tertiary)',
      'var(--text-muted)',
    ]);
    const first = mixSegments({ accent: 5, warning: 1, meta: 2 }, six);
    const next = mixSegments({ neutral: 9, warning: 20, meta: 0 }, six);
    expect(first.map(({ value, color }) => ({ value, color }))).toEqual(
      next.map(({ value, color }) => ({ value, color })),
    );
  });

  it('uses the next unused fallback for repeated tones, including success and accent', () => {
    const repeated = {
      ...spec,
      values: [
        { value: 'ok', tone: 'success' },
        { value: 'refused', tone: 'accent' },
        { value: 'other', tone: 'success' },
        { value: 'another', tone: 'success' },
        { value: 'warning', tone: 'warning' },
      ],
    };
    expect([...diagnosisColors(repeated).values()]).toEqual([
      'var(--success)',
      'var(--chart-5)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--warning)',
    ]);
    expect(mixSegments({ refused: 10 }, repeated).find((segment) => segment.value === 'refused')?.color).toBe(
      'var(--chart-5)',
    );
  });
});
