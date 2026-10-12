import { describe, expect, it } from 'vitest';
import { evaluatorPanel, makeCtx } from './__fixtures__/fixtures';
import { createDocument } from './document';
import {
  addMetaRow,
  alsoSent,
  applyEvaluatorEdits,
  baseValue,
  configChanged,
  configEditEntry,
  configValue,
  evaluatorChangedCount,
  evaluatorFields,
  evaluatorLocalErrors,
  isReservedKey,
  metadataState,
  metadataText,
  metaRowsOf,
  parseMetadataValue,
  platformOwnedList,
  removeAlsoSent,
  removeMetaRow,
  resetInputs,
  setConfig,
  setConfigInput,
  syncMetaSeed,
  unmatchedConfig,
  updateMetaRow,
} from './evaluator';
import type { LaunchDocument } from './types';

const panel = evaluatorPanel;
const ctx = makeCtx();
const entry = (name: string) => panel.descriptor.fields['/' + name]!;

function withBase(evaluatorExtra: LaunchDocument['evaluatorExtra']): LaunchDocument {
  return syncMetaSeed(createDocument({ evaluatorExtra }), panel);
}

const base = withBase({
  report_k: 5,
  config: { samples: 3, run_metadata: { team: 'search', qym_launch: 'x' }, odd_key: 1 },
});

describe('edits on top of the base inputs (B19)', () => {
  it('shows the base value until edited', () => {
    expect(configValue(base, 'samples')).toBe(3);
    expect(baseValue(base, 'samples')).toBe(3);
    expect(configChanged(base, 'samples')).toBe(false);
  });

  it('stores an edit, and nothing when set back to the base value', () => {
    const edited = setConfig(base, 'samples', 4);
    expect(edited.evaluator.config).toEqual({ samples: 4 });
    expect(configChanged(edited, 'samples')).toBe(true);
    expect(setConfig(edited, 'samples', 3).evaluator.config).toEqual({});
  });

  it('clearing a base input is a null edit that removes it from the spec', () => {
    const cleared = setConfig(base, 'samples', undefined);
    expect(cleared.evaluator.config).toEqual({ samples: null });
    expect(configValue(cleared, 'samples')).toBeUndefined();
    expect(configChanged(cleared, 'samples')).toBe(true);
    const out = applyEvaluatorEdits(cleared, { dataset: 'd', config: { samples: 3 } }, panel);
    expect((out['config'] as Record<string, unknown>)['samples']).toBeUndefined();
  });

  it('unsetting an input the base lacks leaves no edit', () => {
    expect(setConfig(createDocument(), 'timeout', undefined).evaluator.config).toEqual({});
  });

  it('parses control text; unparsable text stays as an invalid edit', () => {
    const doc = createDocument();
    const ok = setConfigInput(doc, entry('samples'), 'samples', '7');
    expect(ok.evaluator.config).toEqual({ samples: 7 });
    const bad = setConfigInput(ok, entry('samples'), 'samples', 'x');
    expect(bad.evaluator.invalid['samples']).toMatchObject({ message: 'Enter a number', raw: 'x' });
    expect(bad.evaluator.config).toEqual({});
    expect(evaluatorLocalErrors(bad, panel)).toEqual([
      { pointer: '/evaluator/config/samples', message: 'samples: Enter a number' },
    ]);
    expect(setConfigInput(bad, entry('samples'), 'samples', '').evaluator.invalid).toEqual({});
  });

  it('edits a value that does not fit as JSON', () => {
    const doc = setConfig(createDocument(), 'samples', { weird: true });
    expect(configEditEntry(doc, entry('samples'), 'samples').type).toBe('json');
  });

  it('counts changed inputs, run_metadata as one', () => {
    expect(evaluatorChangedCount(base, panel)).toBe(0);
    const d = updateMetaRow(
      setConfig(base, 'samples', 9),
      metaRowsOf(base, panel)[0]!.id,
      { raw: 'ranking' },
      panel,
    );
    expect(evaluatorChangedCount(d, panel)).toBe(2);
  });

  it('resets to the base inputs', () => {
    const edited = addMetaRow(setConfig(base, 'samples', 9), panel);
    const reset = resetInputs(edited, panel);
    expect(reset.evaluator.config).toEqual({});
    expect(metaRowsOf(reset, panel).map((r) => r.key)).toEqual(['team']);
    expect(evaluatorChangedCount(reset, panel)).toBe(0);
  });
});

