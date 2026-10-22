import { describe, expect, it } from 'vitest';
import { makeCtx, makeEnv, PRODUCTION, STAGING } from './__fixtures__/fixtures';
import {
  addDataset,
  datasetEntries,
  datasetPairs,
  envUnits,
  pairCount,
  refLabel,
  removeDataset,
  setEntryRefs,
  setRunShape,
  setTask,
  unitsFor,
  unitsInfo,
  unitsMath,
} from './datasets';
import { createDocument } from './document';
import { baselineFrom, captureEdits, datasetChanged, diffCount, replayEdits, resetAll } from './layering';
import { applyRawJson, initRawJson } from './rawJson';
import { SecretStore } from './secrets';
import { buildSpec, buildPresetConfig } from './spec';
import { jobEstimate, runEstimate } from './sweeps';
import { localErrors, locate, runCount } from './validation';
import type { LaunchDocument } from './types';

const both = { datasets: true, task: true };
const old = { datasets: false, task: false };

function ctxWith(envs = [makeEnv(PRODUCTION, 'production', { capabilities: both }), makeEnv(STAGING, 'staging', { capabilities: old })]) {
  return makeCtx({ envs, datasetNames: ['support-tickets', 'billing-faq', 'refund-cases'] });
}

function four(): LaunchDocument {
  let doc = createDocument({ environmentIds: [PRODUCTION, STAGING], name: 'x' });
  doc = addDataset(doc, 'support-tickets');
  doc = setEntryRefs(doc, 'support-tickets', ['v:v3', 'v:v4']);
  doc = addDataset(doc, 'billing-faq');
  doc = setEntryRefs(doc, 'billing-faq', ['v:v1', 'v:v2']);
  return doc;
}

describe('dataset selection', () => {
  it('a single dataset keeps the document of today', () => {
    let doc = createDocument({ environmentIds: [PRODUCTION] });
    doc = addDataset(doc, 'support-tickets');
    expect(doc.dataset).toEqual({ mode: 'project', name: 'support-tickets', ref: '', custom: '' });
    expect(doc.selection.more).toEqual([]);
    expect(pairCount(doc)).toBe(1);
    const spec = buildSpec(doc, null);
    expect(spec.evaluator).toEqual({ dataset: 'support-tickets' }); // QD-9, QD-72: no datasets, no run_shape
  });

  it('QD-5/QD-6 lists boxes and pairs in order', () => {
    const doc = four();
    expect(datasetEntries(doc)).toEqual([
      { name: 'support-tickets', refs: ['v:v3', 'v:v4'] },
      { name: 'billing-faq', refs: ['v:v1', 'v:v2'] },
    ]);
    expect(datasetPairs(doc).map((p) => `${p.dataset} ${p.version}`)).toEqual([
      'support-tickets v3',
      'support-tickets v4',
      'billing-faq v1',
      'billing-faq v2',
    ]);
    expect(refLabel('')).toBe('Latest version');
    expect(refLabel('a:production')).toBe('alias production');
  });

  it('QD-7 unticking the last reference snaps back to Latest', () => {
    const doc = setEntryRefs(four(), 'billing-faq', []);
    expect(datasetEntries(doc)[1]).toEqual({ name: 'billing-faq', refs: [''] });
  });

  it('QD-8 removing the primary promotes the next dataset; the last returns to none', () => {
    let doc = removeDataset(four(), 'support-tickets');
    expect(doc.dataset).toMatchObject({ name: 'billing-faq', ref: 'v:v1' });
    expect(doc.selection.extraRefs).toEqual(['v:v2']);
    doc = removeDataset(doc, 'billing-faq');
    expect(doc.dataset.name).toBe('');
    expect(pairCount(doc)).toBe(0);
  });

  it('QD-19 the run shape survives adding and removing datasets', () => {
    let doc = setRunShape(four(), 'one_each');
    doc = removeDataset(doc, 'billing-faq');
    doc = setEntryRefs(doc, 'support-tickets', ['v:v3']);
    expect(doc.selection.runShape).toBe('one_each');
    expect(buildSpec(doc, null).evaluator).not.toHaveProperty('run_shape');
  });
});

describe('spec', () => {
  it('QD-81 builds datasets, the mirrored first pair, the shape and the task', () => {
    let doc = setTask(four(), PRODUCTION, 'answer-ticket');
    const spec = buildSpec(doc, null);
    expect(spec.evaluator).toMatchObject({
      dataset: 'support-tickets',
      dataset_version: 'v3',
      datasets: [
        { dataset: 'support-tickets', version: 'v3' },
        { dataset: 'support-tickets', version: 'v4' },
        { dataset: 'billing-faq', version: 'v1' },
        { dataset: 'billing-faq', version: 'v2' },
      ],
      run_shape: 'combined',
      task: { [PRODUCTION]: 'answer-ticket' },
    });
    doc = setTask(doc, PRODUCTION, null);
    expect(buildSpec(doc, null).evaluator).not.toHaveProperty('task');
  });

  it('an unticked environment sends no task (QD-38)', () => {
    const doc = { ...setTask(four(), STAGING, 'x'), environmentIds: [PRODUCTION] };
    expect(buildSpec(doc, null).evaluator).not.toHaveProperty('task');
  });

  it('QD-65 a preset holds neither the list nor the shape; its task is a string', () => {
    const doc = setTask(four(), PRODUCTION, 'answer-ticket');
    const config = buildPresetConfig(doc, 'h', null);
    expect(config.evaluator).not.toHaveProperty('datasets');
    expect(config.evaluator).not.toHaveProperty('run_shape');
    expect(config.evaluator).toMatchObject({ task: 'answer-ticket' });
  });
});

