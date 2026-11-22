import type { IconName } from '@/ui';
import type { SpanKind } from '../../lib/traceTree';

export const KIND_TONE: Record<SpanKind, string> = {
  LLM: 'var(--chart-4)',
  // Indigo, not amber: amber Tool sat too close to amber LLM and orange Evaluator (round 3 L2). One source for
  // the trace and the Latency tab.
  TOOL: 'var(--chart-5)',
  AGENT: 'var(--chart-1)',
  CHAIN: 'var(--info)',
  EVALUATOR: 'var(--chart-3)',
  RETRIEVER: 'var(--chart-2)',
  EMBED: 'var(--text-muted)',
  GUARDRAIL: 'var(--score-4)',
  DEFAULT: 'var(--text-muted)',
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
