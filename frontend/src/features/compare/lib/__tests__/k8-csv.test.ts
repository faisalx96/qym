/** K8 (C210): CSV presets and the change-vs-baseline column. */
import { describe, expect, it } from 'vitest';
import { buildCompareCsv, discoverExportColumns, exportCell, presetKeys } from '../csv';
import { buildCompareModel } from '../model';
import { makePayload } from './fixtures';

const scores = { i1: { correct: 1, quality: 0.9 }, i2: { correct: 0, quality: 0.3 } };

function setup() {
  const payload = makePayload([
    { id: 'base', name: 'run-base', scores },
    {
      id: 'cand',
      name: 'run-cand',
      scores: { i1: { correct: 1, quality: 0.95 }, i2: { correct: 1, quality: 0.5 } },
    },
  ]);
  const model = buildCompareModel(payload, ['base', 'cand']);
  const items = model.itemIds.map((itemId) => ({
    itemId,
    rows: model.runs.map((r) => r.byItem.get(itemId) ?? null),
  }));
  return { model, items, groups: discoverExportColumns(model, items, 0) };
}

describe('the CSV export (C210)', () => {
  it('gives each non-baseline run a change-vs-baseline column per metric', () => {
    const { model, items, groups } = setup();
    const cand = groups.find((g) => g.group === 'run-cand')!;
    expect(cand.columns.map((c) => c.label)).toContain('quality change vs baseline');
    expect(groups.find((g) => g.group === 'run-base')!.columns.map((c) => c.label)).not.toContain(
      'quality change vs baseline',
    );
    expect(exportCell(model, items[0]!, 'run:1:chg:0:quality')).toBe('0.05');
    expect(exportCell(model, items[1]!, 'run:1:chg:0:quality')).toBe('0.2');
  });

  it("'Scores and change' ticks the id, the input, each score and the change on the page metric", () => {
    const { groups } = setup();
    expect([...presetKeys(groups, 'scores', 'quality')].sort()).toEqual(
      ['input', 'item_id', 'run:0:quality_score', 'run:1:chg:0:quality', 'run:1:quality_score'].sort(),
    );
    const outputs = presetKeys(groups, 'outputs', 'quality');
    expect(outputs.has('run:0:output')).toBe(true);
    expect(presetKeys(groups, 'everything', 'quality').size).toBe(groups.flatMap((g) => g.columns).length);
  });

  it('names each run group by its run name in the CSV header', () => {
    const { model, items } = setup();
    const csv = buildCompareCsv(model, items, [
      { key: 'run:1:quality_score', label: 'quality score', checked: true },
    ]);
    expect(csv.split('\n')[0]).toContain('run-cand / quality score');
  });
});