describe('units per environment', () => {
  it('QD-21 a service with datasets gets one combined job, an older one a job per pair', () => {
    const ctx = ctxWith();
    const doc = four();
    expect(envUnits(doc, ctx.envs).map((u) => [u.mode, u.units, u.reason])).toEqual([
      ['combined', 1, null],
      ['fan_out', 4, 'service_without_datasets'],
    ]);
    const each = setRunShape(doc, 'one_each');
    expect(envUnits(each, ctx.envs).map((u) => [u.mode, u.units, u.reason])).toEqual([
      ['fan_out', 4, 'run_shape'],
      ['fan_out', 4, 'run_shape'],
    ]);
    expect(unitsFor(1, 'one_each', false).mode).toBe('single');
  });

  it('QD-43 the maths line', () => {
    const ctx = ctxWith();
    const info = unitsInfo(four(), ctx.envs);
    expect(info.total).toBe(5);
    expect(info.text).toBe('(production: 1 combined run + staging: 4 runs)');
    const spec = buildSpec(four(), null);
    expect(runEstimate(spec, 2, 64, info).math).toContain('× (production: 1 combined run + staging: 4 runs) = 5 runs');
    const each = unitsInfo(setRunShape(four(), 'one_each'), ctx.envs);
    expect(each.total).toBe(8);
    expect(runEstimate(spec, 2, 64, each).math).toContain('× (2 environments × 4 dataset versions) = 8 runs');
    expect(unitsMath(envUnits(createDocument({ environmentIds: [PRODUCTION] }), ctx.envs), {}, 1)).toBeNull();
    expect(jobEstimate(spec, info.total)).toBe(5);
  });

  it('QD-44 the run count follows the units and the cap', () => {
    const ctx = makeCtx({ envs: ctxWith().envs, maxJobs: 6 });
    const count = runCount(setRunShape(four(), 'one_each'), ctx, null);
    expect(count).toMatchObject({ runs: 8, cap: 6, over: true });
    expect(runCount(four(), ctx, null)).toMatchObject({ runs: 5, over: false });
  });
});

describe('validation', () => {
  it('QD-49 task problems carry their pointer and read as the spec says', () => {
    const ctx = ctxWith([
      makeEnv(PRODUCTION, 'production', { capabilities: both, taskList: { status: 'ok', ids: ['answer-ticket'] } }),
      makeEnv(STAGING, 'staging', { capabilities: old }),
    ]);
    let doc = setTask(four(), PRODUCTION, 'route-ticket');
    doc = setTask(doc, STAGING, 'answer-ticket');
    const items = localErrors(doc, ctx).filter((i) => i.pointer.startsWith('/evaluator/task/'));
    expect(items.map((i) => [i.pointer, i.message, i.stepId])).toEqual([
      [`/evaluator/task/${PRODUCTION}`, 'production: the service does not list the task “route-ticket”.', 'where'],
      [`/evaluator/task/${STAGING}`, 'staging: this Evaluation Service does not offer task selection.', 'where'],
    ]);
    expect(locate(`/evaluator/task/${PRODUCTION}`, ctx).label).toBe('Task of production');
  });

  it('QD-49 the limit of 20', () => {
    let doc = createDocument({ environmentIds: [PRODUCTION] });
    doc = addDataset(doc, 'support-tickets');
    doc = setEntryRefs(doc, 'support-tickets', Array.from({ length: 21 }, (_, i) => `v:${i}`));
    const items = localErrors(doc, ctxWith());
    expect(items.map((i) => i.message)).toContain('At most 20 dataset versions per experiment.');
  });
});

