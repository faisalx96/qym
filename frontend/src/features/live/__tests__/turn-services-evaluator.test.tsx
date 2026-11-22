import { formatTableDate } from '@/lib/dates';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { LiveTurnDetail } from '@/api/live';
import { liveEvidenceTurns, liveTurnDetail, liveOverview } from '@/features/dev/liveFixtures';
import { ServicesTab } from '../components/turn/ServicesTab';
import { EvaluatorTab } from '../components/turn/EvaluatorTab';
import { ConversationTab } from '../components/turn/ConversationTab';
import { evaluationProblems, evaluationTiming } from '../lib/evaluatorRecord';
import { serviceEvidence, servicesTabBadge, matchToolFailures } from '../lib/serviceEvidence';
import { servicesOf, toolsOf } from '../lib/summary';
import {
  explanationLanguageKey,
  ExplanationLanguageProvider,
  useExplanationLanguage,
} from '../ExplanationLanguage';

const withSummary = (summary: Record<string, unknown>): LiveTurnDetail => ({ ...liveTurnDetail, summary });

afterEach(() => localStorage.removeItem(explanationLanguageKey));

describe('Services and tools', () => {
  it('omits the lead for healthy services and does not invent a failure count without tools evidence', () => {
    const { container } = render(
      <ServicesTab
        data={withSummary({
          services: {
            guardrail: { status: 'ok', fault: 'policy', score: 1 },
            sql_api_url_id: { status: 'ok' },
          },
        })}
      />,
    );
    expect(container.querySelector('p[data-tone="danger"], p[data-tone="warning"]')).not.toBeInTheDocument();
    expect(screen.getByText('privacy guard')).toBeInTheDocument();
    expect(screen.getByText('Guardrail')).toBeInTheDocument();
    expect(screen.getByText('SQL API URL ID')).toBeInTheDocument();
    expect(screen.queryByText(/0 of .* calls failed/)).not.toBeInTheDocument();
  });

  it('shows the sql-mismatch finding once in the services table, in severity order', () => {
    const data = liveEvidenceTurns['sql-mismatch'];
    const { container } = render(<ServicesTab data={data} />);
    const services = servicesOf(data.summary, data.specs);
    const failed = services.find((service) => service.status === 'failed')!;
    expect(screen.getAllByText(failed.reason!)).toHaveLength(1);
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
    expect(container.querySelector('[data-shape][data-tone="warning"]')).toHaveTextContent('Degraded');
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

  it('omits service columns with no recorded values and uses evidence when the reason is absent', () => {
    const { rerender } = render(
      <ServicesTab
        data={withSummary({
          services: {
            router: { status: 'ok', signals: { total_calls: 2 } },
            custom: { status: 'skipped' },
          },
        })}
      />,
    );
    const table = screen.getByRole('treegrid', { name: 'Services' });
    expect(within(table).queryByRole('columnheader', { name: 'Fault of' })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: 'Score' })).toBeNull();
    expect(within(table).getByText('2 calls')).toBeInTheDocument();
    expect(within(table).getByText('No finding was recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Service glance' })).toBeNull();
    rerender(
      <ServicesTab
        data={withSummary({
          services: {
            router: {
              status: 'failed',
              score: 0,
              fault: 'agent',
              reason: 'The router chose the wrong route.',
            },
          },
        })}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Fault of' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Score' })).toHaveAttribute('data-align', 'end');
  });

  it('renders readable signal keys, data lists, booleans and nested evidence without a toolbar', async () => {
    const user = userEvent.setup();
    render(
      <ServicesTab
        data={withSummary({
          services: {
            retrieval: {
              status: 'ok',
              signals: {
                turn_type: 'Data answer',
                router_intent: 'agent',
                selected_tables: ['sales', 'customers'],
                missing_tables: [],
                both_reviews_wrong: false,
                recovered: true,
                counts: { matched: 2, failed: 0 },
                nested: { trace: { details: { kept: true } } },
              },
            },
          },
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    const signals = screen.getByLabelText('Signals');
    expect(signals).toHaveAttribute('data-columns', '3');
    for (const label of [
      'Turn type',
      'Router decision',
      'Tables selected',
      'Missing tables',
      'Both reviews wrong',
      'Counts · Matched',
    ])
      expect(within(signals).getByText(label)).toBeVisible();
    expect(within(signals).getByText('customers').closest('[data-kind]')).toHaveAttribute(
      'data-kind',
      'data',
    );
    expect(within(signals).getByText('Missing tables').closest('dt')?.nextElementSibling).toHaveTextContent(
      'None',
    );
    expect(
      within(signals).getByText('Both reviews wrong').closest('dt')?.nextElementSibling,
    ).toHaveTextContent('No');
    expect(within(signals).getByText('Recovered').closest('dt')?.nextElementSibling).toHaveTextContent('Yes');
    for (const label of ['Raw', 'Sections', 'Copy JSON', 'Expand all keys'])
      expect(within(signals).queryByRole('button', { name: label })).toBeNull();
    expect(within(signals).getByRole('button', { name: /trace/ })).toBeInTheDocument();
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

  it('shows failures in the calls table and preserves unmatched evidence', () => {
    const { rerender } = render(<ServicesTab data={liveTurnDetail} />);
    expect(
      within(screen.getByRole('treegrid', { name: 'Tool calls' })).getByText('Output validation failed'),
    ).toBeInTheDocument();
    const summary = {
      tools: { calls: 3, failures: [{ name: 'query', error: 'Connection reset', fault: 'infra' }] },
    };
    rerender(<ServicesTab data={withSummary(summary)} />);
    expect(screen.getByText('Call list not available for this turn')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool failures')).toHaveTextContent('Connection reset');
    expect(screen.queryByRole('columnheader', { name: 'Step' })).not.toBeInTheDocument();
  });

  it('keeps the recorded turn total when only part of the tool-call list is available', () => {
    const data = withSummary({ tools: { list: [{ name: 'run_sql', step: 2, ok: false }] } });
    render(<ServicesTab data={{ ...data, turn: { ...data.turn, tool_calls: 6 } }} />);
    expect(screen.getByText('1 of 6 calls failed')).toBeInTheDocument();
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
    expect(screen.getByRole('group', { name: 'Intent' })).toHaveTextContent('data question');
    expect(screen.getByRole('group', { name: 'Router' })).toHaveTextContent('agent');
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
        vision_extractor_model: 'extractor',
        worker_version: 'worker-7',
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
    expect(screen.getByText('How this turn was evaluated')).toBeInTheDocument();
    expect(screen.getByText('Attempt').closest('dt')?.nextElementSibling).toHaveTextContent('2 of 3');
    expect(screen.getByText(formatTableDate('2026-11-09T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getAllByText('judge-a')).toHaveLength(1);
    expect(screen.getByText('1234567890abcdef')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy manifest hash' })).toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
    for (const value of ['extractor', 'worker-7', 'rules-4', 'judge-a']) {
      expect(screen.getByText(value).closest('[data-live-card]')).toHaveAttribute(
        'data-live-card',
        'evaluator-method',
      );
    }
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
    expect(
      within(screen.getByLabelText('Evaluation scores')).getByText('Quality', { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getByText('Skipped: Not applicable')).toBeInTheDocument();
    const first = container.querySelector<HTMLElement>('[data-score-id="101"]')!;
    first.focus();
    await user.keyboard('{Enter}');
    const panel = screen.getByRole('region', { name: 'Details for Quality one' });
    expect(within(panel).queryByText('English')).not.toBeInTheDocument();
    expect(panel.querySelector('[dir="ltr"]')).toBeInTheDocument();
    expect(panel.querySelector('[dir="rtl"]')).not.toBeInTheDocument();
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

  it('keeps the entire score explanation in the chosen language and every evaluator block inside a card', async () => {
    const user = userEvent.setup();
    function Language() {
      const { setLanguage } = useExplanationLanguage();
      return (
        <>
          <button onClick={() => setLanguage('ar')}>Arabic</button>
          <button onClick={() => setLanguage('both')}>Both</button>
        </>
      );
    }
    const data = {
      ...liveTurnDetail,
      scores: [
        {
          ...liveTurnDetail.scores[0]!,
          metric_name: 'compliance_a',
          explanation: 'First line.\nSecond line remains visible. / السطر الأول.\nالسطر الثاني يبقى ظاهراً.',
        },
      ],
    };
    const { container } = render(
      <ExplanationLanguageProvider>
        <Language />
        <EvaluatorTab data={data} />
      </ExplanationLanguageProvider>,
    );
    const grid = screen.getByRole('grid', { name: 'Evaluation scores' });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Metric', 'Score', 'Judge / source', 'Explanation']);
    expect(grid).toHaveTextContent('Second line remains visible.');
    expect(grid).toHaveTextContent('Judge A');
    expect(grid).not.toHaveTextContent('السطر الثاني');
    await user.click(screen.getByRole('button', { name: 'Arabic' }));
    expect(grid).not.toHaveTextContent('First line.');
    expect(grid).toHaveTextContent('السطر الثاني يبقى ظاهراً.');
    await user.click(screen.getByRole('button', { name: 'Both' }));
    expect(grid).toHaveTextContent('Second line remains visible.');
    expect(grid).toHaveTextContent('السطر الثاني يبقى ظاهراً.');
    for (const heading of container.querySelectorAll('h2, h3'))
      expect(heading.closest('[data-live-card]')).not.toBeNull();
  });

  it('keeps raw detail in its existing disclosure', async () => {
    const user = userEvent.setup();
    render(<EvaluatorTab data={liveTurnDetail} />);
    const raw = screen.getByRole('button', { name: /Raw evaluation detail/ });
    expect(raw).toHaveAttribute('aria-expanded', 'false');
    await user.click(raw);
    expect(screen.getByRole('tree', { name: 'Raw evaluation detail' })).toHaveTextContent('verdict');
  });

  it.each([true, false])('uses categorical value labels from the metric spec (inline spec: %s)', (inline) => {
    const diagnosis = liveTurnDetail.scores.find((score) => score.metric_name === 'diagnosis')!;
    render(
      <EvaluatorTab
        data={{
          ...liveTurnDetail,
          scores: [{ ...diagnosis, spec: inline ? diagnosis.spec : null }],
        }}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Evaluation scores' });
    expect(
      within(grid).getByText('Diagnosis', { exact: true, selector: '[data-group-row] span' }),
    ).toBeInTheDocument();
    expect(within(grid).getByText('Agent problem', { exact: true })).toBeInTheDocument();
    expect(grid).not.toHaveTextContent('agent_problem');
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
    expect(screen.getByText('How this turn was evaluated')).toBeInTheDocument();
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

  it('shows time-ordered conversation rows with a selected current turn, preserves list links, and navigates by keyboard', async () => {
    const user = userEvent.setup();
    const data = withSummary({
      question_context: { enriched_question: 'Removed context' },
      question_prompt: 'Removed prompt',
    });
    data.conversation = [...data.conversation]
      .reverse()
      .map((turn, index) => (index === 1 ? { ...turn, question: 'How many orders were placed?' } : turn));
    function Location() {
      const location = useLocation();
      return (
        <output aria-label="Location">
          {location.pathname}
          {location.search}
        </output>
      );
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/?list=day%3D2026-11-01']}>
        <ConversationTab data={data} slug="demo" source="source" />
        <Location />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Question context')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed context')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed prompt')).not.toBeInTheDocument();
    const grid = screen.getByRole('grid', { name: 'Conversation turns' });
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(grid.querySelectorAll('[data-live-question]')).toHaveLength(3);
    const expected = [...data.conversation].sort((a, b) => Date.parse(a.turn_at) - Date.parse(b.turn_at));
    rows.forEach((row, index) => {
      const question = row.querySelector('[data-live-question]');
      expect(question).toHaveTextContent(expected[index]!.question);
      expect(question).toHaveAttribute('dir', index === 1 ? 'auto' : 'rtl');
      if (index !== 1) expect(question).toHaveAttribute('lang', 'ar');
      expect(row.querySelector('[data-col="turn"]')).toHaveTextContent(
        String(expected[index]!.turn_index! + 1),
      );
    });
    expect(screen.getByText('3 turns. Click a turn to open its page.')).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'Open turn' }).textContent).toBe('');
    expect(grid.querySelector('[aria-current="page"]')).toHaveAttribute('data-focused');
    const link = within(grid).getAllByRole('link')[0]!;
    expect(link).toHaveAttribute('href', expect.stringContaining('list=day%3D2026-11-01'));
    const href = link.getAttribute('href')!;
    act(() => link.closest('tr')!.focus());
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Location')).toHaveTextContent(href);
    expect(container.querySelectorAll('[data-live-card]')).toHaveLength(1);
  });

  it('describes a single conversation turn in the singular and preserves an unknown index', () => {
    render(
      <MemoryRouter>
        <ConversationTab
          data={{
            ...liveTurnDetail,
            conversation: [{ ...liveTurnDetail.conversation[0]!, turn_index: null }],
          }}
          slug="demo"
          source="source"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('1 turn. Click a turn to open its page.')).toBeInTheDocument();
    expect(
      screen.getByRole('grid', { name: 'Conversation turns' }).querySelector('tbody [data-col="turn"]'),
    ).toHaveTextContent('—');
  });
});
