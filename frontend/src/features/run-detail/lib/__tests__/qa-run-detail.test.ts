import { describe, expect, it } from 'vitest';
import { issueStatus } from '../../components/analysis/MetricAnalysisCards';
import { analysisWarnings } from '../../components/items/ItemCard';
import { editTooltip } from '../../components/items/MetricStrip';
import { rawSpan } from '../../components/traces/SpanDetail';
import { buildCsv, discoverColumns } from '../csv';
import { latencyLabel } from '../rowDisplay';
import { queuedLabel, repeatCopy, statisticOptions } from '../repeatCopy';
import { buildRunModel } from '../runModel';
import type { Row, RunPayload } from '../../types';

const row = (extra: Partial<Row> = {}) =>
  ({ index: 0, item_id: 'a', status: 'completed', metric_values: [], ...extra }) as Row;

describe('issueStatus', () => {
  const issue = { issue_id: 'i1', category: 'C', subcategory: '', finding: '', category_reason: '' };
  it('the server review status wins over the issue JSON, by issue id', () => {
    const r = row({ review_issue_statuses: { m: [{ issue_id: 'i1', status: 'Rejected' }] } });
    expect(issueStatus(r, 'm', { ...issue, review_status: 'pending' }, 0, undefined)).toBe('rejected');
  });
  it('falls back to the issue, the analysis, then the legacy correction, then pending', () => {
    expect(issueStatus(row(), 'm', { ...issue, review_status: 'approved' }, 0, undefined)).toBe('approved');
    expect(issueStatus(row(), 'm', issue, 0, { review_status: 'rejected' })).toBe('rejected');
    expect(
      issueStatus(row({ review_corrections: { m: { status: 'approved' } } }), 'm', issue, 0, undefined),
    ).toBe('approved');
    expect(issueStatus(row(), 'm', issue, 0, undefined)).toBe('pending');
  });
  it('an id-less issue is matched by position, and never to an entry that has an id', () => {
    const noId = { ...issue, issue_id: undefined };
    expect(
      issueStatus(row({ review_issue_statuses: { m: [{ status: 'approved' }] } }), 'm', noId, 0, undefined),
    ).toBe('approved');
    expect(
      issueStatus(
        row({ review_issue_statuses: { m: [{ issue_id: 'x', status: 'approved' }] } }),
        'm',
        noId,
        0,
        undefined,
      ),
    ).toBe('pending');
  });
});

describe('analysisWarnings', () => {
  it('collects item and metric warnings once, case-insensitively', () => {
    const r = row({
      item_metadata: {
        analysis_warning: 'No taxonomy',
        metric_analyses: { a: { warning: 'no taxonomy' }, b: { warning: 'Low confidence' } },
      },
    });
    expect(analysisWarnings(r)).toEqual(['No taxonomy', 'Low confidence']);
  });
  it('does not repeat the item warning when an analysis failed', () => {
    const r = row({
      item_metadata: { analysis_warning: 'x', metric_analyses: { a: { error: 'boom', warning: 'y' } } },
    });
    expect(analysisWarnings(r)).toEqual([]);
  });
});

describe('editTooltip', () => {
  it('names the editor, the date and old -> new, plus the original score', () => {
    const t = editTooltip({
      original_score: 0.844,
      last_edit: { action: 'edit', by: 'Sara', at: '2026-10-01T12:00:00Z', from: 0.844, to: 1 },
    });
    const [who, change, original] = t.split('\n');
    expect(who).toMatch(/^Edited by Sara on /);
    expect(change).toBe('0.844 → 1');
    expect(original).toBe('Original score: 0.844');
  });
  it('says reset for a reset and falls back without a record', () => {
    expect(editTooltip({ last_edit: { action: 'reset', by: 'Sara', from: 1, to: 0.5 } })).toMatch(
      /^Reset by Sara/,
    );
    expect(editTooltip({})).toBe('Edited by a reviewer');
  });
});

describe('rawSpan', () => {
  it('drops every underscore bookkeeping key', () => {
    expect(rawSpan({ name: 'x', span_id: 's', _i: 1, _children: [], _retry: true, _failed: false })).toEqual({
      name: 'x',
      span_id: 's',
    });
  });
});

describe('latencyLabel', () => {
  it('0 ms is a value, null is a dash', () => {
    expect(latencyLabel(0)).toBe('0ms');
    expect(latencyLabel(null)).toBe('—');
    expect(latencyLabel(1500)).toBe('1.5s');
  });
});

describe('repeat copy', () => {
  it('help text follows the metric direction', () => {
    expect(repeatCopy(3, false, 30, 'minimize').passAtK).toContain('≤30%');
    expect(repeatCopy(3, false, 70, 'maximize').passHatK).toContain('≥70%');
    expect(repeatCopy(3, true, 100, 'minimize').passAtK).toContain('best score (0%)');
    expect(repeatCopy(3, false, 70, 'minimize').errors).toContain('left out of its scores');
  });
  it('offers four statistics for pass-based metrics and only Average otherwise', () => {
    expect(statisticOptions(true).map((o) => o.key)).toEqual([
      'compare',
      'pass_at_k',
      'pass_hat_k',
      'cumulative_avg',
    ]);
    expect(statisticOptions(false).map((o) => o.key)).toEqual(['cumulative_avg']);
  });
  it('words the queued passes row', () => {
    expect(queuedLabel(0, 3, 5)).toBeNull();
    expect(queuedLabel(1, 3, 5)).toBe('Pass 3 of 5 queued');
    expect(queuedLabel(2, 5, 5)).toBe('Passes 4–5 of 5 queued');
  });
});

describe('csv with the old headers', () => {
  const specs = {
    q: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  };
  const payload: RunPayload = {
    run: { run_id: 'r', status: 'COMPLETED', metric_names: ['q'], metric_specs: specs, samples: 1 },
    snapshot: { rows: [], metric_names: ['q'], metric_specs: specs },
  };
  const model = buildRunModel(payload, null);
  const rows = [
    row({
      latency_ms: 0,
      metric_values: [0.2],
      item_metadata: {
        domain: 'x',
        metric_analyses: { q: { root_cause_issues: [{ category: 'Retrieval', finding: 'missing' }] } },
      },
    }),
  ];
  it('uses #, meta:, <metric>_score and <metric>:root_cause_issues, and writes a 0 ms latency', () => {
    const cols = discoverColumns(rows, model);
    const csv = buildCsv(cols, rows).split('\r\n');
    const head = csv[0]!.split(',');
    expect(head[0]).toBe('#');
    expect(head).toContain('meta:domain');
    expect(head).toContain('q_score');
    expect(head).toContain('q:root_cause_issues');
    const line = csv[1]!;
    expect(line).toContain('"[{""category"":""Retrieval""');
    expect(line.split(',')[head.indexOf('latency_ms')]).toBe('0');
  });
});
