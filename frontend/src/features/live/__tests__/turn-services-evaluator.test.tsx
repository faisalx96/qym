import { formatTableDate } from '@/lib/dates';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { LiveTurnDetail } from '@/api/live';
import { liveEvidenceTurns, liveTurnDetail, liveOverview } from '@/features/dev/liveFixtures';
import { ServicesTab } from '../components/turn/ServicesTab';
import { EvaluatorTab } from '../components/turn/EvaluatorTab';
import { ConversationTab } from '../components/turn/ConversationTab';
import { evaluationProblems, evaluationTiming } from '../lib/evaluatorRecord';
import { serviceEvidence, servicesTabBadge, matchToolFailures } from '../lib/serviceEvidence';
import { servicesOf, toolsOf } from '../lib/summary';

const withSummary = (summary: Record<string, unknown>): LiveTurnDetail => ({ ...liveTurnDetail, summary });

describe('Services and tools', () => {
  it('omits the lead for healthy services and does not invent a failure count without tools evidence', () => {
    const { container } = render(
      <ServicesTab
        data={withSummary({ services: { guardrail: { status: 'ok', fault: 'policy', score: 1 } } })}
      />,
    );
    expect(container.querySelector('p[data-tone="danger"], p[data-tone="warning"]')).not.toBeInTheDocument();
    expect(screen.getByText('privacy guard')).toBeInTheDocument();
    expect(screen.queryByText(/0 of .* calls failed/)).not.toBeInTheDocument();
  });

  it('shows the sql-mismatch failure reason in the lead and table, in severity order', () => {
    const data = liveEvidenceTurns['sql-mismatch'];
    const { container } = render(<ServicesTab data={data} />);
    const services = servicesOf(data.summary, data.specs);
    const failed = services.find((service) => service.status === 'failed')!;
    expect(container.querySelector('[data-tone="danger"]')).toHaveTextContent(failed.reason!);
    expect(screen.getByLabelText('Services')).toHaveTextContent(failed.reason!);
    expect(
      [...container.querySelectorAll('[data-live-turn-service]')].map((row) =>
        row.getAttribute('data-live-turn-service'),
      ),
    ).toEqual(services.map((service) => service.name));
    expect(
      within(screen.getByLabelText('Services')).getAllByText('Fail')[0]?.closest('[data-kind="state"]'),
    ).toHaveAttribute('data-tone', 'danger');
  });

  it.each([
    [
      { total_calls: 3, failed_calls: 1, fault_breakdown: { infra: 1, agent: 0 }, recovered: true },
      '1 of 3 calls failed (infrastructure 1), recovered',
    ],
    [{ total_calls: 2, blocked: 1 }, '2 calls, 1 blocked by the privacy guard'],
    [
      {
        router_intent: 'agent',
        router_confidence: 0.97,
        classified_intent: 'data question',
        classifier_used: 'judge',
      },
      'Router: agent (0.97). Evaluator read it as: data question (judge)',
    ],
    [
      {
        selected_tables: ['a', 'b', 'c'],
        judge_tables: ['a', 'b', 't1', 't2'],
        missing_tables: ['t1', 't2'],
      },
      'Missing: t1, t2. Selected 3. judges needed 4',
    ],
    [{ sql_score_a: 0.4, sql_score_b: 0.35, delta: 0.05 }, 'Judge A 0.40, Judge B 0.35, gap 0.05'],
    [{ attempt: 2, component_failures: ['intent'] }, 'Attempt 2. Failed parts: intent'],
    [
      { granted: [], fired: [{ stage: 'query_blocker', rule_id: 'G16' }] },
      'Privacy guardrail active. Fired: query blocker (G16)',
    ],
    [
      { span: 'check-scope', status_message: 'Connection reset', error_count: 3 },
      'check-scope: Connection reset (3 errors)',
    ],
  ])('reads a known signal shape as a sentence', (signals, expected) => {
    expect(serviceEvidence(signals)).toBe(expected);
  });

  it('keeps unknown signals collapsed and marks degraded services with warning', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ServicesTab
        data={withSummary({
          services: {
            new_service: {
              status: 'degraded',
              reason: 'Recovered on retry',
              signals: { custom_fact: 'Keep this evidence' },
            },
          },
        })}
      />,
    );
    expect(container.querySelector('[data-tone="warning"]')).toHaveTextContent('Recovered on retry');
    expect(screen.queryByText('Keep this evidence')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    expect(screen.getByText('Keep this evidence')).toBeInTheDocument();
  });

  it('keeps recognised signal summaries and expands their complete evidence', async () => {
    const user = userEvent.setup();
    render(
      <ServicesTab
        data={withSummary({
          services: {
            retrieval: {
              status: 'ok',
              signals: {
                selected_tables: ['sales', 'customers'],
                judge_tables: ['sales'],
                missing_tables: [],
                producer_note: 'Selected for the regional question',
              },
            },
          },
        })}
      />,
    );
    expect(screen.getByLabelText('Services')).toHaveTextContent('Selected 2');
    expect(screen.queryByText('Selected for the regional question')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    expect(screen.getByText('customers')).toBeVisible();
    expect(screen.getByText('Selected for the regional question')).toBeVisible();
    expect(screen.getByLabelText('Services')).toHaveTextContent('Selected 2');
  });

  it('matches repeated tool failures by order without losing unmatched evidence', () => {
    const tools = toolsOf({
      tools: {
        list: [
          { name: 'run_sql', step: 1, ok: true },
          { name: 'run_sql', step: 2, ok: false },
          { name: 'run_sql', step: 3, ok: false },
        ],
        failures: [
          { name: 'run_sql', error: 'First' },
          { name: 'run_sql', error: 'Second' },
          { name: 'other', error: 'Unmatched' },
        ],
      },
    });
    const matched = matchToolFailures(tools);
    expect(matched.calls.map((call) => call.failure?.error)).toEqual([undefined, 'First', 'Second']);
    expect(matched.unmatched[0]?.error).toBe('Unmatched');
  });

  it('shows failures under calls and preserves the old absent-list sentence', () => {
    const { rerender } = render(<ServicesTab data={liveTurnDetail} />);
    expect(
      within(screen.getByRole('list', { name: 'Tool calls' })).getByText('Output validation failed'),
    ).toBeInTheDocument();
    const summary = {
      tools: { calls: 3, failures: [{ name: 'query', error: 'Connection reset', fault: 'infra' }] },
    };
    rerender(<ServicesTab data={withSummary(summary)} />);
    expect(screen.getByText('Call list not available for this turn')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool failures')).toHaveTextContent('Connection reset');
    expect(screen.queryByRole('columnheader', { name: 'Step' })).not.toBeInTheDocument();
  });

  it('marks envelope differences and exposes the shell badge', () => {
    render(
      <ServicesTab
        data={withSummary({
          envelope: {
            expected_tools: ['query'],
            actual_tools: ['chart'],
            matched: false,
            intent: 'data question',
          },
          router: { intent: 'agent' },
        })}
      />,
    );
    expect(screen.getByText('expected, not called')).toBeInTheDocument();
    expect(screen.getByText('not expected')).toBeInTheDocument();
    expect(screen.getByText('Did not match')).toBeInTheDocument();
    expect(screen.getByText('Intent: data question · Router: agent')).toBeInTheDocument();
    expect(
      servicesTabBadge({
        services: { a: { status: 'ok' }, b: { status: 'failed' }, c: { status: 'skipped' } },
      }),
    ).toEqual({ count: 2, tone: 'danger' });
    expect(servicesTabBadge({})).toEqual({ count: 0, tone: undefined });
  });
});

describe('Evaluator record', () => {
  it('does not invent a zero duration for malformed or empty timings', () => {
    expect(evaluationTiming({ eval_meta: { stage_durations_s: {} } }).total).toBeNull();
    expect(evaluationTiming({ eval_meta: { durations_s: { metrics: 'slow', total: -1 } } }).total).toBeNull();
  });

  it('shows per-metric failures and categorical values and uses main formatting for lower-is-better scores', () => {
    const base = liveTurnDetail.scores[0]!;
    const data: LiveTurnDetail = {
      ...liveTurnDetail,
      scores: [
        {
          ...base,
          id: 501,
          metric_name: 'latency_test',
          spec: {
            ...base.spec!,
            metric_name: 'latency_test',
            label: 'Latency test',
            direction: 'minimize',
            pass_threshold: 3,
          },
          score_numeric: 2,
          meta: {},
        },
        {
          ...base,
          id: 502,
          metric_name: 'failed_metric',
          spec: null,
          score_numeric: null,
          score_raw: null,
          label: null,
          meta: { error_type: 'Timeout' },
        },
        {
          ...base,
          id: 503,
          metric_name: 'category_test',
          spec: null,
          score_numeric: null,
          score_raw: 'answer withheld',
          label: null,
          meta: {},
        },
      ],
    };
    const { container } = render(<EvaluatorTab data={data} />);
    expect(container.querySelector('[data-score-id="501"] [data-band]')).toHaveAttribute('data-band', '1');
    expect(container.querySelector('[data-score-id="502"]')).toHaveTextContent('Evaluation failed');
    expect(container.querySelector('[data-score-id="503"]')).toHaveTextContent('answer withheld');
  });

  it('shows what ran, models, viewer-clock times, attempts and unknown keys without duplicate raw fields', () => {
    const data = withSummary({
      manifest_hash: '1234567890abcdef',
      replaced_at: '2026-11-09T12:00:00Z',
      eval_meta: {
        eval_suite: 'manifest',
        eval_code_version: 'v3',
        rules_version: 'rules-4',
        mode: 'inquiry',
        judge_a_model: 'judge-a',
        models: { a: 'judge-a', custom: 'new-model' },
        vision_judge_model: 'vision',
        design_judge_model: 'design',
        design_rules_version: 'd2',
        attempt: 2,
        max_attempts: 3,
        backfill_job_id: 'job-1',
        reevaluated_from: 'turn-old',
        extra_note: 'keep me',
      },
    });
    render(<EvaluatorTab data={data} zone="Asia/Riyadh" />);
    expect(screen.getByText('What ran')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Attempt 2 of 3'),
    ).toHaveTextContent('Attempt 2 of 3');
    expect(screen.getByText(formatTableDate('2026-11-09T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getAllByText('judge-a')).toHaveLength(1);
    expect(screen.getByText('1234567890abcdef')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy manifest hash' })).toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
    expect(screen.queryByText('eval_code_version')).not.toBeInTheDocument();
    expect(screen.getByText('No problems during evaluation')).toBeInTheDocument();
  });

  it('keeps the viewer clock when the shell source query arrives late', () => {
    const client = new QueryClient();
    const data = {
      ...liveTurnDetail,
      turn: { ...liveTurnDetail.turn, evaluated_at: '2026-11-09T10:00:00Z' },
    };
    render(
      <QueryClientProvider client={client}>
        <EvaluatorTab data={data} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(formatTableDate('2026-11-09T10:00:00Z'))).toBeInTheDocument();
    act(() =>
      client.setQueryData(['project', 'demo', 'live', 'sources'], {
        sources: [{ ...liveOverview.status, id: data.turn.source_id, day_key_timezone: 'Asia/Riyadh' }],
      }),
    );
    expect(screen.getByText(formatTableDate('2026-11-09T10:00:00Z'))).toBeInTheDocument();
  });

  it('uses stage timings first and labels old manifest timings without inventing a stage split', () => {
    expect(
      evaluationTiming({
        eval_meta: {
          stage_durations_s: { enrichment: 0.4, metrics: 1.2, judges: 41, replay: 6.3, total: 49.5 },
          durations_s: { metrics: 900 },
        },
      }),
    ).toMatchObject({
      total: 49.5,
      parts: [
        { key: 'enrichment', seconds: 0.4 },
        { key: 'metrics', seconds: 1.2 },
        { key: 'judges', seconds: 41 },
        { key: 'replay', seconds: 6.3 },
        { key: 'other' },
      ],
    });
    expect(
      evaluationTiming({ eval_meta: { durations_s: { metrics: 1, manifest: 4, total: 5 } } }).parts,
    ).toEqual([
      { key: 'metrics', label: 'Metrics', seconds: 1 },
      { key: 'manifest', label: 'Manifest (judges + replay)', seconds: 4 },
    ]);
    expect(evaluationTiming(liveTurnDetail.summary).total).toBe(4.2);
  });

  it('collects all evaluation problems and retains failure text', () => {
    const data = withSummary({
      error: 'Connection reset',
      evaluation_failed: true,
      skipped: true,
      skip_reason: 'No trace',
      detail_truncated: true,
      text_truncated: true,
      services: {
        eval_health: { status: 'degraded', reason: 'Partial', signals: { component_failures: ['intent'] } },
      },
      eval_meta: {
        error_type: 'Timeout',
        enrichment_failed: true,
        enrichment_errors: ['Missing context'],
        viz_rows_dropped: 3,
      },
    });
    data.turn = { ...data.turn, rejected: ['unknown metric'] };
    render(<EvaluatorTab data={data} />);
    const problems = evaluationProblems(data);
    expect(problems).toHaveLength(11);
    for (const problem of problems) expect(screen.getByText(problem.text)).toBeInTheDocument();
    expect(screen.queryByText('No problems during evaluation')).not.toBeInTheDocument();
  });

  it('groups metrics, opens only one detail panel with bilingual prose and metadata, and supports keyboard selection', async () => {
    const user = userEvent.setup();
    const base = liveTurnDetail.scores[0]!;
    const data: LiveTurnDetail = {
      ...liveTurnDetail,
      scores: [
        {
          ...base,
          id: 101,
          metric_name: 'quality_one',
          spec: { ...base.spec!, metric_name: 'quality_one', label: 'Quality one', group: 'quality' },
          explanation:
            'The answer omitted the region requested in the question. / الإجابة لم تتضمن المنطقة المطلوبة في السؤال ولذلك فهي غير مكتملة.',
          meta: {
            confidence: 0.83,
            reason: 'The recorded reason must remain visible in the selected score details.',
            reasoning: 'The scorer compared every requested region against the supplied answer.',
            explanation: 'Only one of the requested regions appeared in the answer.',
            label: 'Incomplete',
            matches: [{ region: 'Riyadh', matched: false }],
            rubric: { coverage: { required: 2, found: 1 } },
            modified: true,
            last_edit: { user: 'internal editor' },
            empty_note: '',
            missing_note: null,
          },
        },
        {
          ...base,
          id: 102,
          metric_name: 'custom_metric',
          spec: null,
          skipped: true,
          skip_reason: 'Not applicable',
          explanation: 'Another explanation',
          meta: { custom_value: 42 },
        },
      ],
    };
    const { container } = render(<EvaluatorTab data={data} />);
    expect(screen.getByLabelText('Evaluation scores')).toHaveTextContent('Other');
    expect(screen.getByText('Skipped: Not applicable')).toBeInTheDocument();
    const first = container.querySelector<HTMLElement>('[data-score-id="101"]')!;
    first.focus();
    await user.keyboard('{Enter}');
    const panel = screen.getByRole('region', { name: 'Details for Quality one' });
    expect(within(panel).getByText('English')).toBeInTheDocument();
    expect(panel.querySelector('[dir="rtl"]')).toBeInTheDocument();
    expect(within(panel).getByText('confidence')).toBeInTheDocument();
    const metadata = within(panel).getByRole('group', { name: 'Judge metadata' });
    expect(metadata).toHaveTextContent('0.83');
    expect(metadata).toHaveTextContent(data.scores[0]!.meta.reason as string);
    expect(metadata).toHaveTextContent(data.scores[0]!.meta.reasoning as string);
    expect(metadata).toHaveTextContent(data.scores[0]!.meta.explanation as string);
    expect(metadata).toHaveTextContent('Incomplete');
    expect(within(metadata).getByRole('grid', { name: 'matches' })).toHaveTextContent('Riyadh');
    expect(within(metadata).getByText('coverage')).toBeInTheDocument();
    expect(within(metadata).getByText('required')).toBeInTheDocument();
    for (const key of ['modified', 'last_edit', 'empty_note', 'missing_note'])
      expect(within(metadata).queryByText(key)).not.toBeInTheDocument();
    expect(metadata).not.toHaveTextContent('internal editor');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('region', { name: 'Details for Quality one' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Details for custom_metric' })).toHaveTextContent('42');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-score-id="102"]')).toHaveFocus();
  });

  it.each([{}, { modified: true, original_score: 0.5, reason: '', explanation: null }])(
    'shows the no-details message when score metadata has no visible fields: %j',
    async (meta) => {
      const user = userEvent.setup();
      const base = liveTurnDetail.scores[0]!;
      const { container } = render(
        <EvaluatorTab data={{ ...liveTurnDetail, scores: [{ ...base, id: 101, meta }] }} />,
      );
      act(() => container.querySelector<HTMLElement>('[data-score-id="101"]')!.focus());
      await user.keyboard('{Enter}');
      const panel = screen.getByRole('region', { name: /^Details for / });
      expect(
        within(panel).getByRole('heading', { name: 'No details were recorded for this metric' }),
      ).toBeInTheDocument();
      expect(within(panel).queryByRole('group', { name: 'Judge metadata' })).not.toBeInTheDocument();
    },
  );

  it('keeps raw detail in its existing disclosure', async () => {
    const user = userEvent.setup();
    render(<EvaluatorTab data={liveTurnDetail} />);
    const raw = screen.getByRole('button', { name: /Raw evaluation detail/ });
    expect(raw).toHaveAttribute('aria-expanded', 'false');
    await user.click(raw);
    expect(screen.getByRole('tree', { name: 'Raw evaluation detail' })).toHaveTextContent('verdict');
  });
});

describe('Old turns and conversation context', () => {
  it('renders old and malformed evidence without undefined or empty optional sections', () => {
    const { container, rerender } = render(
      <>
        <ServicesTab data={liveTurnDetail} />
        <EvaluatorTab data={liveTurnDetail} />
      </>,
    );
    expect(container).not.toHaveTextContent('undefined');
    expect(screen.getByText('What ran')).toBeInTheDocument();
    const data = withSummary({ services: { broken: null }, tools: false, eval_meta: false });
    rerender(
      <>
        <ServicesTab data={data} />
        <EvaluatorTab data={data} />
      </>,
    );
    expect(container).not.toHaveTextContent('undefined');
    expect(screen.queryByText('Models')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool envelope')).not.toBeInTheDocument();
    expect(screen.queryByText('Other evaluator keys')).not.toBeInTheDocument();
  });

  it('shows rewritten follow-up context before the turn list, including old top-level fields', () => {
    const data = withSummary({
      question_context: {
        enriched_question: 'Sales in Riyadh last year?',
        previous_question: 'Show all sales',
        previous_answer: 'Previous answer',
      },
      selected_excerpt: 'Selected chart',
      question_prompt: 'Full follow-up prompt',
    });
    const { container } = render(
      <MemoryRouter>
        <ConversationTab data={data} slug="demo" source="source" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Sales in Riyadh last year?')).toBeInTheDocument();
    expect(screen.getByText('Selected chart')).toBeInTheDocument();
    expect(screen.getByText('Full follow-up prompt')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveTextContent('Question context');
    expect(
      within(screen.getByRole('list', { name: 'Conversation turns' })).getAllByRole('link'),
    ).toHaveLength(3);
  });
});
