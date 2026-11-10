import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  liveTurnDetail as turnDetail,
  liveOverview,
  liveTurnsPage,
  liveEvidenceTurns,
  liveSpecs,
} from '@/features/dev/liveFixtures';
import { parseLiveFilters, type LiveTurnDetail } from '@/api/live';
import { ApiError } from '@/lib/http';
import { LiveTurnPage } from '../LiveTurnPage';
import { DiagnosisTab } from '../components/turn/DiagnosisTab';
import { TurnTiles } from '../components/turn/TurnTiles';
import {
  verdictOf,
  turnClassOf,
  rulesAppliedOf,
  rulesVersionOf,
  crossReviewOf,
  judgeFactsOf,
  guardrailsOf,
  deliveredOf,
  questionContextOf,
  errorOf,
  chartsOf,
  comparisonRows,
  deviationsOf,
  evalMetaOf,
  judgeOf,
  servicesOf,
  sqlPartsOf,
  toolsOf,
} from '../lib/summary';

describe('live turn summary readers', () => {
  it('reads optional SQL previews and keeps replay counts separate from original counts', () => {
    const preview = {
      rows: 124,
      columns: ['region', 'total'],
      columns_total: 3,
      sample: [
        ['الرياض', '1250'],
        ['مكة', null],
      ],
    };
    const expected = { rows: 124, columns: preview.columns, columnsTotal: 3, sample: preview.sample };
    expect(judgeOf({ judges: { a: { sql_parts: [preview] } } }, 'a')?.sqlParts[0]).toMatchObject(expected);
    expect(sqlPartsOf([{ rows: 0, replay: preview }])[0]).toMatchObject({ rows: 0, replay: expected });
    expect(sqlPartsOf([{}])[0]).toEqual({
      text: null,
      executed: null,
      rows: null,
      error: null,
      columns: [],
      columnsTotal: null,
      sample: [],
      replay: null,
      status: null,
      blocked: null,
      subQuestion: null,
      agentIndex: null,
      semanticEquivalent: null,
      resultSetMatch: null,
      textSimilarity: null,
    });
  });

  it.each([null, false, 1, 'bad', {}, []])('ignores malformed SQL preview fields %#', (value) => {
    expect(
      sqlPartsOf([{ columns: value, columns_total: '2', sample: value, replay: value }])[0],
    ).toMatchObject({ columns: [], columnsTotal: null, sample: [] });
    expect(sqlPartsOf([{ replay: value }])[0]?.replay).toEqual(
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? { rows: null, columns: [], columnsTotal: null, sample: [], error: null, skipped: null }
        : null,
    );
  });

  it('preserves sample positions without coercing malformed cells or column names', () => {
    expect(
      sqlPartsOf([
        {
          columns: ['region', false, 'total'],
          columns_total: Infinity,
          sample: [null, 'bad', ['الرياض', {}, 7, false, null, '']],
          replay: { rows: '124', columns: {}, columns_total: NaN, sample: [false, [null, 'مكة']] },
        },
      ])[0],
    ).toMatchObject({
      columns: [],
      columnsTotal: null,
      sample: [['الرياض', null, null, null, null, '']],
      replay: { rows: null, columns: [], columnsTotal: null, sample: [[null, 'مكة']] },
    });
  });

  it('reads both judges and preserves the SQL execution evidence', () => {
    expect(judgeOf(turnDetail.summary, 'a')).toMatchObject({
      model: 'judge-a',
      compliance: { sql: 0.42, response: 0.37, overall: 0.42 },
      sqlParts: [{ executed: true, rows: 1, error: null }],
      vsAgent: { equivalent: false, resultSetMatch: false, coverage: { covered: 1, total: 3 } },
    });
    expect(judgeOf(turnDetail.summary, 'b')?.compliance.overall).toBe(0.38);
    expect(sqlPartsOf(turnDetail.turn.sql)[0]?.text).toContain('SELECT');
  });

  it('uses structured deviations only, grouped by judge without rewriting the text', () => {
    expect(
      deviationsOf({ judges: { a: { reasoning: 'Deviations:\n- missing year filter\n- no assumptions' } } }),
    ).toEqual([]);
    expect(deviationsOf(turnDetail.summary)).toEqual(turnDetail.summary.deviations);
    const a = { judge: 'a', axis: 'sql', text: 'Missing filter' };
    const b = { judge: 'b', axis: 'response', text: 'Missing explanation' };
    expect(deviationsOf({ deviations: [b, a, { ...b, text: 'Missing unit' }] })).toEqual([
      a,
      b,
      { ...b, text: 'Missing unit' },
    ]);
  });

  it('returns exactly the six comparison rows with missing facts left unknown', () => {
    expect(comparisonRows({}).map((row) => [row.label, row.value])).toEqual([
      ['Judge A own SQL vs agent', '—'],
      ['Judge B own SQL vs agent', '—'],
      ['Judges agree with each other', '—'],
      ['Sub-questions covered', '—'],
      ['Intent · tool envelope', '—'],
      ['Tool calls · budget', '—'],
    ]);
    const rows = comparisonRows(turnDetail.summary);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.value)).toEqual([
      'Not equivalent · results differ',
      'Not equivalent · results differ',
      'Yes',
      '1 / 3',
      'analytical_query · Matched · retrieval, sql_execution, visualization',
      '3 / 8',
    ]);
    expect(rows[0]?.tone).toBe('danger');
    expect(rows[2]?.tone).toBe('accent');
  });

  it('keeps zero, false and partial facts distinct from missing evidence', () => {
    const summary = {
      judges: {
        a: {
          compliance: { overall: 0 },
          vs_agent: { equivalent: false },
          sql_parts: [{ text: 'SELECT 0', executed: false, rows: 0, error: 'Timeout' }],
        },
      },
      judges_agree: false,
      coverage: { covered: 0, total: 2 },
      tools: { calls: 0, budget: 0, list: [] },
    };
    expect(judgeOf(summary, 'a')).toMatchObject({
      compliance: { sql: null, response: null, overall: 0 },
      sqlParts: [{ text: 'SELECT 0', executed: false, rows: 0, error: 'Timeout' }],
      vsAgent: { equivalent: false, resultSetMatch: null, coverage: null },
    });
    expect(comparisonRows(summary).map((row) => row.value)).toEqual([
      'Not equivalent · —',
      '—',
      'No',
      '0 / 2',
      '—',
      '0 / 0',
    ]);
    expect(toolsOf(summary)?.list).toEqual([]);
    expect(toolsOf({ tools: { calls: 0 } })?.list).toBeNull();
  });

  it('reads services, tool failures and calls, chart evidence and evaluator metadata', () => {
    expect(servicesOf(turnDetail.summary)).toContainEqual({
      name: 'sql_generation',
      reason: 'The generated query uses an incomplete category filter.',
      status: 'failed',
      score: 0,
      fault: 'agent',
      signals: { latency_ms: 120 },
    });
    expect(toolsOf(turnDetail.summary)).toMatchObject({
      calls: 3,
      budget: 8,
      failures: [{ name: 'visualization', step: 3, error: 'Output validation failed', fault: 'agent' }],
      list: [
        { name: 'retrieval', step: 1, ok: true },
        { name: 'sql_execution', step: 2, ok: true },
        { name: 'visualization', step: 3, ok: false },
      ],
    });
    expect(chartsOf(turnDetail.summary)).toMatchObject([
      {
        kind: 'bar',
        scores: { chart_fidelity: 0.45, chart_vision: 0.6 },
        issues: ['Missing category label'],
        reading: 'يقارن الرسم القيم في الفئات الواردة في السؤال.',
      },
    ]);
    expect(evalMetaOf(turnDetail.summary)).toEqual({
      ...(turnDetail.summary.eval_meta as object),
      rulesVersion: null,
      maxAttempts: null,
      stageDurations: null,
      visionJudgeModel: null,
    });
  });

  it('returns null or empty arrays for absent optional sections', () => {
    expect(judgeOf({}, 'a')).toBeNull();
    expect(deviationsOf({})).toEqual([]);
    expect(servicesOf({})).toEqual([]);
    expect(toolsOf({})).toBeNull();
    expect(chartsOf({})).toEqual([]);
    expect(evalMetaOf({})).toBeNull();
  });

  it.each([
    null,
    undefined,
    true,
    7,
    'unexpected',
    [],
    { judges: [], deviations: 'text', services: [null], tools: 1, charts: {}, eval_meta: [] },
    {
      judges: {
        a: {
          model: {},
          compliance: { sql: NaN, response: '1', overall: Infinity },
          reasoning: [],
          sql_parts: [null, 'sql', { text: {}, executed: 'yes', rows: '1' }],
          vs_agent: { equivalent: 1, coverage: [] },
        },
      },
      deviations: [null, {}, { judge: 'a', axis: 'sql', text: 1 }],
      services: { bad: null, partial: { status: [], signals: [] } },
      tools: { calls: '3', budget: false, failures: [null, {}], list: [null, {}] },
      charts: [null, { scores: { bad: NaN, good: 0 }, issues: [null, 'issue'] }],
    },
  ])('tolerates malformed input %# without inventing evidence', (value) => {
    const summary = value as unknown as Record<string, unknown>;
    expect(() => {
      judgeOf(summary, 'a');
      judgeOf(summary, 'b');
      deviationsOf(summary);
      servicesOf(summary);
      toolsOf(summary);
      chartsOf(summary);
      evalMetaOf(summary);
      sqlPartsOf(value);
    }).not.toThrow();
    expect(comparisonRows(summary)).toHaveLength(6);
    expect(comparisonRows(summary).every((row) => typeof row.value === 'string')).toBe(true);
  });

  it('filters invalid entries and never coerces nested objects to strings or scores', () => {
    expect(deviationsOf({ deviations: [null, { judge: 'a', axis: 'sql', text: {} }] })).toEqual([]);
    expect(judgeOf({ judges: { a: { compliance: { overall: '0.5' }, reasoning: {} } } }, 'a')).toMatchObject({
      reasoning: null,
      compliance: { overall: null },
    });
    expect(
      chartsOf({ charts: [{ scores: { valid: 0, invalid: '1' }, issues: [null, 'Issue'] }] })[0],
    ).toMatchObject({ scores: { valid: 0 }, issues: ['Issue'] });
  });
});

