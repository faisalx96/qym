import { describe, expect, it } from 'vitest';
import {
  collectJsonPaths,
  coverPaths,
  metadataFields,
  metadataKey,
  pathsToTree,
  slotSource,
  toggleNode,
  nodeState,
} from '../mapping';
import { detectCustomVars } from '../vars';
import { rootCauseIssues } from '../rootCause';

const paths = (v: unknown) => {
  const s = new Set<string>();
  collectJsonPaths(v, '', s, 0);
  return [...s].sort();
};

describe('json paths', () => {
  it('collects object, nested and array paths', () => {
    expect(paths({ q: 'x', ctx: { docs: [{ id: 1, text: 't' }], tags: ['a'] } })).toEqual([
      'ctx.docs[].id',
      'ctx.docs[].text',
      'ctx.tags',
      'q',
    ]);
    expect(paths(['a', 'b'])).toEqual(['[]']);
  });

  it('builds a tree with [*] array nodes and tri-state selection', () => {
    const tree = pathsToTree(['ctx.docs[].id', 'ctx.docs[].text', 'q']);
    expect(tree.map((n) => n.label)).toEqual(['ctx', 'q']);
    const docs = tree[0].children[0];
    expect(docs.label).toBe('docs');
    expect(docs.children[0].label).toBe('[*]');
    let sel = new Set<string>();
    sel = toggleNode(docs.children[0].children[0], sel);
    expect(nodeState(tree[0], sel)).toBe('some');
    sel = toggleNode(docs, sel);
    expect(nodeState(tree[0], sel)).toBe('all');
    expect(coverPaths(tree, sel)).toEqual(['ctx']);
  });

  it('prunes to the shortest covering paths', () => {
    const tree = pathsToTree(['a.b', 'a.c', 'd']);
    const out = slotSource({ field: 'input', full: false, selected: ['a.b', 'a.c'] }, tree);
    expect(out).toEqual({ source: ['input.a'], custom: true });
    expect(slotSource({ field: 'input', full: true, selected: [] }, tree)).toEqual({ source: 'input', custom: false });
    expect(slotSource({ field: '', full: true, selected: [] }, tree)).toBeNull();
  });

  it('metadata fields are null until something is deselected', () => {
    const groups = [{ metric: 'm.x', paths: ['verdict', 'detail.score'] }];
    expect(metadataFields(groups, { deselected: [] })).toBeNull();
    expect(metadataFields(groups, { deselected: [metadataKey('m.x', 'verdict')] })).toEqual([
      'metric_metadata:m%2Ex.detail',
    ]);
  });
});

describe('custom variables and root causes', () => {
  it('detects variables once and skips the reserved name', () => {
    expect(detectCustomVars('use {rubric} and {rubric} with {categories} and {ref_doc}')).toEqual([
      'rubric',
      'ref_doc',
    ]);
  });
  it('normalises the legacy single-cause shape', () => {
    expect(rootCauseIssues({ root_cause: 'Retrieval', root_cause_detail: 'Missing', confidence: 2 })).toEqual([
      { category: 'Retrieval', subcategory: 'Missing', finding: '', category_reason: '', confidence: 1 },
    ]);
  });
});