describe('Raw JSON', () => {
  it('QD-47/48 shows the list and round-trips', () => {
    const ctx = ctxWith();
    let doc = setTask(setRunShape(four(), 'one_each'), PRODUCTION, 'answer-ticket');
    const state = initRawJson(doc, ctx.evaluatorPanel);
    const parsed = JSON.parse(state.text) as { evaluator: Record<string, unknown> };
    expect(Object.keys(parsed.evaluator)).toEqual(expect.arrayContaining(['dataset', 'datasets', 'run_shape', 'task']));
    // edit: drop billing-faq v2, run shape back to combined, no task
    const edited = {
      ...parsed,
      evaluator: {
        ...parsed.evaluator,
        datasets: (parsed.evaluator['datasets'] as unknown[]).slice(0, 3),
        run_shape: 'combined',
        task: undefined,
      },
    };
    const result = applyRawJson({ ...state, text: JSON.stringify(edited, null, 2), dirty: true }, doc, ctx, new SecretStore());
    expect(result.applied).toBe(true);
    doc = result.doc;
    expect(datasetPairs(doc)).toHaveLength(3);
    expect(doc.selection.runShape).toBe('combined');
    expect(doc.selection.tasks).toEqual({});
    expect(result.state.text).toBe(initRawJson(doc, ctx.evaluatorPanel).text); // re-serialised text equals
  });

  it('QD-48 an invalid text changes nothing', () => {
    const ctx = ctxWith();
    const doc = four();
    const state = initRawJson(doc, ctx.evaluatorPanel);
    const parsed = JSON.parse(state.text) as { evaluator: { datasets: Array<Record<string, string>> } };
    parsed.evaluator.datasets[1] = { dataset: 'support-tickets', version: 'v4', alias: 'prod' };
    const result = applyRawJson({ ...state, text: JSON.stringify(parsed), dirty: true }, doc, ctx, new SecretStore());
    expect(result.applied).toBe(false);
    expect(result.doc).toBe(doc);
    expect(result.state.errors[0]).toMatchObject({
      pointer: '/evaluator/datasets/1',
      message: 'Give a version or an alias, not both.',
    });
  });

  it('QD-80 refuses a swept list or shape', () => {
    const ctx = ctxWith();
    const doc = four();
    const state = initRawJson(doc, ctx.evaluatorPanel);
    const parsed = JSON.parse(state.text) as { evaluator: Record<string, unknown> };
    parsed.evaluator['run_shape'] = { sweep: ['combined', 'one_each'] };
    const result = applyRawJson({ ...state, text: JSON.stringify(parsed), dirty: true }, doc, ctx, new SecretStore());
    expect(result.state.errors[0]?.message).toBe(
      'Dataset versions cannot be swept; choose “One run each” to run each one.',
    );
  });
});

describe('starting points', () => {
  it('QD-63/64 a clone brings the list, the shape and the tasks of the environments still ticked', () => {
    const ctx = ctxWith();
    const base = baselineFrom(
      {
        evaluator: {
          dataset: 'support-tickets',
          dataset_version: 'v3',
          datasets: [
            { dataset: 'support-tickets', version: 'v3' },
            { dataset: 'billing-faq', alias: 'production' },
          ],
          run_shape: 'one_each',
          task: { [PRODUCTION]: 'answer-ticket', 'gone-env': 'x' },
        },
      },
      { ...ctx, envNames: { 'gone-env': 'canary' } },
    );
    expect(base.dataset).toMatchObject({ name: 'support-tickets', ref: 'v:v3' });
    expect(base.selection?.more).toEqual([{ name: 'billing-faq', refs: ['a:production'] }]);
    expect(base.selection?.runShape).toBe('one_each');
    expect(base.selection?.tasks).toEqual({ [PRODUCTION]: 'answer-ticket' });
    expect(base.notes).toContain('Task for canary was not carried (environment not selected)');
  });

  it('QD-66 a preset task seeds only its own environment', () => {
    const ctx = ctxWith([
      makeEnv(PRODUCTION, 'production', { capabilities: both, taskList: { status: 'ok', ids: ['answer-ticket'] } }),
      makeEnv(STAGING, 'staging', { capabilities: both, taskList: { status: 'ok', ids: ['answer-ticket'] } }),
    ]);
    const own = baselineFrom({ evaluator: { task: 'answer-ticket' } }, ctx, { taskEnvId: PRODUCTION });
    expect(own.selection?.tasks).toEqual({ [PRODUCTION]: 'answer-ticket' });
    const unknown = baselineFrom({ evaluator: { task: 'zzz' } }, ctx, { taskEnvId: PRODUCTION });
    expect(unknown.selection?.tasks).toEqual({});
    expect(unknown.notes[0]).toContain('“zzz” is not listed by production');
  });

  it('QD-29/QD-67 counts changes once and undoes them', () => {
    const ctx = ctxWith();
    let doc: LaunchDocument;
    doc = four();
    expect(datasetChanged(doc)).toBe(true);
    doc = setTask(setRunShape(doc, 'one_each'), PRODUCTION, 'answer-ticket');
    expect(diffCount(doc)).toMatchObject({ dataset: 1, shape: 1, tasks: 1 });
    const kept = captureEdits(doc);
    expect(kept.tasks).toEqual({ [PRODUCTION]: 'answer-ticket' });
    const replayed = replayEdits(createDocument({ environmentIds: [PRODUCTION] }), kept, ctx).doc;
    expect(replayed.selection.tasks).toEqual({ [PRODUCTION]: 'answer-ticket' });
    expect(replayed.selection.runShape).toBe('one_each');
    const undone = resetAll(doc, ctx);
    expect(pairCount(undone)).toBeLessThanOrEqual(1);
    expect(undone.selection).toEqual({ extraRefs: [], more: [], runShape: 'combined', tasks: {} });
  });
});
