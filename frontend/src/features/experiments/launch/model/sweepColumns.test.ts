import { describe, expect, it } from 'vitest';
import { LINKED_GROUP, sweepAxesText, sweepColumns, sweepLines, sweepValue } from './sweepColumns';

const LABELS: Record<string, string> = {
  '/slot_bindings/endpoint:primary': 'Primary model',
  '/env_overrides/MILVUS_SEARCH_THRESHOLD': 'Milvus Search Threshold',
  '/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout': 'Endpoints › primary › Timeout',
  '/env_overrides/LLM_OVERRIDES/endpoints/judge/timeout': 'Endpoints › judge › Timeout',
};
const labelOf = (p: string) => LABELS[p] ?? p;
const AXES = [
  {
    pointers: ['/slot_bindings/endpoint:primary', '/env_overrides/MILVUS_SEARCH_THRESHOLD'],
    linked: true,
    values: [
      [{ connection_id: 'c1', name: 'gpt-4o prod', model: 'gpt-4o' }, 0.5],
      [{ connection_id: 'c2', name: 'claude-sonnet eval', model: 'claude-sonnet' }, 0.7],
    ],
  },
  { pointers: ['/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout'], linked: false, values: [[10], [30], [60]] },
];

describe('sweepColumns (round 10, point 2)', () => {
  it('one column per pointer in axis order, named by the last label segment, a band over a linked axis', () => {
    const cols = sweepColumns(AXES, labelOf);
    expect(cols.map((c) => c.name)).toEqual(['Primary model', 'Milvus Search Threshold', 'Timeout']);
    expect(cols.map((c) => c.section)).toEqual([undefined, undefined, undefined]);
    expect(cols.map((c) => c.group)).toEqual([LINKED_GROUP, LINKED_GROUP, undefined]);
    expect(cols.map((c) => c.mono)).toEqual([false, true, true]);
    expect(cols.map((c) => c.axis)).toEqual([0, 0, 1]);
  });

  it('adds the section only when two columns share a name', () => {
    const cols = sweepColumns(
      [
        { pointers: ['/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout'], linked: false, values: [[1], [2]] },
        { pointers: ['/env_overrides/LLM_OVERRIDES/endpoints/judge/timeout'], linked: false, values: [[1], [2]] },
      ],
      labelOf,
    );
    expect(cols.map((c) => [c.name, c.section, c.label])).toEqual([
      ['Timeout', 'Endpoints › primary', 'Timeout (Endpoints › primary)'],
      ['Timeout', 'Endpoints › judge', 'Timeout (Endpoints › judge)'],
    ]);
  });

  it('formats a value as the user picked it', () => {
    expect(sweepValue({ connection_id: 'c1', name: 'gpt-4o prod', model: 'gpt-4o' })).toBe('gpt-4o prod');
    expect(sweepValue({ connection_id: 'c1' }, (id) => (id === 'c1' ? 'from options' : undefined))).toBe('from options');
    expect(sweepValue({ connection_id: 'c9', model: 'gpt-4o' })).toBe('gpt-4o');
    expect(sweepValue({ connection_id: 'c9' })).toBe('c9');
    expect(sweepValue({ temporary: { model: 'llama-3' } })).toBe('temporary: llama-3');
    expect(sweepValue(null)).toBe('inherit');
    expect(sweepValue({ inherit: true })).toBe('inherit');
    expect(sweepValue(0.5)).toBe('0.5');
    expect(sweepValue(false)).toBe('false');
    expect(sweepValue('fast')).toBe('fast');
    expect(sweepValue({ a: 1 })).toBe('{"a":1}');
  });

  it('gives the Summary one line per axis and the Changes card the axes by name', () => {
    expect(sweepLines(AXES, labelOf)).toEqual([
      {
        names: ['Primary model', 'Milvus Search Threshold'],
        values: [
          ['gpt-4o prod', '0.5'],
          ['claude-sonnet eval', '0.7'],
        ],
        mono: [false, true],
        linked: true,
      },
      { names: ['Timeout'], values: [['10'], ['30'], ['60']], mono: [true], linked: false },
    ]);
    expect(sweepAxesText(AXES, labelOf)).toBe('Primary model + Milvus Search Threshold (linked), Timeout');
  });
});
