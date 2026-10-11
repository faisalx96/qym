import { describe, expect, it } from 'vitest';
import { buildCompareModel } from '../model';
import { expandRefs, normalizeCohorts, passRefBase, passRefNumber, readSelection, makePassRef, selectionParams } from '../refs';
import { computeRunLabels, stripSharedPrefix } from '../labels';
import { makePayload } from './fixtures';

const S = (o: Record<string, number | number[] | 'error'>) => o;

describe('refs', () => {
  it('parses pass refs', () => {
    expect(passRefBase('abc::pass3')).toBe('abc');
    expect(passRefNumber('abc::pass3')).toBe(3);
    expect(passRefNumber('abc')).toBeNull();
    expect(passRefNumber('abc::passx')).toBeNull();
    expect(makePassRef('abc', 2)).toBe('abc::pass2');
  });
  it('selection precedence: cohorts > runs > session cohorts > session runs', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    store.set('compareRuns', JSON.stringify(['s1', 's2']));
    expect(readSelection(new URLSearchParams(''), storage)).toMatchObject({ refs: ['s1', 's2'], source: 'session' });
    store.set('compareCohorts', JSON.stringify({ left: ['l1'], right: ['r1'], leftLabel: 'L', rightLabel: 'R' }));
    expect(readSelection(new URLSearchParams(''), storage).cohorts?.leftLabel).toBe('L');
    expect(readSelection(new URLSearchParams('runs=a&runs=b&runs=a'), storage)).toMatchObject({ refs: ['a', 'b'], cohorts: null, source: 'url' });
    const q = new URLSearchParams('cohortA=a&cohortA=b&cohortB=c&cohortB=d&cohortALabel=X');
    const sel = readSelection(q, storage);
    expect(sel.refs).toEqual(['a', 'b', 'c', 'd']);
    expect(sel.cohorts).toMatchObject({ leftLabel: 'X', rightLabel: '' });
    expect(readSelection(new URLSearchParams('runs=a'), { getItem: () => null }).source).toBe('none');
  });
  it('cohorts must be paired', () => {
    expect(normalizeCohorts({ left: ['a'], right: ['b', 'c'] })).toBeNull();
    expect(selectionParams([], normalizeCohorts({ left: ['a'], right: ['b'] })).getAll('cohortA')).toEqual(['a']);
  });
  it('expands a whole repeat run into passes and drops unknown runs', () => {
    const loaded = [{ run_id: 'r', samples: 3 }, { run_id: 's', samples: 1 }];
    expect(expandRefs(['r', 's::pass1', 'zzz', 'r::pass2'], loaded)).toEqual(['r::pass1', 'r::pass2', 'r::pass3', 's::pass1']);
  });
});

describe('labels', () => {
  it('strips the shared run-name prefix at a separator', () => {
    expect(stripSharedPrefix(['eval-v2-gpt', 'eval-v2-claude'])).toEqual(['gpt', 'claude']);
    expect(stripSharedPrefix(['a', 'b'])).toBeNull();
  });
  it('uses model and date otherwise and numbers duplicates', () => {
    const labels = computeRunLabels(
      [
        { base: '1', name: 'x', model: 'm', started: '2026-10-01T10:00:00Z' },
        { base: '2', name: 'y', model: 'm', started: '2026-10-01T10:00:00Z' },
        { base: '3', name: 'z', model: 'n', started: '2026-10-02T10:00:00Z' },
      ],
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(labels['1']!.label).toMatch(/^m · Oct 1 .* #1$/);
    expect(labels['2']!.label).toMatch(/#2$/);
    expect(labels['3']!.label).toBe('n · Oct 2');
  });
});

describe('buildCompareModel', () => {
  const payload = makePayload([
    { id: 'r1', name: 'base', model: 'm1', scores: { i1: S({ correct: 1, quality: 0.9 }), i2: S({ correct: 0, quality: 0.2 }) } },
    { id: 'rep', name: 'rep', model: 'm1', samples: 3, scores: { i1: S({ correct: [1, 0, 1], quality: [0.9, 0.4, 0.8] }), i2: S({ correct: [0, 0, 0], quality: [0.1, 0.2, 0.3] }) } },
  ]);
  it('slices a repeat run into one pseudo-run per pass', () => {
    const m = buildCompareModel(payload, ['r1', 'rep']);
    expect(m.runs.map((r) => r.ref)).toEqual(['r1', 'rep::pass1', 'rep::pass2', 'rep::pass3']);
    const p2 = m.runs[2]!;
    expect(p2.run.samples).toBe(1);
    expect(p2.run.pass_number).toBe(2);
    expect(p2.byItem.get('i1')!.metric_values).toEqual([0, 0.4]);
    expect(p2.label).toMatch(/pass 2$/);
    expect(m.itemIds).toEqual(['i1', 'i2']);
    expect(m.defaultMetric).toBe('quality');
    expect(m.directions.correct).toBe('maximize');
    expect(m.isBoolean.correct).toBe(true);
  });
  it('keeps an explicit pass and skips runs the server did not return', () => {
    const m = buildCompareModel(payload, ['r1', 'rep::pass2', 'gone']);
    expect(m.runs.map((r) => r.ref)).toEqual(['r1', 'rep::pass2']);
    expect(m.bases).toEqual(['r1', 'rep']);
  });
});