function LocationText() {
  const location = useLocation();
  return createElement('output', { 'aria-label': 'Current URL' }, `${location.pathname}${location.search}`);
}

function renderTurn(data: LiveTurnDetail = turnDetail, search = '', error?: ApiError) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  const slug = 'demo';
  const source = liveOverview.status.key;
  const turnKey = ['project', slug, 'live', 'turn', source, data.turn.turn_id];
  if (error) {
    const query = client.getQueryCache().build(client, { queryKey: turnKey });
    query.setState({ status: 'error', error });
  } else client.setQueryData(turnKey, data);
  client.setQueryData(['project', slug, 'live', 'sources'], {
    sources: [liveOverview.status],
    default_source: source,
  });
  const list = new URLSearchParams(search).get('list');
  if (list) {
    const filters = parseLiveFilters(new URLSearchParams(list));
    client.setQueryData(
      ['project', slug, 'live', 'turns', source, { ...filters, page_size: filters.page_size ?? 50 }],
      liveTurnsPage,
    );
  }
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            `/projects/demo/live/turns/${encodeURIComponent(data.turn.turn_id)}?source=${source}${search ? `&${search}` : ''}`,
          ],
        },
        createElement(LiveTurnPage, { slug, source, turnId: data.turn.turn_id }),
        createElement(LocationText),
      ),
    ),
  );
  return { ...view, source };
}