describe('run_metadata rows', () => {
  it('start as the base keys, minus the reserved ones, until the user edits them', () => {
    expect(metaRowsOf(base, panel).map((r) => [r.key, r.raw])).toEqual([['team', 'search']]);
    const other = withBase({ config: { run_metadata: { a: 1 } } });
    expect(metaRowsOf(other, panel).map((r) => r.key)).toEqual(['a']);
  });

  it('follow a new base until touched, then keep the user rows', () => {
    const untouched = syncMetaSeed(
      { ...base, evaluatorExtra: { config: { run_metadata: { z: 'new' } } } },
      panel,
    );
    expect(metaRowsOf(untouched, panel).map((r) => r.key)).toEqual(['z']);
    const touched = addMetaRow(base, panel);
    const reBased = syncMetaSeed(
      { ...touched, evaluatorExtra: { config: { run_metadata: { z: 'new' } } } },
      panel,
    );
    expect(metaRowsOf(reBased, panel).map((r) => r.key)).toEqual(['team', '']);
  });

  it('adds, edits and removes rows with stable ids', () => {
    let d = addMetaRow(createDocument(), panel);
    d = addMetaRow(d, panel);
    const [a, b] = metaRowsOf(d, panel);
    expect(a!.id).not.toBe(b!.id);
    d = updateMetaRow(d, a!.id, { key: 'k', raw: '{"x":1}' }, panel);
    expect(metadataState(d, panel).values).toEqual({ k: { x: 1 } });
    d = removeMetaRow(d, a!.id, panel);
    expect(metaRowsOf(d, panel)).toHaveLength(1);
  });

  it('reads JSON values and keeps plain text; shows a numeric string quoted', () => {
    expect(parseMetadataValue('12')).toBe(12);
    expect(parseMetadataValue('hello')).toBe('hello');
    expect(metadataText('123')).toBe('"123"');
    expect(metadataText('abc')).toBe('abc');
    expect(metadataText({ a: 1 })).toBe('{"a":1}');
  });

  it('rejects the reserved prefix, duplicates, placeholders and a missing key', () => {
    let d = createDocument();
    for (const [key, raw] of [
      ['qym_x', '1'],
      ['dup', '1'],
      ['dup', '2'],
      ['', 'v'],
      ['ph', '{{qym:model}}'],
      ['QYM_UP', '1'],
      ['', ''],
    ] as const) {
      d = addMetaRow(d, panel);
      const rows = metaRowsOf(d, panel);
      d = updateMetaRow(d, rows[rows.length - 1]!.id, { key, raw }, panel);
    }
    const state = metadataState(d, panel);
    expect(Object.values(state.rowErrors)).toEqual([
      'Keys starting with qym_ are reserved for the platform',
      'Duplicate key',
      'Enter a key',
      '{{qym: is reserved for platform placeholders',
      'Keys starting with qym_ are reserved for the platform',
    ]);
    expect(state.values).toEqual({ dup: 1 });
    expect(state.errors[0]).toEqual({
      pointer: '/evaluator/config/run_metadata/qym_x',
      message: 'run_metadata: Keys starting with qym_ are reserved for the platform',
    });
    expect(isReservedKey('Qym_a')).toBe(true);
    expect(isReservedKey('myqym_')).toBe(false);
  });
});

