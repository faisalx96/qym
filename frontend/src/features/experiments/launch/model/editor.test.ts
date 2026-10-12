import { describe, expect, it } from 'vitest';
import { makeCtx, PRODUCTION } from './__fixtures__/fixtures';
import { setBinding } from './bindings';
import { createDocument } from './document';
import {
  editorReviewItems,
  layerConfigAsEdits,
  NOTES_MAX,
  presetConfigKey,
  promoteWarningLines,
  publishBlocker,
  publishFailure,
  unresolvedRebind,
  type PublishGate,
} from './editor';
import { applyBase, baselineFrom, diffCount, scratchBase } from './layering';
import type { LaunchConfig, LaunchDocument } from './types';
import { reviewState } from './validation';

const ctx = makeCtx();
const baseConfig: LaunchConfig = {
  evaluator: { dataset: 'support-qa' },
  slot_bindings: { 'endpoint:primary': { connection_id: 'conn-prod' } },
  env_overrides: { SQL_RESULT_LIMIT: 50 },
};

function editorDoc(config: LaunchConfig = baseConfig): LaunchDocument {
  const loaded = {
    base: baselineFrom(config, ctx),
    info: {
      ...scratchBase(ctx).info,
      kind: 'official-edit' as const,
      label: 'Default preset v2',
      loaded: true,
    },
  };
  return applyBase(createDocument({ environmentIds: [PRODUCTION] }), ctx, loaded).doc;
}

describe('requireChange (unchanged vs the current version)', () => {
  it('has the same config key until something changes', () => {
    const d = editorDoc();
    const key = presetConfigKey(d, 'h', ctx.evaluatorPanel);
    expect(presetConfigKey(d, 'h', ctx.evaluatorPanel)).toBe(key);
    const edited = { ...d, values: { ...d.values, '/SQL_RESULT_LIMIT': 60 } };
    expect(presetConfigKey(edited, 'h', ctx.evaluatorPanel)).not.toBe(key);
    expect(diffCount(edited).total).toBe(1);
  });

  it('a draft from another version counts as edits on top of the current one', () => {
    const d = editorDoc();
    const draft = layerConfigAsEdits(d, ctx, {
      ...baseConfig,
      env_overrides: { SQL_RESULT_LIMIT: 10 },
    });
    expect(diffCount(draft).total).toBe(1);
    expect(presetConfigKey(draft, 'h', ctx.evaluatorPanel)).not.toBe(
      presetConfigKey(d, 'h', ctx.evaluatorPanel),
    );
  });
});

describe('rebind slots (promote from a temporary model)', () => {
  const rebind = [{ slot_key: 'endpoint:primary', label: 'My temp', model: 'gpt-x' }];
  it('stay unresolved until a project model is bound', () => {
    const d = layerConfigAsEdits(editorDoc(), ctx, { ...baseConfig, slot_bindings: {} });
    expect(unresolvedRebind(rebind, d)).toEqual(rebind);
    const bound = setBinding(d, ctx, 'endpoint:primary', { kind: 'connection', id: 'conn-prod' });
    expect(unresolvedRebind(rebind, bound)).toEqual([]);
  });

  it('become a problem item pointing at the slot', () => {
    const d = layerConfigAsEdits(editorDoc(), ctx, { ...baseConfig, slot_bindings: {} });
    const items = editorReviewItems([], d, ctx, rebind);
    expect(items).toHaveLength(1);
    expect(items[0]!.pointer).toBe('/slot_bindings/endpoint:primary');
    expect(items[0]!.message).toMatch(/Pick a project model for endpoint:primary/);
  });

  it('a temporary model outside the rebind list is refused too', () => {
    const d = setBinding(editorDoc(), ctx, 'endpoint:primary', {
      kind: 'temporary',
      model: 'm',
      secretRef: null,
      save: false,
      needsKey: false,
    });
    const items = editorReviewItems([], d, ctx, []);
    expect(items.map((i) => i.message).join(' ')).toMatch(/temporary models cannot be published/);
  });
});

describe('editor review items', () => {
  it('drops the launch-only checks (name, dataset) and keeps the rest', () => {
    const d = editorDoc({ ...baseConfig, evaluator: {} });
    const base = reviewState({ doc: d, ctx });
    expect(base.items.some((i) => i.pointer === '#name')).toBe(true);
    expect(base.items.some((i) => i.pointer === '/evaluator/dataset')).toBe(true);
    expect(editorReviewItems(base.items, d, ctx, [])).toEqual([]);
  });
});

describe('publishBlocker', () => {
  const ok: PublishGate = {
    loaded: true,
    problems: 0,
    requireChange: true,
    unchanged: false,
    baseLabel: 'Default preset v2',
    notes: 'Why',
  };
  it('is empty only when loaded, valid, changed and noted', () => {
    expect(publishBlocker(ok)).toBe('');
  });
  it('disables Publish without notes, without a change, with problems or while loading', () => {
    expect(publishBlocker({ ...ok, notes: '   ' })).toMatch(/Release notes are required/);
    expect(publishBlocker({ ...ok, unchanged: true })).toBe('No changes from Default preset v2 yet.');
    expect(publishBlocker({ ...ok, problems: 2 })).toBe('2 problems to fix');
    expect(publishBlocker({ ...ok, loaded: false })).toBe('Loading…');
    expect(publishBlocker({ ...ok, notes: 'x'.repeat(NOTES_MAX + 1) })).toMatch(/at most 5000/);
  });
  it('the first version needs no change, only notes', () => {
    expect(publishBlocker({ ...ok, requireChange: false, unchanged: true })).toBe('');
  });
});

describe('publishFailure', () => {
  it('403 is a clear managers-only message', () => {
    expect(publishFailure(403, 'nope', [])).toMatchObject({
      kind: 'forbidden',
      message: 'Only project managers publish the default preset.',
    });
  });
  it('409 asks to reopen', () => {
    const out = publishFailure(409, 'The default preset changed', []);
    expect(out.kind).toBe('conflict');
    expect(out.kind === 'conflict' && out.message).toMatch(/Reload the editor/);
  });
  it('422 keeps the pointer errors', () => {
    expect(publishFailure(422, 'bad', [{ pointer: '/x', message: 'm' }]).kind).toBe('invalid');
  });
});

describe('promoteWarningLines', () => {
  it('lists dropped settings, remap errors, server warnings and unbound slots', () => {
    const lines = promoteWarningLines({
      source: { label: 'Run “r1”' },
      config: {},
      remap: { config: {}, dropped: [{ pointer: '/A', label: 'A', message: 'gone' }], errors: ['bad'] },
      warnings: [{ message: 'careful' }],
      unbound: [{ slot_key: 'endpoint:primary', model: 'gpt-x' }],
    });
    expect(lines).toEqual([
      'Run “r1”: A was dropped (gone).',
      'Run “r1”: bad',
      'careful',
      'Rebind endpoint:primary: it used temporary model gpt-x. Pick a project model before publishing.',
    ]);
  });
});