describe('live turn evidence presentation', () => {
  it('keeps the Diagnosis preview and links compact judge SQL to the comparison tab', async () => {
    const user = userEvent.setup();
    renderTurn({
      ...turnDetail,
      summary: {
        judges: {
          a: {
            sql_parts: [
              {
                text: 'SELECT region, total',
                executed: true,
                rows: 124,
                columns: ['region', 'total'],
                columns_total: 3,
                sample: [
                  ['الرياض', '1250'],
                  ['مكة', null],
                ],
              },
            ],
          },
        },
      },
    });
    for (const tab of ['Diagnosis']) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByText('124 rows')).toBeInTheDocument();
      const disclosure = screen.getByRole('button', { name: 'First 2 of 124 rows' });
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      await user.click(disclosure);
      const table = screen.getByRole('grid');
      expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
      expect(within(table).getByText('الرياض')).toHaveAttribute('dir', 'auto');
      expect(within(table).getByText('NULL')).toHaveAttribute('data-tone', 'muted');
      expect(screen.getByText('Showing 2 of 3 columns')).toBeInTheDocument();
    }
    await user.click(screen.getByRole('tab', { name: 'Judges' }));
    expect(screen.getByText('124 rows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First 2 of 124 rows' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: "Compare with the agent's SQL" });
    expect(link).toHaveAttribute('href', expect.stringContaining('tab=answer&vs=a#part-1'));
    await user.click(link);
    expect(screen.getByRole('tab', { name: 'Answer and SQL' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows agent replay counts separately and previews with an unknown total', async () => {
    const user = userEvent.setup();
    renderTurn({
      ...turnDetail,
      turn: {
        ...turnDetail.turn,
        sql: [
          {
            text: 'SELECT region',
            rows: 7,
            replay: {
              rows: null,
              columns: ['region'],
              sample: [['الرياض']],
            },
          },
          { text: 'SELECT total', replay: { rows: 124, sample: [] } },
        ],
      },
    });
    expect(screen.getByText('7 rows')).toBeInTheDocument();
    expect(screen.getByText('Replayed for comparison: — rows')).toBeInTheDocument();
    expect(screen.getByText('Replayed for comparison: 124 rows')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'First 1 rows' }));
    expect(screen.getByRole('grid')).toHaveTextContent('الرياض');
    expect(screen.queryByText(/Showing .* columns/)).not.toBeInTheDocument();
  });

  it('keeps old SQL evidence unchanged and never previews zero rows', () => {
    renderTurn({
      ...turnDetail,
      summary: {
        judges: {
          a: {
            sql_parts: [
              { text: 'SELECT old', executed: true },
              { text: 'SELECT empty', rows: 0, columns: ['region'], sample: [['unexpected']] },
            ],
          },
        },
      },
    });
    expect(screen.getByText('SELECT old')).toBeInTheDocument();
    expect(screen.getByText('— rows')).toBeInTheDocument();
    expect(screen.getByText('0 rows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^First / })).not.toBeInTheDocument();
    expect(screen.queryByText(/Replayed for comparison/)).not.toBeInTheDocument();
  });

  it('uses the specific not-found message only for a real 404', () => {
    renderTurn(turnDetail, '', new ApiError(404, 'Turn not found'));
    expect(screen.getByRole('alert')).toHaveTextContent('This turn is not in qym');
  });

  it('offers retry for a server failure', () => {
    renderTurn(turnDetail, '', new ApiError(503, 'Service unavailable'));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load this turn');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('This turn is not in qym')).not.toBeInTheDocument();
  });

  it('keeps the six comparison fallback and separates old reasoning into language blocks', () => {
    const data = {
      ...turnDetail,
      summary: {
        judges: {
          a: {
            reasoning:
              'Deviations: missing year filter in the generated SQL query. / الانحرافات: شرط السنة مفقود في الاستعلام الذي أنشأه الوكيل.',
          },
          b: { reasoning: 'النتيجة غير مكتملة' },
        },
      },
    };
    const { container } = render(createElement(DiagnosisTab, { data }));
    expect(container.querySelectorAll('[data-live-block="why"] dt')).toHaveLength(6);
    expect(screen.getByText('What each judge said')).toBeInTheDocument();
    expect(screen.getByText(/missing year filter/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/الانحرافات:/)).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('النتيجة غير مكتملة')).toHaveAttribute('dir', 'rtl');
    expect(screen.queryByText('Deviations the judges found')).not.toBeInTheDocument();
  });

  it('prefers summary compliance and falls back to score columns while preserving zero', () => {
    const data = {
      ...turnDetail,
      turn: { ...turnDetail.turn, latency_ms: 0, result_rows: 0 },
      summary: { judges: { a: { compliance: { overall: 0 } } } },
    };
    const { container } = render(createElement(TurnTiles, { data }));
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(container.querySelectorAll('[data-live-stat]')).toHaveLength(6);
    expect(container.querySelector('[data-live-stat="rows"]')).toHaveTextContent('0');
    expect(container.querySelector('[data-tile="compliance_a"] [data-part="value"]')).toHaveTextContent('0%');
    expect(container.querySelector('[data-tile="compliance_b"] [data-part="value"]')).toHaveTextContent(
      '38%',
    );
    expect(container.querySelector('[data-tile="latency"] [data-part="value"]')).toHaveTextContent('0ms');
    expect(container.querySelector('[data-tile="rows"] [data-part="value"]')).toHaveTextContent('0');
  });

  it('renders the approved diagnosis and changes all seven panels through URL tabs', async () => {
    const user = userEvent.setup();
    const { container } = renderTurn();
    expect(container.querySelector('[data-live-block="turn-header"] [data-live-question]')).toHaveAttribute(
      'dir',
      'auto',
    );
    expect(document.title).toContain(turnDetail.turn.question);
    expect(screen.getByRole('link', { name: /Product trace/ })).toHaveAttribute(
      'href',
      turnDetail.turn.trace_url,
    );
    expect(screen.queryByRole('button', { name: 'Next turn' })).not.toBeInTheDocument();
    for (const block of ['why', 'deviations', 'agent-sql', 'judge-sql', 'answer', 'chart', 'turn-services']) {
      expect(container.querySelector(`[data-live-block="${block}"]`)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('tab', { name: 'Answer and SQL' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('tab=answer');
    expect(screen.getByRole('button', { name: 'Copy SQL' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Judges' }));
    const judgeA = screen.getByLabelText('Judge A compliance');
    expect(
      within(judgeA).getByText('Overall compliance').closest('dt')?.nextElementSibling,
    ).toHaveTextContent('42%');
    await user.click(screen.getByRole('tab', { name: 'Charts' }));
    expect(screen.getByRole('img', { name: /bar chart/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Services and tools' }));
    await user.click(screen.getByRole('tab', { name: 'Conversation' }));
    const conversation = screen.getByRole('list', { name: 'Conversation turns' });
    expect(within(conversation).getAllByRole('link')).toHaveLength(3);
    expect(conversation.querySelector('[aria-current="page"]')).toHaveTextContent(turnDetail.turn.question);
    await user.click(screen.getByRole('tab', { name: 'Evaluator' }));
    const raw = screen.getByRole('button', { name: /Raw evaluation detail/ });
    expect(raw).toHaveAttribute('aria-expanded', 'false');
    await user.click(raw);
    expect(screen.getByRole('tree', { name: 'Raw evaluation detail' })).toHaveTextContent('verdict');
  });

  it('keeps all panels usable when optional summary sections have malformed shapes', async () => {
    const user = userEvent.setup();
    const data = {
      ...turnDetail,
      summary: {
        judges: [],
        charts: [null, false],
        services: { broken: null },
        tools: 'unavailable',
        eval_meta: false,
      },
      turn: { ...turnDetail.turn, trace_url: 'javascript:alert(1)', eval_trace_url: 'data:text/html,unsafe' },
    };
    renderTurn(data, 'tab=unrecognized');
    expect(screen.getByRole('tab', { name: 'Diagnosis' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('link', { name: /trace/ })).not.toBeInTheDocument();
    for (const name of [
      'Answer and SQL',
      'Judges',
      'Charts',
      'Services and tools',
      'Conversation',
      'Evaluator',
    ]) {
      await user.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tabpanel')).toBeInTheDocument();
      if (name === 'Services and tools')
        expect(screen.getByText('Call list not available for this turn')).toBeInTheDocument();
    }
  });

  it('uses the encoded list query for neighbours and retains it when navigating', async () => {
    const user = userEvent.setup();
    const list = 'day=2026-11-01&sort=-latency_ms&label=agent_problem';
    const { source } = renderTurn(turnDetail, new URLSearchParams({ list }).toString());
    expect(screen.getByRole('button', { name: 'Previous turn' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next turn' }));
    const url = new URL(screen.getByLabelText('Current URL').textContent!, 'https://example.com');
    expect(url.pathname).toBe(
      `/projects/demo/live/turns/${encodeURIComponent(liveTurnsPage.rows[1]!.turn_id)}`,
    );
    expect(url.searchParams.get('source')).toBe(source);
    expect(url.searchParams.get('list')).toBe(list);
  });
});

describe('contract evidence readers', () => {
  const privacy = liveEvidenceTurns['privacy-refusal'].summary;
  const chart = liveEvidenceTurns['chart-summary'].summary;
  const mismatch = liveEvidenceTurns['sql-mismatch'].summary;
  const blocked = liveEvidenceTurns['query-blocked'];

  it('reads verdict, class, rule sources and version', () => {
    expect(verdictOf(privacy)).toMatchObject({
      label: 'agent_ok',
      basis: 'rule',
      confidence: 0.96,
      reasonEn: expect.any(String),
      reasonAr: expect.any(String),
      steps: [
        { kind: 'rule', textEn: expect.any(String), textAr: expect.any(String), source: 'check-scope' },
      ],
    });
    expect(turnClassOf(privacy)).toEqual({ name: 'refused_privacy', stage: 'router', review: 'route' });
    expect(rulesAppliedOf(privacy)).toMatchObject([
      {
        id: 'G5',
        group: 'guardrail',
        role: 'decided',
        titleEn: expect.any(String),
        titleAr: expect.any(String),
        verdictEn: expect.any(String),
        verdictAr: expect.any(String),
        sources: ['insightor-be/src/config/prompts/local_prompts/router_pii_check.md:4-6'],
      },
    ]);
    expect(rulesVersionOf(privacy)).toBe('3fa9c1d2e4b7');
  });

  it('reads both judges, checks, deviations and statement comparisons', () => {
    for (const side of ['a', 'b'] as const) {
      expect(judgeOf(privacy, side)).toMatchObject({
        privacyViolation: false,
        reasoningEn: expect.any(String),
        reasoningAr: expect.any(String),
        routeReview: { verdict: 'correct', reasoningEn: expect.any(String), reasoningAr: expect.any(String) },
      });
      expect(judgeOf(mismatch, side)).toMatchObject({
        checks: { followedManifest: false, sqlWellFormed: true, responseCorrect: false },
        sqlReasoningEn: expect.any(String),
        sqlReasoningAr: expect.any(String),
        deviations: [
          {
            axis: 'sql',
            type: 'missing_filter',
            dropped: false,
            droppedReason: null,
            textEn: expect.any(String),
            textAr: expect.any(String),
          },
          {
            axis: 'response',
            dropped: true,
            droppedReason: 'contradicts fact: the answer explicitly says 2025',
          },
        ],
        sqlParts: [
          {
            subQuestion: 'أعلى عشر مدن في عام 2025',
            agentIndex: 0,
            semanticEquivalent: false,
            resultSetMatch: false,
            textSimilarity: 0.65,
          },
        ],
      });
    }
  });

  it('reads cross-review, judge facts, delivered charts and question context', () => {
    for (const side of ['a_on_b', 'b_on_a'] as const)
      expect(crossReviewOf(chart, side)).toMatchObject({
        textEn: expect.any(String),
        textAr: expect.any(String),
        agreement: true,
        betterSql: 'tie',
      });
    expect(judgeFactsOf(chart)).toEqual([
      {
        textEn: 'Chart shown to the user: bar chart, 10 categories, built from SQL #1 (10 rows).',
        source: 'Tool: suggest_chart',
      },
    ]);
    expect(deliveredOf(chart)).toMatchObject({
      charts: [
        {
          kind: 'chart',
          type: 'bar',
          title: expect.any(String),
          categories: 10,
          sourceRows: 10,
          result: 'as_asked',
          shownInAnswer: true,
        },
      ],
      methodology: [expect.any(String)],
      dataNotes: [expect.any(String)],
      datesShown: true,
      textTrimmedForChart: true,
    });
    expect(questionContextOf(chart)).toEqual({
      enrichedQuestion: 'ما أعلى عشر مدن من حيث عدد السكان في عام 2025؟',
      previousQuestion: 'اعرض عدد السكان لعام 2025.',
      previousAnswer: 'يمكن عرض عدد السكان حسب المدينة.',
      selectedExcerpt: 'حسب المدينة',
    });
  });

  it('separates production errors, blocked queries and withheld replays', () => {
    expect(sqlPartsOf(blocked.turn.sql)[0]).toMatchObject({
      status: 'blocked',
      blocked: 'privacy',
      executed: false,
      replay: { error: null, skipped: 'privacy', rows: null, sample: [] },
    });
    expect(guardrailsOf(blocked.summary)).toEqual({
      granted: { pii: true, internals: true, businessQuestion: true },
      fired: [
        {
          stage: 'query_blocker',
          kind: 'pii',
          ruleId: 'G16',
          textEn: 'The blocked query must not be replayed.',
          source: 'pii_judge.query',
        },
      ],
      replayWithheld: true,
    });
    expect(sqlPartsOf(liveEvidenceTurns['sql-mismatch'].turn.sql)[1]).toMatchObject({
      status: 'error',
      error: 'Warehouse connection timed out.',
      replay: { error: 'Warehouse replay timed out.' },
    });
    expect(evalMetaOf(chart)).toMatchObject({
      rulesVersion: '3fa9c1d2e4b7',
      maxAttempts: 3,
      visionJudgeModel: 'vision-judge',
      stageDurations: { enrichment: 0.4, metrics: 1.2, judges: 41, replay: 6.3, total: 49.5 },
    });
    expect(errorOf(mismatch)).toBe('Warehouse replay timed out for the second statement.');
  });

  it('orders services by severity then spec position, keeping unknown services and reasons', () => {
    const services = {
      services: {
        router: { status: 'ok' },
        finalize_report: { status: 'degraded' },
        future_service: { status: 'failed', reason: 'Future service failed.', fault: 'policy' },
        sql_execution: { status: 'failed', fault: 'infra', reason: 'Warehouse timed out.' },
        eval_health: { status: 'skipped' },
        retrieval: { status: 'ok' },
      },
    };
    expect(servicesOf(services).map((item) => item.name)).toEqual([
      'sql_execution',
      'future_service',
      'finalize_report',
      'router',
      'retrieval',
      'eval_health',
    ]);
    expect(
      servicesOf(
        services,
        liveSpecs.map((spec) => ({ ...spec, position: -spec.position })),
      )
        .filter((item) => item.status === 'ok')
        .map((item) => item.name),
    ).toEqual(['retrieval', 'router']);
    expect(servicesOf(services)[1]).toMatchObject({ reason: 'Future service failed.', fault: 'policy' });
  });

  it('falls back to old mixed strings and judge-filtered flat deviations without changing raw reasoning', () => {
    const en = 'The query needs a year filter to answer the question correctly.';
    const ar = 'يحتاج الاستعلام إلى شرط السنة للإجابة عن السؤال بشكل صحيح.';
    const text = `${en} / ${ar}`;
    const old = {
      judges: { a: { reasoning: text } },
      cross_review: { a_on_b: { text } },
      deviations: [
        { judge: 'b', axis: 'sql', text: 'Wrong judge' },
        { judge: 'a', axis: 'sql', text },
      ],
    };
    expect(judgeOf(old, 'a')).toMatchObject({
      reasoning: text,
      reasoningEn: en,
      reasoningAr: ar,
      checks: null,
      routeReview: null,
      privacyViolation: null,
      sqlReasoningEn: null,
      sqlReasoningAr: null,
      deviations: [{ axis: 'sql', textEn: en, textAr: ar, type: null, dropped: null, droppedReason: null }],
    });
    expect(crossReviewOf(old, 'a_on_b')).toEqual({
      textEn: en,
      textAr: ar,
      agreement: null,
      betterSql: null,
    });
    expect(
      judgeOf(
        { ...old, judges: { a: { reasoning: text, reasoning_en: '', reasoning_ar: null, deviations: [] } } },
        'a',
      ),
    ).toMatchObject({ reasoningEn: '', reasoningAr: null, deviations: [] });
    expect(sqlPartsOf(turnDetail.turn.sql)[0]?.status).toBeNull();
    expect(judgeOf(turnDetail.summary, 'a')?.reasoning).toBe(
      'The generated query uses an incomplete category filter.',
    );
  });

  it.each([{}, turnDetail.summary, null, [], 'bad', 9])(
    'keeps new evidence absent on old or malformed rows %#',
    (value) => {
      const summary = value as Record<string, unknown>;
      expect(verdictOf(summary)).toBeNull();
      expect(turnClassOf(summary)).toBeNull();
      expect(rulesAppliedOf(summary)).toEqual([]);
      expect(rulesVersionOf(summary)).toBeNull();
      expect(judgeFactsOf(summary)).toEqual([]);
      expect(guardrailsOf(summary)).toBeNull();
      expect(deliveredOf(summary)).toBeNull();
      expect(questionContextOf(summary)).toBeNull();
      expect(errorOf(summary)).toBeNull();
    },
  );

  it('does not coerce malformed contract fields', () => {
    expect(
      verdictOf({
        verdict: {
          label: 1,
          basis: 'invalid',
          confidence: Infinity,
          steps: [null, { kind: 1, text_en: {}, text_ar: false, source: [] }],
        },
      }),
    ).toEqual({
      label: null,
      basis: null,
      reasonEn: null,
      reasonAr: null,
      confidence: null,
      steps: [{ kind: null, textEn: null, textAr: null, source: null }],
    });
    expect(turnClassOf({ turn_class: { name: {}, stage: false, review: [] } })).toEqual({
      name: null,
      stage: null,
      review: null,
    });
    expect(
      rulesAppliedOf({
        rules_applied: [
          null,
          {
            id: 5,
            group: [],
            title_en: {},
            title_ar: false,
            verdict_en: 1,
            verdict_ar: [],
            sources: [null, 'path'],
            role: 'invalid',
          },
        ],
      }),
    ).toEqual([
      {
        id: null,
        group: null,
        titleEn: null,
        titleAr: null,
        verdictEn: null,
        verdictAr: null,
        sources: ['path'],
        role: null,
      },
    ]);
    expect(rulesVersionOf({ rules_version: 1 })).toBeNull();
    expect(errorOf({ error: {} })).toBeNull();
    expect(
      judgeOf(
        {
          judges: {
            a: {
              reasoning_en: [],
              reasoning_ar: {},
              sql_reasoning_en: 1,
              sql_reasoning_ar: false,
              privacy_violation: 'false',
              checks: { followed_manifest: 'true', sql_well_formed: 1, response_correct: {} },
              route_review: { verdict: 'other', reasoning_en: {}, reasoning_ar: [] },
              deviations: [
                null,
                { axis: 'other', type: 1, text_en: {}, text_ar: [], dropped: 'false', dropped_reason: 1 },
              ],
              sql_parts: [
                {
                  agent_index: -1,
                  sub_question: {},
                  semantic_equivalent: 1,
                  result_set_match: 'true',
                  text_similarity: Infinity,
                },
              ],
            },
          },
        },
        'a',
      ),
    ).toMatchObject({
      reasoningEn: null,
      reasoningAr: null,
      sqlReasoningEn: null,
      sqlReasoningAr: null,
      privacyViolation: null,
      checks: { followedManifest: null, sqlWellFormed: null, responseCorrect: null },
      routeReview: { verdict: null, reasoningEn: null, reasoningAr: null },
      deviations: [
        { axis: null, type: null, textEn: null, textAr: null, dropped: null, droppedReason: null },
      ],
      sqlParts: [
        {
          agentIndex: null,
          subQuestion: null,
          semanticEquivalent: null,
          resultSetMatch: null,
          textSimilarity: null,
        },
      ],
    });
    expect(
      crossReviewOf(
        { cross_review: { a_on_b: { text_en: {}, text_ar: 4, agreement: 'yes', better_sql: 'unknown' } } },
        'a_on_b',
      ),
    ).toEqual({ textEn: null, textAr: null, agreement: null, betterSql: null });
    expect(judgeFactsOf({ judge_facts: [null, { text_en: [], source: 1 }] })).toEqual([
      { textEn: null, source: null },
    ]);
    expect(
      guardrailsOf({
        guardrails: {
          granted: { pii: 'yes', internals: 1, business_question: [] },
          fired: [false, { stage: 'other', kind: 'other', rule_id: 1, text_en: {}, source: [] }],
          replay_withheld: 'true',
        },
      }),
    ).toEqual({
      granted: { pii: null, internals: null, businessQuestion: null },
      fired: [{ stage: null, kind: null, ruleId: null, textEn: null, source: null }],
      replayWithheld: null,
    });
    expect(
      deliveredOf({
        delivered: {
          charts: [
            null,
            {
              kind: 'invalid',
              type: {},
              title: [],
              categories: '10',
              source_rows: NaN,
              result: 'bad',
              shown_in_answer: 1,
            },
          ],
          methodology: [null, 'valid'],
          data_notes: {},
          dates_shown: 'false',
          text_trimmed_for_chart: 0,
        },
      }),
    ).toEqual({
      charts: [
        {
          kind: null,
          type: null,
          title: null,
          categories: null,
          sourceRows: null,
          result: null,
          shownInAnswer: null,
        },
      ],
      methodology: ['valid'],
      dataNotes: [],
      datesShown: null,
      textTrimmedForChart: null,
    });
    expect(
      questionContextOf({
        question_context: {
          enriched_question: 1,
          previous_question: [],
          previous_answer: {},
          selected_excerpt: false,
        },
      }),
    ).toEqual({
      enrichedQuestion: null,
      previousQuestion: null,
      previousAnswer: null,
      selectedExcerpt: null,
    });
    expect(
      evalMetaOf({
        eval_meta: {
          rules_version: 1,
          max_attempts: '3',
          vision_judge_model: [],
          stage_durations_s: { valid: 0, bad: '1', infinite: Infinity },
        },
      }),
    ).toMatchObject({
      rulesVersion: null,
      maxAttempts: null,
      visionJudgeModel: null,
      stageDurations: { valid: 0 },
    });
    expect(servicesOf({ services: { future: { reason: {}, status: false } } })[0]).toMatchObject({
      reason: null,
      status: null,
    });
    expect(
      sqlPartsOf([{ status: 'other', blocked: 'other', replay: { error: {}, skipped: 'other' } }])[0],
    ).toMatchObject({ status: null, blocked: null, replay: { error: null, skipped: null } });
  });

  it.each(Object.entries(liveEvidenceTurns))('renders all seven tabs for the %s fixture', async (_, data) => {
    const user = userEvent.setup();
    const view = renderTurn(data);
    for (const tab of screen.getAllByRole('tab')) {
      await user.click(tab);
      expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    }
    view.unmount();
  });
});

// Presentation deliberately splits legacy bilingual reasoning; it does not infer deviations from prose.
describe('root cause and judge facets', () => {
  function block(container: HTMLElement, name: string) {
    return within(container.querySelector<HTMLElement>(`[data-live-block="${name}"]`)!);
  }

  it('orders verdict, rules, turn facts and deviations and shows numbered bilingual steps', () => {
    const data = liveEvidenceTurns['privacy-refusal'];
    const { container } = renderTurn(data);
    const verdict = block(container, 'why');
    expect(verdict.getByText('an Insightor rule')).toBeInTheDocument();
    expect(verdict.getByText('0.96')).toBeInTheDocument();
    const steps = verdict.getByRole('list');
    expect(steps.tagName).toBe('OL');
    expect(within(steps).getByText('Rule')).toBeInTheDocument();
    expect(within(steps).getByText('check-scope')).toBeInTheDocument();
    expect(within(steps).getByText(verdictOf(data.summary)!.steps[0]!.textEn!)).toHaveAttribute('dir', 'ltr');
    expect(within(steps).getByText(verdictOf(data.summary)!.steps[0]!.textAr!)).toHaveAttribute('dir', 'rtl');
    const order = [...container.querySelectorAll('[role="tabpanel"] > [data-live-block]')].map((node) =>
      node.getAttribute('data-live-block'),
    );
    expect(order.slice(0, 4)).toEqual(['why', 'rules', 'turn-facts', 'deviations']);
  });

  it.each([
    ['rule', 'an Insightor rule'],
    ['judges', 'the two judges'],
    ['outcome', 'how the turn ended'],
    ['skipped', 'not evaluated'],
  ])('explains the %s decision basis', (basis, words) => {
    const { container } = renderTurn({ ...turnDetail, summary: { verdict: { basis, confidence: 0 } } });
    expect(block(container, 'why').getByText(words)).toBeInTheDocument();
    expect(block(container, 'why').getByText('0')).toBeInTheDocument();
  });

  it('uses the manifest explanation and Arabic label reason for old verdicts', () => {
    const en = 'The answer omits the requested year.';
    const ar = 'لا تتضمن الإجابة السنة المطلوبة.';
    const { container } = renderTurn({
      ...turnDetail,
      turn: { ...turnDetail.turn, label_reason: ar },
      scores: [
        {
          ...turnDetail.scores[0]!,
          metric_name: 'manifest_eval',
          explanation: `agent_problem — ${en}`,
          meta: { confidence: 0.8 },
        },
      ],
    });
    const verdict = block(container, 'why');
    expect(verdict.getByText(en)).toHaveAttribute('dir', 'ltr');
    expect(verdict.getByText(ar)).toHaveAttribute('dir', 'rtl');
    expect(verdict.getByText('0.8')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-live-block="why"] dt')).toHaveLength(7);
    expect(container.querySelector('[data-live-block="rules"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-live-block="turn-facts"]')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('undefined');
  });

  it('preserves an em dash inside an unprefixed old diagnosis reason', () => {
    const explanation = 'The query — including its filters — answers the question.';
    const { container } = renderTurn({
      ...turnDetail,
      scores: [{ ...turnDetail.scores[0]!, metric_name: 'manifest_eval', explanation }],
    });
    expect(block(container, 'why').getByText(explanation)).toHaveAttribute('dir', 'ltr');
  });

  it('places deciding rules first, with the version aside and judge instructions below', () => {
    const decided = rulesAppliedOf(liveEvidenceTurns['privacy-refusal'].summary)[0]!;
    const data = liveEvidenceTurns['chart-summary'];
    const rules = data.summary.rules_applied as unknown[];
    const { container } = renderTurn({
      ...data,
      summary: {
        ...data.summary,
        rules_applied: [...rules, { id: decided.id, title_en: decided.titleEn, role: 'decided' }],
      },
    });
    const region = container.querySelector('[data-live-block="rules"]')!;
    expect(region.querySelector('aside')).toHaveTextContent('3fa9c1d2e4b7');
    expect(region.textContent!.indexOf('G5')).toBeLessThan(
      region.textContent!.indexOf('Also given to the judges'),
    );
    expect(region.textContent!.indexOf('Also given to the judges')).toBeLessThan(
      region.textContent!.indexOf('B1'),
    );
  });

  it('shows privacy refusal, the fired guardrail and why replay was withheld', () => {
    const { container } = renderTurn(liveEvidenceTurns['privacy-refusal']);
    const facts = block(container, 'turn-facts');
    expect(facts.getByText('Refused for privacy, at the router')).toBeInTheDocument();
    expect(facts.getByText('Privacy').closest('dt')?.nextElementSibling).toHaveTextContent('Active');
    expect(facts.getByText('Privacy fired')).toBeInTheDocument();
    expect(facts.getByText('G5')).toBeInTheDocument();
    expect(
      facts.getByText('For privacy the evaluator ran no SQL of its own on this turn and stored no rows.'),
    ).toBeInTheDocument();
  });

  it('shows chart delivery, counts, trimming and follow-up context', () => {
    const data = liveEvidenceTurns['chart-summary'];
    const { container } = renderTurn(data);
    const facts = block(container, 'turn-facts');
    expect(container.querySelector('[data-live-block="turn-facts"]')).toHaveTextContent(
      'Bar chart, 10 categories, built from 10 rows, shown in the answer',
    );
    for (const label of ['Methodology items beside the answer', 'Data notes beside the answer'])
      expect(facts.getByText(label).closest('dt')?.nextElementSibling).toHaveTextContent('1');
    expect(
      facts.getByText('Insightor trimmed the text because a chart shows the values.'),
    ).toBeInTheDocument();
    const context = questionContextOf(data.summary)!;
    for (const text of [context.enrichedQuestion, context.previousQuestion, context.selectedExcerpt])
      expect(facts.getByText(text!)).toHaveAttribute('dir', 'auto');
  });

  it('keeps unknown classes readable and does not turn missing facts into zero counts', () => {
    const { container } = renderTurn({
      ...turnDetail,
      summary: {
        turn_class: { name: 'future_route' },
        delivered: {},
        guardrails: { granted: { pii: false } },
      },
    });
    const facts = block(container, 'turn-facts');
    expect(facts.getByText('future_route')).toBeInTheDocument();
    expect(facts.getByText('Privacy').closest('dt')?.nextElementSibling).toHaveTextContent('Not active');
    expect(facts.getByText('Internal details').closest('dt')?.nextElementSibling).toHaveTextContent(
      'Unknown',
    );
    expect(facts.queryByText('Methodology items beside the answer')).not.toBeInTheDocument();
  });

  it.each(['', 'tab=judges'])(
    'retains dropped deviations, both languages and quoted evidence on %s',
    (search) => {
      const data = structuredClone(liveEvidenceTurns['sql-mismatch']);
      const judges = data.summary.judges as Record<string, { deviations: Record<string, unknown>[] }>;
      judges.a!.deviations[0]!.quote = 'GROUP BY region';
      const { container } = renderTurn(data, search);
      const region = block(container, search ? 'judge-a' : 'deviations');
      expect(region.getByText('GROUP BY region')).toBeInTheDocument();
      expect(region.getAllByText('The answer omits the period.')[0]).toHaveAttribute('dir', 'ltr');
      expect(region.getAllByText('لا يذكر الجواب الفترة.')[0]).toHaveAttribute('dir', 'rtl');
      const dropped = region
        .getAllByText('Not counted: contradicts fact: the answer explicitly says 2025')[0]!
        .closest('li');
      expect(dropped).toHaveAttribute('data-dropped', 'true');
      expect(dropped).toHaveTextContent('missing_date');
    },
  );

  it('uses old flat deviations including their Arabic text when there is no judge object', () => {
    const { container } = renderTurn({
      ...turnDetail,
      summary: {
        deviations: [{ judge: 'a', axis: 'sql', text: 'Missing filter.', text_ar: 'الشرط مفقود.' }],
      },
    });
    const region = block(container, 'deviations');
    expect(region.getByText('Missing filter.')).toHaveAttribute('dir', 'ltr');
    expect(region.getByText('الشرط مفقود.')).toHaveAttribute('dir', 'rtl');
    expect(region.getByText('No reasoning available for this judge.')).toBeInTheDocument();
  });

  it('renders new judge facets, pass scores, common facts and SQL navigation without disclosures', () => {
    const data = liveEvidenceTurns['chart-summary'];
    const { container } = renderTurn(data, 'tab=judges&list=day%3D2026-11-01');
    expect(screen.getByLabelText('Judge comparison')).toHaveTextContent(
      'Judges agreeYesDiagnosis confidence0.96',
    );
    expect(block(container, 'judge-facts').getByText('Tool: suggest_chart')).toBeInTheDocument();
    for (const side of ['a', 'b'] as const) {
      const judge = block(container, `judge-${side}`);
      const card = container.querySelector(`[data-live-block="judge-${side}"]`)!;
      expect(card.querySelectorAll('[data-verdict="pass"]')).toHaveLength(3);
      expect(judge.getByText(`judge-${side}`)).toHaveAttribute('data-kind', 'model');
      expect(judge.getByText('Followed manifest')).toBeInTheDocument();
      expect(judge.getByText('Results match')).toBeInTheDocument();
      expect(judge.getByText('1/1')).toBeInTheDocument();
      expect(judge.getByText('Better SQL').closest('dt')?.nextElementSibling).toHaveTextContent('equivalent');
      const link = judge.getByRole('link', { name: "Compare with the agent's SQL" });
      expect(link).toHaveAttribute('href', expect.stringContaining(`vs=${side}#part-1`));
      expect(link).toHaveAttribute('href', expect.stringContaining('source='));
      expect(link).toHaveAttribute('href', expect.stringContaining('list='));
      expect(card.querySelector('[aria-expanded]')).not.toBeInTheDocument();
      expect(judge.getByText(judgeOf(data.summary, side)!.sqlReasoningAr!)).toHaveAttribute('dir', 'rtl');
    }
    expect(screen.queryByText('Cross-review score')).not.toBeInTheDocument();
  });

  it('falls back to old score checks and applies the spec threshold including zero', () => {
    const data = structuredClone(turnDetail);
    data.specs = data.specs.map((spec) =>
      spec.metric_name === 'compliance_a' ? { ...spec, pass_threshold: 0.7 } : spec,
    );
    data.scores = [
      {
        ...data.scores[0]!,
        metric_name: 'compliance_a',
        meta: { followed_manifest: false, sql_well_formed: true, response_correct: false },
        score_numeric: 0,
      },
    ];
    const judges = data.summary.judges as Record<string, { compliance: Record<string, number> }>;
    judges.a!.compliance = { sql: 0, response: 0.7, overall: 0.69 };
    const { container } = renderTurn(data, 'tab=judges');
    const judge = block(container, 'judge-a');
    expect(judge.getByText('Followed manifest').closest('dt')?.nextElementSibling).toHaveTextContent('No');
    expect(judge.getByText('SQL well formed').closest('dt')?.nextElementSibling).toHaveTextContent('Yes');
    expect(judge.getByText('0%').closest('[data-verdict]')).toHaveAttribute('data-verdict', 'fail');
    expect(judge.getByText('70%').closest('[data-verdict]')).toHaveAttribute('data-verdict', 'pass');
    expect(judge.getByText('69%').closest('[data-verdict]')).toHaveAttribute('data-verdict', 'fail');
    expect(container.querySelector('[data-live-block="judge-facts"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-judge-facet="route"]')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('undefined');
  });

  it.each([
    ['correct', 'Correct route'],
    ['wrong', 'Wrong route'],
    ['unsure', 'Unsure'],
  ])('renders %s route review and privacy findings', (verdict, label) => {
    const data = structuredClone(liveEvidenceTurns['privacy-refusal']);
    const judges = data.summary.judges as Record<string, Record<string, unknown>>;
    judges.a!.privacy_violation = true;
    judges.a!.route_review = {
      verdict,
      reasoning_en: 'This is the route review.',
      reasoning_ar: 'هذه مراجعة المسار.',
    };
    const { container } = renderTurn(data, 'tab=judges');
    const judge = block(container, 'judge-a');
    expect(judge.getByText(label)).toBeInTheDocument();
    expect(judge.getByText('This is the route review.')).toHaveAttribute('dir', 'ltr');
    expect(judge.getByText('هذه مراجعة المسار.')).toHaveAttribute('dir', 'rtl');
    expect(
      judge.getByText("This judge found the answer reveals one person's data.").closest('[data-tone]'),
    ).toHaveAttribute('data-tone', 'danger');
  });

  it('shows failed and degraded service reasons on Diagnosis', () => {
    const { container } = renderTurn({
      ...turnDetail,
      summary: {
        services: {
          sql_execution: { status: 'failed', reason: 'Warehouse unavailable.' },
          finalize_report: { status: 'degraded', reason: 'Answer was incomplete.' },
        },
      },
    });
    const services = block(container, 'turn-services');
    expect(services.getByText('Warehouse unavailable.')).toBeInTheDocument();
    expect(services.getByText('Answer was incomplete.')).toBeInTheDocument();
  });
});
