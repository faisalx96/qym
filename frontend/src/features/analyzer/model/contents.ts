/**
 * The Prompt contents switches and the prompt sections they control (cv5 Q4, owner: "there is a big bug to which
 * thing these map to"). One switch, one block of the prompt, the same name on both: the switch label is the label of
 * its section in the rendered prompt's outline. The keys are the headings that the prompt builder writes
 * (`services/llm_analyzer.py` `_format_item_context`, `build_analysis_prompt`).
 */
import type { AnalyzerSettings } from './settings';

export type SwitchId = 'scores' | 'metricMeta' | 'itemMeta' | 'trace' | 'rules' | 'docs';

export interface ContentSwitch {
  id: SwitchId;
  label: string;
  /** The heading key of the section this switch sends. */
  key: string;
  /** The section that holds it in the outline: the item data, or the top level. */
  parent: 'EVALUATION ITEM DATA' | null;
  /** 0 = system message, 1 = user message. */
  message: 0 | 1;
  on: (s: AnalyzerSettings) => boolean;
}

export const CONTENT_SWITCHES: ContentSwitch[] = [
  {
    id: 'scores',
    label: 'Metric result',
    key: 'SELECTED METRIC RESULT',
    parent: 'EVALUATION ITEM DATA',
    message: 0,
    on: (s) => s.includeScores,
  },
  {
    id: 'metricMeta',
    label: 'Metric metadata',
    key: 'SELECTED METRIC METADATA',
    parent: 'EVALUATION ITEM DATA',
    message: 0,
    on: (s) => s.includeMetricMetadata,
  },
  {
    id: 'itemMeta',
    label: 'Item metadata',
    key: 'ITEM METADATA',
    parent: 'EVALUATION ITEM DATA',
    message: 0,
    on: (s) => s.includeMetadata,
  },
  {
    id: 'trace',
    label: 'Trace evidence',
    key: 'TRACE EVIDENCE',
    parent: 'EVALUATION ITEM DATA',
    message: 0,
    on: (s) => s.useTrace,
  },
  { id: 'rules', label: 'Analysis rules', key: 'ANALYSIS RULES', parent: null, message: 0, on: (s) => s.useRules },
  {
    id: 'docs',
    label: 'Reference documents',
    key: 'REFERENCE DOCUMENTS',
    parent: null,
    message: 1,
    on: (s) => s.useDocuments,
  },
];

/**
 * The section keys to mark while a switch is hovered or focused. The metric metadata is always its own section
 * (the builder writes SELECTED METRIC METADATA for a payload that names the switch), never a part of the result.
 */
export function peekKeys(id: SwitchId, _s?: AnalyzerSettings): string[] {
  if (id === 'metricMeta')
    return ['SELECTED METRIC METADATA', 'SELECTED METADATA'];
  const sw = CONTENT_SWITCHES.find((c) => c.id === id);
  return sw ? [sw.key] : [];
}

/** What the outline says for a switch's section: "not sent" when off, "none" when on but this target has none. */
export interface SectionNote {
  key: string;
  label: string;
  parent: ContentSwitch['parent'];
  message: 0 | 1;
  state: 'off' | 'empty';
}

export function sectionNotes(s: AnalyzerSettings): SectionNote[] {
  return CONTENT_SWITCHES.flatMap((c) => {
    const on = c.on(s);
    return [{ key: c.key, label: c.label, parent: c.parent, message: c.message, state: on ? 'empty' : 'off' }];
  });
}
