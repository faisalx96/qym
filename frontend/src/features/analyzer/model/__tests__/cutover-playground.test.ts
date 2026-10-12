/**
 * Cutover of the playground.js / analyzer.html Node tests in
 * tests/platform/test_root_cause_issue_javascript.py: failed verdicts stay available for analysis,
 * a finished job reports its errors instead of success, and the approval signature only changes
 * when the approved examples do.
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisConfig, AnalysisJob, CompactRow } from '@/api/analysis';
import { summarize } from '../../blocks/JobStatus';
import { approvalSignature } from '../catalog';
import { buildAnalyzerRows, matchTargets } from '../targets';

describe('failed verdicts stay available for analysis', () => {
  it('a judged failure with a blank or absent error is a target; a scorer error or a task error is not', () => {
    const rows = [null, false, 0, '', '   '].map(
      (error, index) =>
        ({
          index,
          item_id: String(index),
          metric_values: [0],
          metric_meta: { accuracy: { label: 'failed', error } },
          item_metadata: {},
        }) as unknown as CompactRow,
    );
    rows.push({
      index: 5,
      item_id: 'metric-error',
      metric_values: [0],
      metric_meta: { accuracy: { status: 'error' } },
      item_metadata: {},
    } as unknown as CompactRow);
    rows.push({
      index: 6,
      item_id: 'task-error',
      metric_values: [0],
      error: 'Task failed',
      metric_meta: {},
      item_metadata: {},
    } as unknown as CompactRow);
    const built = buildAnalyzerRows({
      rows,
      metricNames: ['accuracy'],
      metricSpecs: {
        accuracy: {
          direction: 'maximize',
          pass_threshold: 0.8,
          schema_version: 2,
          score_type: 'percentage',
        } as never,
      },
      passNumber: null,
    });
    const matched = matchTargets(built, {
      selectedMetrics: ['accuracy'],
      maxScore: 0.8,
      skipAnalyzed: true,
      allowHumanOverwrite: false,
    });
    expect(matched.map((m) => m.row.item_id)).toEqual(['0', '1', '2', '3', '4']);
    expect(matched.every((m) => m.metrics.join() === 'accuracy')).toBe(true);
  });
});

describe('a finished analysis job reports errors instead of success', () => {
  const job = (result: Record<string, unknown>, progress: Record<string, unknown> = {}) =>
    ({
      status: 'completed',
      progress: { phase: 'completed', completed: 1, total: 1, errors: 0, retries: 0, ...progress },
      result,
    }) as unknown as AnalysisJob;

  it('all failed: nothing succeeded, one error group by code with its count', () => {
    const sum = summarize(
      job(
        {
          total_analyzed: 0,
          total_attempted: 1,
          total_persisted: 0,
          total_analysis_failed: 1,
          results: [
            {
              item_id: 'item-1',
              metric_name: 'accuracy_score',
              error_code: 'context_limit_exceeded',
              error: 'Prompt is too large <unsafe>',
            },
          ],
        },
        { errors: 1 },
      ),
    );
    expect(sum).toMatchObject({ attempted: 1, analyzed: 0, failed: 1 });
    expect(sum.groups).toEqual([['context_limit_exceeded', 1]]);
  });

  it('partial: some succeeded and some failed', () => {
    const sum = summarize(
      job(
        {
          total_attempted: 3,
          total_analyzed: 2,
          total_analysis_failed: 1,
          results: [{ error: 'Timed out' }],
        },
        { errors: 1 },
      ),
    );
    expect(sum).toMatchObject({ attempted: 3, analyzed: 2, failed: 1 });
  });

  it('human-protected skips are not errors', () => {
    const sum = summarize(
      job({
        total_attempted: 1,
        total_skipped_human: 1,
        results: [{ persistence_status: 'skipped_human_protection' }],
      }),
    );
    expect(sum).toMatchObject({ attempted: 1, analyzed: 1, failed: 0 });
    expect(sum.groups).toEqual([]);
  });

  it('groups errors by code, once per code', () => {
    const sum = summarize(
      job(
        {
          total_attempted: 5,
          total_analysis_failed: 3,
          results: [
            { error_code: 'context_limit_exceeded', error: 'First description', item_id: 'hidden-1' },
            { error_code: 'context_limit_exceeded', error: 'Second description', item_id: 'hidden-2' },
            { error_code: 'analysis_timeout', error: 'Third description', item_id: 'hidden-3' },
          ],
        },
        { errors: 3 },
      ),
    );
    expect(sum.groups).toEqual([
      ['context_limit_exceeded', 2],
      ['analysis_timeout', 1],
    ]);
  });
});

describe('the approval signature', () => {
  const example = (id: number, item: string, detail: string) => ({
    id,
    item_id: item,
    metric_name: 'accuracy',
    detail,
    root_cause_issues: [{ category: 'Hallucination', subcategory: detail }],
  });
  const first = {
    category_example_counts: { Hallucination: 2, 'Incomplete Answer': 0 },
    category_examples: {
      Hallucination: [example(2, 'b', 'Invented fact'), example(1, 'a', 'Wrong entity')],
      'Incomplete Answer': [],
    },
  } as unknown as AnalysisConfig;

  it('is order independent and detects a new approval', () => {
    const reordered = {
      category_example_counts: { 'Incomplete Answer': 0, Hallucination: 2 },
      category_examples: {
        'Incomplete Answer': [],
        Hallucination: [example(1, 'a', 'Wrong entity'), example(2, 'b', 'Invented fact')],
      },
    } as unknown as AnalysisConfig;
    expect(approvalSignature(first)).toBe(approvalSignature(reordered));
    const changed = {
      category_example_counts: { Hallucination: 2, 'Incomplete Answer': 1 },
      category_examples: {
        ...first.category_examples,
        'Incomplete Answer': [example(3, 'c', 'Omitted constraint')],
      },
    } as unknown as AnalysisConfig;
    expect(approvalSignature(first)).not.toBe(approvalSignature(changed));
  });
});
