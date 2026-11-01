import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { liveTurnDetail as turnDetail, liveOverview, liveTurnsPage } from '@/features/dev/liveFixtures';
import { parseLiveFilters, type LiveTurnDetail } from '@/api/live';
import { ApiError } from '@/lib/http';
import { LiveTurnPage } from '../LiveTurnPage';
import { DiagnosisTab } from '../components/turn/DiagnosisTab';
import { TurnTiles } from '../components/turn/TurnTiles';
import {
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
    expect(evalMetaOf(turnDetail.summary)).toEqual(turnDetail.summary.eval_meta);
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

  it('renders six comparisons and falls back to the original reasoning without parsing it', () => {
    const data = {
      ...turnDetail,
      summary: {
        judges: {
          a: { reasoning: 'Deviations:\n- missing year filter' },
          b: { reasoning: 'النتيجة غير مكتملة' },
        },
      },
    };
    const { container } = render(createElement(DiagnosisTab, { data }));
    expect(container.querySelectorAll('[data-live-block="why"] dt')).toHaveLength(6);
    expect(screen.getByText('What each judge said')).toBeInTheDocument();
    expect(screen.getByText(/missing year filter/)).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('النتيجة غير مكتملة')).toHaveAttribute('dir', 'auto');
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
    expect(screen.getByText('Chart screenshots arrive in a later release')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Services and tools' }));
    expect(screen.getByLabelText('Tool failures')).toHaveTextContent('Output validation failed');
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