describe('spec contribution', () => {
  it('lays edits over the base config and rewrites run_metadata from the rows', () => {
    let d = setConfig(base, 'samples', 4);
    d = removeMetaRow(d, metaRowsOf(d, panel)[0]!.id, panel);
    d = updateMetaRow(
      addMetaRow(d, panel),
      metaRowsOf(addMetaRow(d, panel), panel)[0]!.id,
      { key: 'owner', raw: 'me' },
      panel,
    );
    const out = applyEvaluatorEdits(
      d,
      { dataset: 'd', config: { samples: 3, odd_key: 1, run_metadata: { team: 'search', qym_launch: 'x' } } },
      panel,
    );
    expect(out['config']).toEqual({ samples: 4, odd_key: 1, run_metadata: { owner: 'me' } });
  });

  it('drops run_metadata when no rows remain and drops an empty config', () => {
    const d = removeMetaRow(createDocument(), 1, panel);
    expect(applyEvaluatorEdits(d, { dataset: 'd' }, panel)).toEqual({ dataset: 'd' });
    const none = removeMetaRow(base, metaRowsOf(base, panel)[0]!.id, panel);
    expect(
      applyEvaluatorEdits(none, { config: { run_metadata: { team: 'x' } } }, panel)['config'],
    ).toBeUndefined();
  });

  it('the Dataset section alias wins over the inputs', () => {
    const d = {
      ...setConfig(createDocument(), 'dataset_alias', 'staging'),
      dataset: { mode: 'project' as const, name: 'x', ref: 'a:production', custom: '' },
    };
    const out = applyEvaluatorEdits(d, { dataset: 'x', config: { dataset_alias: 'production' } }, panel);
    expect((out['config'] as Record<string, unknown>)['dataset_alias']).toBe('production');
  });

  it('adds report_k and dataset_version that only Raw JSON can set', () => {
    const d = {
      ...createDocument(),
      evaluator: { ...createDocument().evaluator, extra: { report_k: 3, dataset_version: '2' } },
    };
    expect(applyEvaluatorEdits(d, { dataset: 'x' }, panel)).toMatchObject({
      report_k: 3,
      dataset_version: '2',
    });
    expect(applyEvaluatorEdits(d, { dataset: 'x', dataset_version: '9' }, panel)['dataset_version']).toBe(
      '9',
    );
  });

  it('skips invalid text', () => {
    const bad = setConfigInput(createDocument(), entry('samples'), 'samples', 'x');
    expect(applyEvaluatorEdits(bad, { dataset: 'x' }, panel)['config']).toBeUndefined();
  });
});

describe('the panel', () => {
  it('lists the fields with base values and locks the alias picked in Dataset', () => {
    const d = { ...base, dataset: { mode: 'project' as const, name: 'x', ref: 'a:prod', custom: '' } };
    const fields = evaluatorFields(d, ctx);
    expect(fields.map((f) => f.name)).toEqual(panel.fields);
    const samples = fields.find((f) => f.name === 'samples')!;
    expect(samples).toMatchObject({ value: 3, baseValue: 3, changed: false, missingEnvs: [] });
    expect(fields.find((f) => f.name === 'dataset_alias')?.locked).toBe(true);
    expect(fields.some((f) => f.name === 'run_name')).toBe(false);
    expect(evaluatorFields(base, makeCtx({ panel: null }))).toEqual([]);
  });

  it('lists values no field shows as Other values, except platform-owned ones', () => {
    const d = setConfig(
      withBase({ config: { odd_key: 1, model: 'x', run_metadata: { a: 1 } } }),
      'another',
      2,
    );
    expect(unmatchedConfig(d, panel)).toEqual(['another', 'odd_key']);
    expect(unmatchedConfig(d, null)).toEqual([]);
  });

  it('lists what the platform sets and what is also sent', () => {
    expect(platformOwnedList(panel)).toMatchObject({
      evaluator: ['model'],
      metadata: ['qym_launch', 'qym_config'],
    });
    expect(platformOwnedList(null).config).toContain('run_name');
    expect(alsoSent(base)).toEqual([{ key: 'report_k', value: 5 }]);
    expect(alsoSent(removeAlsoSent(base, 'report_k'))).toEqual([]);
  });
});
