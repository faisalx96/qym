import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { setGlobalSweep, sharedSweep, startGlobalSweep, stopGlobalSweep } from './globalSweep';
import { setValue } from './layering';
import type { DescriptorEntry } from './types';

const entry = { kind: 'field', type: 'integer', name: 'max_tokens' } as unknown as DescriptorEntry;
const targets = ['/LLM_OVERRIDES/a/max_tokens', '/LLM_OVERRIDES/b/max_tokens', '/LLM_OVERRIDES/c/max_tokens'];

describe('global sweep (one value list for every target, one run per value)', () => {
  it('writes the same sweep to every target and links them as one zipped group', () => {
    const doc = setGlobalSweep(createDocument(), targets, [256, 512]);
    for (const p of targets) expect(doc.values[p]).toEqual({ sweep: [256, 512] });
    expect(doc.links).toEqual([targets.map((p) => '/env_overrides' + p)]);
    expect(sharedSweep(doc, targets)).toEqual([256, 512]);
  });

  it('starts from the shared value, and from both options for a boolean', () => {
    const doc = startGlobalSweep(createDocument(), entry, targets, 128);
    expect(sharedSweep(doc, targets)).toEqual([128]);
    const bool = { kind: 'field', type: 'boolean', name: 'x' } as unknown as DescriptorEntry;
    expect(sharedSweep(startGlobalSweep(createDocument(), bool, targets, undefined), targets)).toEqual([
      true,
      false,
    ]);
  });

  it('a single target is swept without a link; targets that differ share no sweep', () => {
    const one = setGlobalSweep(createDocument(), [targets[0]!], [1, 2]);
    expect(one.links).toBeUndefined();
    const mixed = setValue(setGlobalSweep(createDocument(), targets, [1, 2]), targets[1]!, { sweep: [9] });
    expect(sharedSweep(mixed, targets)).toBeUndefined();
  });

  it('single value keeps the first value and drops only its own group', () => {
    const other = ['/X/a', '/X/b'];
    let doc = setGlobalSweep(createDocument(), other, [1, 2]);
    doc = setGlobalSweep(doc, targets, [256, 512]);
    expect(doc.links).toHaveLength(2);
    doc = stopGlobalSweep(doc, targets);
    for (const p of targets) expect(doc.values[p]).toBe(256);
    expect(doc.links).toEqual([other.map((p) => '/env_overrides' + p)]);
  });
});
