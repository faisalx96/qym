import type { IconName } from '@/ui';
import type { SpanKind } from '../../lib/traceTree';

export const KIND_TONE: Record<SpanKind, string> = {
  LLM: 'var(--chart-4)',
  TOOL: 'var(--warning)',
  AGENT: 'var(--chart-1)',
  CHAIN: 'var(--info)',
  EVALUATOR: 'var(--chart-3)',
  RETRIEVER: 'var(--chart-2)',
  EMBED: 'var(--text-muted)',
  GUARDRAIL: 'var(--score-4)',
  DEFAULT: 'var(--text-muted)',
};

export const KIND_GLYPH: Record<SpanKind, string> = {
  LLM: 'L',
  TOOL: 'T',
  AGENT: 'A',
  CHAIN: 'C',
  EVALUATOR: 'E',
  RETRIEVER: 'R',
  EMBED: 'M',
  GUARDRAIL: 'G',
  DEFAULT: '·',
};

export const KIND_LABEL: Record<SpanKind, string> = {
  LLM: 'LLM call',
  TOOL: 'Tool',
  AGENT: 'Agent',
  CHAIN: 'Chain',
  EVALUATOR: 'Evaluator',
  RETRIEVER: 'Retriever',
  EMBED: 'Embedding',
  GUARDRAIL: 'Guardrail',
  DEFAULT: 'Span',
};

export const KIND_ICON: Record<SpanKind, IconName> = {
  LLM: 'llm',
  TOOL: 'tool',
  AGENT: 'agent',
  CHAIN: 'chain',
  EVALUATOR: 'check',
  RETRIEVER: 'retriever',
  EMBED: 'embedding',
  GUARDRAIL: 'guardrail',
  DEFAULT: 'list',
};
