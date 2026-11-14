import { describe, expect, it } from 'vitest';
import { keyNodes, metadataTree, pathsToTree, slotSource } from '../mapping';
import { changedLines } from '../promptDiff';

describe('cv5 K2: key chips of a mapping row', () => {
  it('offers the top-level keys of an object, also an object with one key', () => {
    expect(keyNodes(pathsToTree(['question', 'schema'])).map((n) => n.label)).toEqual(['question', 'schema']);
    expect(keyNodes(pathsToTree(['sql'])).map((n) => n.label)).toEqual(['sql']);
    expect(keyNodes(pathsToTree(['ctx.docs', 'q'])).map((n) => n.path)).toEqual(['ctx', 'q']);
  });

  it('offers no keys for a single value or a list of single values', () => {
    expect(keyNodes([])).toEqual([]);
    expect(keyNodes(pathsToTree(['[]']))).toEqual([]);
  });

  it('offers the item keys of a list of objects', () => {
    expect(keyNodes(pathsToTree(['[].id', '[].text'])).map((n) => n.path)).toEqual(['[].id', '[].text']);
  });

  it('builds one metadata key tree from the selected metrics only', () => {
    const groups = [
      { metric: 'a', paths: ['judge', 'reason'] },
      { metric: 'b', paths: ['duration_ms', 'reason'] },
    ];
    expect(metadataTree(groups, ['a', 'b']).map((n) => n.label)).toEqual(['duration_ms', 'judge', 'reason']);
    expect(metadataTree(groups, ['b']).map((n) => n.label)).toEqual(['duration_ms', 'reason']);
    expect(metadataTree(groups, [])).toEqual([]);
  });

  it('sends metric metadata keys, and the full value when the chosen keys are gone', () => {
    const tree = pathsToTree(['judge', 'reason']);
    expect(slotSource({ field: 'metric_metadata', full: false, selected: ['reason'] }, tree)).toEqual({
      source: ['metric_metadata.reason'],
      custom: true,
    });
    expect(slotSource({ field: 'input', full: false, selected: ['gone'] }, pathsToTree(['q']))).toEqual({
      source: 'input',
      custom: false,
    });
  });
});

describe('cv5 K3: what a change did to the prompt', () => {
  const msg = (content: string, role = 'user') => ({ role, content });

  it('marks added lines and counts removed lines, blank lines aside', () => {
    const before = [msg('rules\nA\n\nB', 'system'), msg('input\nX')];
    const after = [msg('rules\nB\n\nC\nD', 'system'), msg('input\nX')];
    const change = changedLines(before, after);
    expect([...change.added[0]!]).toEqual([3, 4]);
    expect(change.added[1]!.size).toBe(0);
    expect(change.addedCount).toBe(2);
    expect(change.removedCount).toBe(1);
  });

  it('does not count a moved line, and counts each copy of a repeated line', () => {
    expect(changedLines([msg('a\nb')], [msg('b\na')]).addedCount).toBe(0);
    const twice = changedLines([msg('a')], [msg('a\na')]);
    expect(twice.addedCount).toBe(1);
    expect([...twice.added[0]!]).toEqual([1]);
  });

  it('counts the lines of a message that is gone or that changed its role', () => {
    expect(changedLines([msg('s', 'system'), msg('u1\nu2')], [msg('s', 'system')]).removedCount).toBe(2);
    const swapped = changedLines([msg('x', 'system')], [msg('x', 'user')]);
    expect(swapped.addedCount).toBe(1);
    expect(swapped.removedCount).toBe(1);
  });
});
