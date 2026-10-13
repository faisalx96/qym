/** The analyzer configuration the user edits, and its translation to request payloads. */
import type { AnalyzeRequest, PlaygroundConfigPayload, PreviewRequest, TestRequest } from '@/api/analysis';
import {
  STD_VARIABLES,
  defaultSlot,
  metadataFields,
  slotSource,
  type FieldSlot,
  type MetadataGroup,
  type PathNode,
  type SourceField,
  type StdVariable,
} from './mapping';
import { detectCustomVars } from './vars';

export interface AnalyzerSettings {
  selectedMetrics: string[];
  instructions: string;
  useRules: boolean;
  useDocuments: boolean;
  useTrace: boolean;
  maxIssues: number;
  includeError: boolean;
  includeScores: boolean;
  includeMetadata: boolean;
  std: Record<StdVariable, FieldSlot>;
  custom: Record<string, FieldSlot>;
  /** metadataKey(metric, leaf) entries the user unchecked. */
  metaDeselected: string[];
  maxScorePct: number;
  skipAnalyzed: boolean;
  allowHuman: boolean;
  timeoutSeconds: number;
  limit: number | null;
}

export function defaultSettings(init: {
  metrics: string[];
  preselect?: string | null;
  maxIssues: number;
  timeoutSeconds: number;
}): AnalyzerSettings {
  const selected = init.preselect && init.metrics.includes(init.preselect) ? [init.preselect] : init.metrics;
  return {
    selectedMetrics: selected,
    instructions: '',
    useRules: true,
    useDocuments: true,
    useTrace: true,
    maxIssues: init.maxIssues,
    includeError: true,
    includeScores: true,
    includeMetadata: true,
    std: {
      input: defaultSlot('input'),
      expected: defaultSlot('expected'),
      output: defaultSlot('output'),
    },
    custom: {},
    metaDeselected: [],
    maxScorePct: 80,
    skipAnalyzed: true,
    allowHuman: false,
    timeoutSeconds: init.timeoutSeconds,
    limit: null,
  };
}

/** Keep one mapping slot per `{variable}` currently in the instructions (state survives re-typing). */
export function customVarsOf(settings: Pick<AnalyzerSettings, 'instructions'>): string[] {
  return detectCustomVars(settings.instructions);
}

export interface FieldTrees {
  std: Record<StdVariable, PathNode[]>;
  custom: Record<string, PathNode[]>;
  metadata: MetadataGroup[];
}

export function buildConfigPayload(s: AnalyzerSettings, trees: FieldTrees): PlaygroundConfigPayload {
  const cfg: PlaygroundConfigPayload = {
    include_project_rules: s.useRules,
    include_project_documents: s.useDocuments,
    max_root_cause_categories: s.maxIssues,
    include_fields: {
      input: true,
      expected: true,
      output: true,
      error: s.includeError,
      scores: s.includeScores,
      metadata: s.includeMetadata,
      trace: s.useTrace,
    },
  };
  const instructions = s.instructions.trim();
  if (instructions) cfg.additional_instructions = instructions;
  if (s.includeMetadata) {
    const fields = metadataFields(trees.metadata, { deselected: s.metaDeselected });
    if (fields) cfg.metadata_fields = fields;
  }
  const mapping: Record<string, string | string[]> = {};
  let hasCustom = false;
  for (const def of STD_VARIABLES) {
    const out = slotSource(s.std[def.key], trees.std[def.key] ?? []);
    if (!out) continue;
    if (out.custom || out.source !== def.defaultField) hasCustom = true;
    mapping[def.key] = out.source;
  }
  if (hasCustom) cfg.field_mapping = mapping;
  const customMapping: Record<string, string | string[]> = {};
  for (const name of customVarsOf(s)) {
    const slot = s.custom[name];
    const out = slot ? slotSource(slot, trees.custom[name] ?? []) : null;
    if (out) customMapping[name] = out.source;
  }
  if (Object.keys(customMapping).length) cfg.custom_variable_mapping = customMapping;
  return cfg;
}

/** Names (labels) of the fields actually sent, shown with test results ("Fields sent"). */
export function fieldsSent(cfg: PlaygroundConfigPayload): string[] {
  const inc = cfg.include_fields ?? {};
  const out: string[] = [];
  if (inc.input) out.push('Input');
  if (inc.expected) out.push('Expected');
  if (inc.output) out.push('Output');
  if (inc.error) out.push('Error');
  if (inc.scores) out.push('Scores');
  if (inc.metadata) out.push('Metric metadata');
  if (inc.trace) out.push('Trace');
  return out;
}

export interface RunGuard {
  pass_number?: number;
  expected_pass_version?: number;
  connectionId: string | null;
}

const guard = (g: RunGuard) => ({
  ...(g.pass_number != null ? { pass_number: g.pass_number } : {}),
  ...(g.expected_pass_version != null ? { expected_pass_version: g.expected_pass_version } : {}),
});

export function previewRequest(
  cfg: PlaygroundConfigPayload,
  itemId: string,
  metric: string,
  g: RunGuard,
): PreviewRequest {
  return { item_id: itemId, metric, config: cfg, connection_id: g.connectionId, ...guard(g) };
}

export function testRequest(
  cfg: PlaygroundConfigPayload,
  itemIds: string[],
  metric: string,
  s: AnalyzerSettings,
  g: RunGuard,
): TestRequest {
  return {
    item_ids: itemIds,
    metric,
    config: cfg,
    connection_id: g.connectionId,
    timeout_seconds: s.timeoutSeconds,
    ...guard(g),
  };
}

export function analyzeRequest(
  cfg: PlaygroundConfigPayload,
  s: AnalyzerSettings,
  g: RunGuard,
): AnalyzeRequest {
  return {
    metric: null,
    metrics: s.selectedMetrics,
    item_filter: 'failed',
    max_score: s.maxScorePct / 100,
    only_unanalyzed: s.skipAnalyzed,
    allow_human_overwrite: s.allowHuman,
    threshold: 0.8,
    config: cfg,
    connection_id: g.connectionId,
    timeout_seconds: s.timeoutSeconds,
    ...(s.limit ? { limit: s.limit } : {}),
    ...guard(g),
  };
}

export type { SourceField };

/** One-line summary of the Input mapping disclosure: "Default fields", "Custom fields", "2 variables". */
export function mappingSummary(
  settings: Pick<
    AnalyzerSettings,
    'std' | 'includeError' | 'includeScores' | 'includeMetadata' | 'metaDeselected'
  >,
  variableCount: number,
): string {
  const customStd =
    !settings.includeError ||
    !settings.includeScores ||
    !settings.includeMetadata ||
    settings.metaDeselected.length > 0 ||
    (Object.keys(settings.std) as StdVariable[]).some((k) => {
      const d = defaultSlot(k);
      const cur = settings.std[k];
      return cur.field !== d.field || !cur.full || cur.selected.length > 0;
    });
  const parts = [
    customStd ? 'Custom fields' : null,
    variableCount ? `${variableCount} ${variableCount === 1 ? 'variable' : 'variables'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Default fields';
}
