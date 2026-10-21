/** Constructors for the LaunchDocument and its parts. */
import type { BaseInfo, BaseKind, DatasetChoice, EvaluatorEdits, LaunchDocument, Priority } from './types';

export const PRIORITY_ORDER: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2 };
export const NAME_MAX = 200;
/** Experiment descriptions are at most this long (ExperimentCreateRequest). */
export const DESCRIPTION_MAX = 5000;

export function emptyBaseInfo(kind: BaseKind = 'scratch'): BaseInfo {
  return {
    kind,
    loading: false,
    loaded: kind === 'scratch',
    dropped: [],
    errors: [],
    warnings: [],
    notes: [],
  };
}

export function emptyDataset(): DatasetChoice {
  return { mode: 'project', name: '', ref: '', custom: '' };
}

export function emptyEvaluator(): EvaluatorEdits {
  return { config: {}, invalid: {}, meta: [], metaTouched: false, metaSeed: null, nextMetaId: 1, extra: {} };
}

export function createDocument(init: Partial<LaunchDocument> = {}): LaunchDocument {
  return {
    environmentIds: [],
    dataset: emptyDataset(),
    name: '',
    description: '',
    priority: '',
    latencySensitive: false,
    base: emptyBaseInfo('scratch'),
    baseline: { values: {}, bindings: {}, dataset: null },
    evaluatorExtra: {},
    values: {},
    invalid: {},
    addedKeys: {},
    bindings: {},
    globalModel: null,
    extraEndpoints: [],
    links: undefined,
    evaluator: emptyEvaluator(),
    clone: null,
    ...init,
  };
}

/** The dataset string the request sends ('' when none picked). */
export function datasetValue(doc: Pick<LaunchDocument, 'dataset'>): string {
  return doc.dataset.mode === 'custom' ? doc.dataset.custom.trim() : doc.dataset.name;
}

export function toggleEnvironment(doc: LaunchDocument, id: string, on: boolean): LaunchDocument {
  const has = doc.environmentIds.includes(id);
  if (on && !has) return { ...doc, environmentIds: [...doc.environmentIds, id] };
  if (!on && has) return { ...doc, environmentIds: doc.environmentIds.filter((e) => e !== id) };
  return doc;
}
