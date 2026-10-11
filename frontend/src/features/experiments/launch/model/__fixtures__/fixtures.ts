/**
 * Test fixtures: the real descriptor, slots, model options and evaluator-config
 * payloads served by the dev platform for project exp-seed (see form.json etc.), plus
 * a few helpers to make a second ("staging") environment that differs, and synthetic
 * entries for shapes the sample schema lacks (open objects, json unions, arrays).
 */
import { buildContext, envDataFrom } from '../descriptor';
import type {
  DescriptorEntry,
  EnvData,
  EvaluatorPanel,
  FormContext,
  FormResponse,
  ModelOptions,
  ModelSlot,
} from '../types';
import evaluatorConfigJson from './evaluator-config.json';
import formJson from './form.json';
import optionsJson from './options.json';
import slotsJson from './slots.json';

export const formResponse = formJson as unknown as FormResponse;
export const slotsResponse = slotsJson as unknown as { slots: ModelSlot[]; needs_confirmation?: boolean };
export const optionsResponse = optionsJson as unknown as ModelOptions;
export const evaluatorPanel = evaluatorConfigJson as unknown as EvaluatorPanel;

export const PRODUCTION = 'env-production';
export const STAGING = 'env-staging';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function entry(partial: Partial<DescriptorEntry> & { pointer: string }): DescriptorEntry {
  const segs = partial.pointer.split('/').slice(1);
  return {
    name: segs[segs.length - 1] ?? '',
    label: segs[segs.length - 1] ?? '',
    description: null,
    path: segs,
    parent: null,
    params: [],
    kind: 'field',
    type: 'string',
    widget: 'text',
    group: 'misc',
    required: false,
    nullable: true,
    has_default: false,
    default: null,
    sweepable: true,
    secret: false,
    enum: null,
    bounds: {},
    pattern: null,
    format: null,
    accepts: null,
    item_type: null,
    ...partial,
  };
}

export interface EnvOptions {
  /** Pointers removed from this environment's schema (and its groups). */
  drop?: string[];
  /** Extra descriptor entries added to a group. */
  add?: Array<{ entry: DescriptorEntry; group: string; root?: boolean }>;
  maxPriority?: EnvData['maxPriority'];
  defaultPriority?: EnvData['defaultPriority'];
  loading?: boolean;
  formError?: string;
  /** Overrides the confirmed slots. */
  slots?: ModelSlot[];
  noOptions?: boolean;
}

export function makeEnv(id: string, name: string, opts: EnvOptions = {}): EnvData {
  const form = clone(formResponse);
  const d = form.descriptor;
  for (const p of opts.drop ?? []) {
    delete d.fields[p];
    d.root = d.root.filter((r) => r !== p);
    for (const g of d.groups) g.pointers = g.pointers.filter((x) => x !== p);
  }
  for (const add of opts.add ?? []) {
    d.fields[add.entry.pointer] = add.entry;
    if (add.root !== false) d.root.push(add.entry.pointer);
    d.groups.find((g) => g.id === add.group)?.pointers.push(add.entry.pointer);
  }
  const env = envDataFrom({
    id,
    name,
    form: opts.formError ? null : form,
    formError: opts.formError,
    slots: { slots: opts.slots ?? clone(slotsResponse.slots) },
    options: opts.noOptions ? null : clone(optionsResponse),
    maxPriority: opts.maxPriority ?? 'HIGH',
    defaultPriority: opts.defaultPriority ?? 'NORMAL',
    schemaHash: 'hash-' + id,
  });
  env.loading = opts.loading;
  return env;
}

export interface CtxOptions {
  envs?: EnvData[];
  extraEndpoints?: string[];
  datasetNames?: string[];
  panel?: EvaluatorPanel | null;
  maxJobs?: number | null;
  isManager?: boolean;
}

export function makeCtx(opts: CtxOptions = {}): FormContext {
  return buildContext({
    envs: opts.envs ?? [makeEnv(PRODUCTION, 'production')],
    extraEndpoints: opts.extraEndpoints,
    datasetNames: opts.datasetNames ?? ['support-qa', 'legal-set'],
    evaluatorPanel: opts.panel === undefined ? clone(evaluatorPanel) : opts.panel,
    maxJobs: opts.maxJobs === undefined ? 100 : opts.maxJobs,
    isManager: opts.isManager ?? true,
  });
}

/** Two environments where staging lacks /VIZ_MAX_GROUPS and has /STAGING_ONLY_FLAG. */
export function twoEnvCtx(opts: Omit<CtxOptions, 'envs'> = {}): FormContext {
  return makeCtx({
    ...opts,
    envs: [
      makeEnv(PRODUCTION, 'production'),
      makeEnv(STAGING, 'staging', {
        drop: ['/VIZ_MAX_GROUPS'],
        add: [
          {
            entry: entry({ pointer: '/STAGING_ONLY_FLAG', type: 'boolean', widget: 'toggle', group: 'misc' }),
            group: 'misc',
          },
        ],
      }),
    ],
  });
}

/** Synthetic shapes: an open object, an array, a json union and a plain string with a pattern. */
export const syntheticEntries: DescriptorEntry[] = [
  entry({
    pointer: '/EXTRA',
    kind: 'object',
    type: 'object',
    widget: 'group',
    children: ['/EXTRA/known'],
    additional_pointer: '/EXTRA/{key}',
    group: 'misc',
  }),
  entry({
    pointer: '/EXTRA/known',
    type: 'integer',
    widget: 'number',
    parent: '/EXTRA',
    bounds: { minimum: 0 },
  }),
  entry({
    pointer: '/EXTRA/{key}',
    type: 'json',
    widget: 'json',
    parent: '/EXTRA',
    params: ['key'],
    accepts: null,
  }),
  entry({ pointer: '/STOP_WORDS', type: 'array', widget: 'json', item_type: 'string' }),
  entry({ pointer: '/FLEX', type: 'json', widget: 'json', accepts: ['integer', 'string'] }),
  entry({ pointer: '/LABEL', type: 'string', widget: 'text', pattern: '^[a-z]+$', bounds: { maxLength: 8 } }),
];

export function withSynthetic(): FormContext {
  const add = syntheticEntries.map((e) => ({
    entry: e,
    group: 'misc',
    root: e.parent === null || e.parent === undefined,
  }));
  return makeCtx({ envs: [makeEnv(PRODUCTION, 'production', { add })] });
}
