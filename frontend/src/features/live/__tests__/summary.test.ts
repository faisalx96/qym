import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { explanationLanguageKey } from '../ExplanationLanguage';

beforeEach(() => localStorage.removeItem(explanationLanguageKey));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(explanationLanguageKey);
});
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

function languageTurn(): LiveTurnDetail {
  const data = liveEvidenceTurns['privacy-refusal'];
  return {
    ...data,
    summary: {
      ...data.summary,
      verdict: {
        ...(data.summary.verdict as Record<string, unknown>),
        reason_en: 'The final diagnosis is based on the privacy rule.',
        reason_ar: 'يعتمد التشخيص النهائي على قاعدة الخصوصية.',
      },
    },
  };
}

describe('live turn evidence presentation', () => {
  it('uses the question as the title, keeps full identifiers and shows one page-wide verdict', () => {
    const data = languageTurn();
    const { container } = renderTurn(data);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(data.turn.question);
    expect(screen.getByRole('heading', { level: 1 }).querySelector('[dir="rtl"]')).not.toBeNull();
    const header = container.querySelector('[data-live-block="turn-header"]')!;
    expect(header).toHaveTextContent(data.turn.conversation_id!);
    expect(header).toHaveTextContent('Turn 1 of 1');
    expect(header).toHaveTextContent(liveOverview.status.name);
    expect(
      within(header as HTMLElement).queryByText(`Turn ${data.turn.turn_id}`, { exact: true }),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-live-block="why"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-live-block="diagnosis-label"]')).toHaveLength(1);
    expect(screen.getAllByText(verdictOf(data.summary)!.reasonEn!)).toHaveLength(1);
    expect(screen.queryByText(verdictOf(data.summary)!.reasonAr!)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Verdict' })).not.toBeInTheDocument();
    const strip = screen.getByRole('group', { name: 'Turn numbers' });
    expect(strip).toHaveAttribute('data-variant', 'compact');
    expect(strip.querySelectorAll('[data-tile]')).toHaveLength(6);
    expect(strip).toHaveTextContent('Agent success');
  });

  // One test per language: all three in one test clicked 21 tabs and passed the 20 s budget on a CI runner.
  it.each(['ar', 'both', 'en'] as const)(
    'changes every bilingual explanation across all tabs (%s)',
    async (language) => {
      const user = userEvent.setup();
      const data = languageTurn();
      const view = renderTurn(data);
      expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
      // English is the starting choice: leave it first, so that choosing it is a change too.
      if (language === 'en') await user.click(screen.getByRole('radio', { name: 'Both' }));
      await user.click(
        screen.getByRole('radio', { name: { en: 'English', ar: 'العربية', both: 'Both' }[language] }),
      );
      for (const tab of screen.getAllByRole('tab')) {
        await user.click(tab);
        const explanations = view.container.querySelectorAll('[data-language]');
        expect(explanations.length).toBeGreaterThan(0);
        for (const explanation of explanations) {
          expect(explanation).toHaveAttribute('data-language', language);
          if (language !== 'both')
            expect(explanation.querySelector(`[dir="${language === 'en' ? 'rtl' : 'ltr'}"]`)).toBeNull();
        }
        const verdict = view.container.querySelector('[data-live-block="why"]')!;
        expect(verdict.textContent!.includes(verdictOf(data.summary)!.reasonEn!)).toBe(language !== 'ar');
        expect(verdict.textContent!.includes(verdictOf(data.summary)!.reasonAr!)).toBe(language !== 'en');
      }
    },
  );

  it('remembers the language choice on reload', async () => {
    const user = userEvent.setup();
    const data = languageTurn();
    const view = renderTurn(data);
    await user.click(screen.getByRole('radio', { name: 'Both' }));
    expect(localStorage.getItem(explanationLanguageKey)).toBe('both');
    view.unmount();
    const reloaded = renderTurn(data);
    expect(screen.getByRole('radio', { name: 'Both' })).toBeChecked();
    expect(
      reloaded.container.querySelector('[data-live-block="why"] [data-language="both"]')?.children,
    ).toHaveLength(2);
    expect(screen.getAllByText(verdictOf(data.summary)!.reasonEn!)).toHaveLength(1);
    expect(screen.getAllByText(verdictOf(data.summary)!.reasonAr!)).toHaveLength(1);
  });

  it('keeps keyboard language selection working when persisting the choice fails', async () => {
    const user = userEvent.setup();
    const data = languageTurn();
    renderTurn(data);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    act(() => screen.getByRole('radio', { name: 'English' }).focus());
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'العربية' })).toBeChecked();
    expect(screen.queryByText(verdictOf(data.summary)!.reasonEn!)).not.toBeInTheDocument();
    expect(screen.getByText(verdictOf(data.summary)!.reasonAr!)).toBeInTheDocument();
  });

  it('shows SQL previews only in Answer and SQL', async () => {
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
    await user.click(screen.getByRole('tab', { name: 'Answer and SQL' }));
    expect(screen.getByText('Showing 2 of 124 rows')).toBeInTheDocument();
    const table = screen.getByRole('grid');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getByText('الرياض')).toHaveAttribute('dir', 'rtl');
    expect(within(table).getByText('NULL')).toHaveAttribute('data-tone', 'muted');
    expect(screen.getByText('Showing 2 of 3 columns')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Judges' }));
    expect(screen.queryByText('124 rows')).not.toBeInTheDocument();
    expect(screen.queryByText('Own SQL')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: "Compare with the agent's SQL" })).not.toBeInTheDocument();
  });

  it('shows agent replay counts separately and previews with an unknown total', async () => {
    const user = userEvent.setup();
    renderTurn({
      ...turnDetail,
      summary: {},
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
    await user.click(screen.getByRole('tab', { name: 'Answer and SQL' }));
    expect(screen.getByText('7 rows')).toBeInTheDocument();
    expect(screen.getAllByText('Replayed for comparison')).toHaveLength(2);
    expect(screen.getByLabelText('Agent statement 2 results')).toHaveTextContent('124 rows');
    expect(screen.getByRole('grid')).toHaveTextContent('الرياض');
    expect(screen.queryByText(/Showing .* columns/)).not.toBeInTheDocument();
  });

  it('keeps old SQL evidence unchanged and never previews zero rows', () => {
    renderTurn(
      {
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
      },
      'tab=answer',
    );
    expect(screen.getByText('SELECT old')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Judge A results')[0]).toHaveTextContent('No result sample available');
    expect(screen.getAllByLabelText('Judge A results')[1]).toHaveTextContent('0 rows');
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

  it('keeps sparse Diagnosis to three blocks and makes the empty rules header non-expandable', () => {
    const { container } = render(createElement(DiagnosisTab, { data: { ...turnDetail, summary: {} } }));
    expect(
      [...container.querySelectorAll('[data-live-block]')].map((node) =>
        node.getAttribute('data-live-block'),
      ),
    ).toEqual(['diagnosis-steps', 'rules', 'turn-facts']);
    expect(screen.getByText('No diagnosis steps recorded for this turn')).toBeInTheDocument();
    expect(screen.getByText('No turn facts recorded for this turn')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Insightor rules behind this verdict/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('No rules were recorded for this turn')).toBeVisible();
    expect(container).not.toHaveTextContent('0 of 0');
  });

  it('prefers summary compliance and falls back to score columns while preserving zero', () => {
    const data = {
      ...turnDetail,
      turn: { ...turnDetail.turn, latency_ms: 0, result_rows: 0 },
      summary: { judges: { a: { compliance: { overall: 0 } } } },
    };
    const { container } = render(createElement(TurnTiles, { data }));
    expect(container.querySelectorAll('[data-tile]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-live-stat]')).toHaveLength(6);
    expect(container.querySelector('[data-live-stat="rows"]')).toHaveTextContent('0');
    expect(container.querySelector('[data-tile="compliance_a"] [data-live-stat]')).toHaveTextContent('0%');
    expect(container.querySelector('[data-tile="compliance_b"] [data-live-stat]')).toHaveTextContent('38.0%');
    expect(container.querySelector('[data-tile="latency"] [data-live-stat]')).toHaveTextContent('0ms');
    expect(container.querySelector('[data-tile="rows"] [data-live-stat]')).toHaveTextContent('0');
  });

  it('renders the approved diagnosis and changes all seven panels through URL tabs', async () => {
    const user = userEvent.setup();
    const { container } = renderTurn();
    expect(container.querySelector('[data-live-block="turn-header"] [data-live-question]')).toHaveAttribute(
      'dir',
      'rtl',
    );
    expect(document.title).toContain(turnDetail.turn.question);
    expect(screen.getByRole('link', { name: /Product trace/ })).toHaveAttribute(
      'href',
      turnDetail.turn.trace_url,
    );
    expect(screen.queryByRole('button', { name: 'Next turn' })).not.toBeInTheDocument();
    for (const block of ['why', 'diagnosis-steps', 'rules', 'turn-facts']) {
      expect(container.querySelector(`[data-live-block="${block}"]`)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('tab', { name: 'Answer and SQL' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('tab=answer');
    expect(screen.getByRole('button', { name: 'Copy Agent SQL' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Judges' }));
    const judgeA = screen.getByLabelText('Judge A compliance');
    expect(within(judgeA).getByText('Overall').closest('dt')?.nextElementSibling).toHaveTextContent('42.0%');
    await user.click(screen.getByRole('tab', { name: 'Charts' }));
    expect(screen.getByRole('img', { name: /bar chart/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Services and tools' }));
    await user.click(screen.getByRole('tab', { name: 'Conversation' }));
    const conversation = screen.getByRole('grid', { name: 'Conversation turns' });
    expect(within(conversation).getAllByRole('link')).toHaveLength(2);
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

  it('orders only steps, rules and turn facts and shows numbered bilingual checks', () => {
    localStorage.setItem(explanationLanguageKey, 'both');
    const data = liveEvidenceTurns['privacy-refusal'];
    const { container } = renderTurn(data);
    const verdict = block(container, 'why');
    expect(verdict.getByText('Decided by an Insightor rule')).toBeInTheDocument();
    expect(verdict.getByText('96.0%')).toBeInTheDocument();
    const steps = block(container, 'diagnosis-steps').getByRole('grid');
    expect(
      within(steps)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['#', 'Check', 'What it found']);
    expect(within(steps).getByText('Rule')).toBeInTheDocument();
    expect(within(steps).getByText('Rule: check-scope')).toBeInTheDocument();
    expect(within(steps).getByText(verdictOf(data.summary)!.steps[0]!.textEn!)).toHaveAttribute('dir', 'ltr');
    expect(within(steps).getByText(verdictOf(data.summary)!.steps[0]!.textAr!)).toHaveAttribute('dir', 'rtl');
    const order = [...container.querySelectorAll('[role="tabpanel"] > [data-live-block]')].map((node) =>
      node.getAttribute('data-live-block'),
    );
    expect(order).toEqual(['diagnosis-steps', 'rules', 'turn-facts']);
  });

  it.each([
    ['rule', 'an Insightor rule'],
    ['judges', 'the two judges'],
    ['outcome', 'how the turn ended'],
    ['skipped', 'not evaluated'],
  ])('explains the %s decision basis', (basis, words) => {
    const { container } = renderTurn({ ...turnDetail, summary: { verdict: { basis, confidence: 0 } } });
    expect(block(container, 'why').getByText(`Decided by ${words}`)).toBeInTheDocument();
    expect(block(container, 'why').getByText('0.0%')).toBeInTheDocument();
  });

  it('uses the manifest explanation and Arabic label reason for old verdicts', () => {
    localStorage.setItem(explanationLanguageKey, 'both');
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
    expect(verdict.getByText('80.0%')).toBeInTheDocument();
    expect(
      block(container, 'diagnosis-steps').getByText('No diagnosis steps recorded for this turn'),
    ).toBeInTheDocument();
    expect(block(container, 'rules').queryByRole('button')).not.toBeInTheDocument();
    expect(block(container, 'rules').getByText('No rules were recorded for this turn')).toBeVisible();
    expect(
      block(container, 'turn-facts').getByText('No turn facts recorded for this turn'),
    ).toBeInTheDocument();
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

  it('labels evidence and names step kinds without an empty result column', () => {
    const { container } = renderTurn({
      ...turnDetail,
      summary: {
        verdict: {
          steps: [
            { kind: 'fact', text_en: 'One tool ran.', source: 'Tool: execute_sql_query' },
            { kind: 'judge', text_en: 'Both judges require city groups and year = 2025.', source: 'a' },
            { kind: 'replay', text_en: 'The rows were compared.', source: 'b' },
            { kind: 'future_check', text_en: 'A new kind of check.', source: 'prompt.md:12-15' },
          ],
        },
      },
    });
    const steps = block(container, 'diagnosis-steps');
    for (const text of [
      'Trace fact',
      'Judge score',
      'Re-run',
      'Future check',
      'Tool: execute_sql_query',
      'Judge: A',
      'Judge: B',
    ])
      expect(steps.getByText(text)).toBeInTheDocument();
    expect(steps.queryByText('a', { exact: true })).not.toBeInTheDocument();
    expect(steps.queryByText('prompt.md:12-15')).not.toBeInTheDocument();
    const rows = steps.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    for (const [index, row] of rows.entries()) {
      expect(within(row).getByRole('rowheader')).toHaveTextContent(String(index + 1));
      expect(within(row).getAllByRole('gridcell')).toHaveLength(2);
      expect(row.querySelector('[data-col="result"]')).toBeNull();
    }
  });

  it('collapses rules initially, sorts ids naturally and switches cited/all rules without exposing source locations', async () => {
    const user = userEvent.setup();
    const data = liveEvidenceTurns['privacy-refusal'];
    const makeRule = (id: string, role: string) => ({
      id,
      role,
      title_en: `Title ${id}`,
      title_ar: `عنوان ${id}`,
      verdict_en: `Explanation ${id}`,
      verdict_ar: `تفسير ${id}`,
      sources: [`insightor-be/prompts/${id}.md:10-20`],
    });
    const { container } = renderTurn({
      ...data,
      summary: {
        ...data.summary,
        rules_applied: [
          makeRule('G1', 'decided'),
          makeRule('B10', 'decided'),
          makeRule('B2', 'told_to_judges'),
          makeRule('B1', 'decided'),
        ],
      },
    });
    const rules = block(container, 'rules');
    const toggle = rules.getByRole('button', { name: /Insightor rules behind this verdict/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(rules.getByText('3 of 4 rules were cited:')).toBeInTheDocument();
    expect(rules.queryByRole('grid')).not.toBeInTheDocument();
    expect(
      within(toggle)
        .getAllByText(/^(B|G)\d+$/)
        .map((tag) => tag.textContent),
    ).toEqual(['B1', 'B10', 'G1']);
    act(() => toggle.focus());
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const ids = () =>
      within(rules.getByRole('grid'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getByRole('rowheader').textContent);
    expect(ids()).toEqual(['B1', 'B10', 'G1']);
    expect(rules.queryByRole('columnheader', { name: 'Cited by' })).not.toBeInTheDocument();
    const showAll = rules.getByRole('button', { name: 'Show all 4' });
    expect(showAll.closest('[data-part="disclosure-header"]')).toContainElement(toggle);
    await user.click(showAll);
    expect(ids()).toEqual(['B1', 'B2', 'B10', 'G1']);
    await user.click(screen.getByRole('radio', { name: 'العربية' }));
    expect(rules.queryByText('Title B1')).not.toBeInTheDocument();
    expect(rules.queryByText('Explanation B1')).not.toBeInTheDocument();
    expect(rules.getByText('عنوان B1')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('radio', { name: 'Both' }));
    expect(rules.getByText('Title B1')).toBeInTheDocument();
    expect(rules.getByText('تفسير B1')).toHaveAttribute('dir', 'rtl');
    for (const column of container.querySelectorAll('[data-live-block="rules"] [data-language="both"]'))
      expect(column.children).toHaveLength(2);
    await user.click(rules.getByRole('button', { name: 'Show cited only' }));
    expect(ids()).toEqual(['B1', 'B10', 'G1']);
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).not.toMatch(/insightor-be|\.md:|3fa9c1d2e4b7/);
    expect(rules.queryByRole('button', { name: 'Copy rule source' })).not.toBeInTheDocument();
  });

  it('offers all supplied rules when no rules were cited', async () => {
    const user = userEvent.setup();
    renderTurn(liveEvidenceTurns['chart-summary']);
    const toggle = screen.getByRole('button', { name: /Insightor rules behind this verdict/ });
    expect(toggle).toHaveTextContent('None of the 1 rules was cited');
    await user.click(toggle);
    expect(screen.getByText('No cited rules recorded for this turn')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show all 1' }));
    expect(screen.getByRole('grid', { name: 'Insightor rules behind this verdict' })).toHaveTextContent('B1');
  });

  it('shows privacy refusal, the fired guardrail and why replay was withheld', () => {
    const { container } = renderTurn(liveEvidenceTurns['privacy-refusal']);
    const facts = block(container, 'turn-facts');
    expect(facts.getByText('Refused for privacy, at the router')).toBeInTheDocument();
    expect(facts.getByRole('group', { name: 'Privacy' })).toHaveTextContent('Active');
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
      expect(facts.getByRole('group', { name: label })).toHaveTextContent('1');
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
    expect(facts.getByRole('group', { name: 'Privacy' })).toHaveTextContent('Not active');
    expect(facts.getByRole('group', { name: 'Internal details' })).toHaveTextContent('Unknown');
    expect(facts.queryByText('Methodology items beside the answer')).not.toBeInTheDocument();
  });

  it.each(['tab=judges'])(
    'retains dropped deviations, both languages and quoted evidence on %s',
    (search) => {
      localStorage.setItem(explanationLanguageKey, 'both');
      const data = structuredClone(liveEvidenceTurns['sql-mismatch']);
      const judges = data.summary.judges as Record<string, { deviations: Record<string, unknown>[] }>;
      judges.a!.deviations[0]!.quote = 'GROUP BY region';
      const { container } = renderTurn(data, search);
      const region = block(container, 'judge-a');
      expect(region.getByText('GROUP BY region')).toBeInTheDocument();
      expect(region.getAllByText('The answer omits the period.')[0]).toHaveAttribute('dir', 'ltr');
      expect(region.getAllByText('لا يذكر الجواب الفترة.')[0]).toHaveAttribute('dir', 'rtl');
      const dropped = region
        .getAllByText('Not counted: contradicts fact: the answer explicitly says 2025')[0]!
        .closest('tr');
      expect(dropped).toHaveAttribute('data-dropped', 'true');
      expect(dropped).toHaveTextContent('missing date');
    },
  );

  it('uses old flat deviations including their Arabic text when there is no judge object', () => {
    localStorage.setItem(explanationLanguageKey, 'both');
    const { container } = renderTurn(
      {
        ...turnDetail,
        summary: {
          deviations: [{ judge: 'a', axis: 'sql', text: 'Missing filter.', text_ar: 'الشرط مفقود.' }],
        },
      },
      'tab=judges',
    );
    const region = block(container, 'judge-a');
    expect(region.getByText('Missing filter.')).toHaveAttribute('dir', 'ltr');
    expect(region.getByText('الشرط مفقود.')).toHaveAttribute('dir', 'rtl');
    expect(
      block(container, 'judge-b').getByText('No reasoning available for this judge'),
    ).toBeInTheDocument();
  });

  it.each(['reasoning', 'review'])(
    'equalizes matching judge %s blocks after resize and language changes without empty sections',
    async (facet) => {
      let width = 1040;
      let heights = { a: 80, b: 160 };
      let measure = () => {};
      const bounds = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        if (this.querySelector(':scope > [data-live-block="judge-a"]'))
          return { ...bounds.call(this), width };
        if (this.parentElement?.dataset.judgeFacet === facet) {
          const side =
            this.closest('[data-live-block]')?.getAttribute('data-live-block') === 'judge-a' ? 'a' : 'b';
          return { ...bounds.call(this), height: heights[side] };
        }
        return bounds.call(this);
      });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private callback: () => void) {}
          observe(element: HTMLElement) {
            if (element.querySelector(':scope > [data-live-block="judge-a"]')) measure = this.callback;
          }
          unobserve() {}
          disconnect() {}
        },
      );
      const user = userEvent.setup();
      const { container } = renderTurn(liveEvidenceTurns['chart-summary'], 'tab=judges');
      const blocks = () => [...container.querySelectorAll<HTMLElement>(`[data-judge-facet="${facet}"]`)];
      expect(blocks().map((block) => block.style.getPropertyValue('--judge-facet-height'))).toEqual([
        '160px',
        '160px',
      ]);
      heights = { a: 50, b: 40 };
      await user.click(screen.getByRole('radio', { name: 'العربية' }));
      expect(blocks().map((block) => block.style.getPropertyValue('--judge-facet-height'))).toEqual([
        '50px',
        '50px',
      ]);
      heights = { a: 210, b: 130 };
      await user.click(screen.getByRole('radio', { name: 'Both' }));
      expect(blocks().map((block) => block.style.getPropertyValue('--judge-facet-height'))).toEqual([
        '210px',
        '210px',
      ]);
      width = 600;
      act(() => measure());
      expect(blocks().map((block) => block.style.getPropertyValue('--judge-facet-height'))).toEqual([
        '0px',
        '0px',
      ]);
      expect(container.querySelector('[data-judge-facet][data-empty]')).toBeNull();
      for (const side of ['a', 'b']) {
        const card = container.querySelector(`[data-live-block="judge-${side}"]`)!;
        expect(
          [...card.querySelectorAll('[data-judge-facet]')]
            .slice(0, 4)
            .map((item) => item.getAttribute('data-judge-facet')),
        ).toEqual(['identity', 'scores', 'reasoning', 'deviations']);
        expect(card).toHaveTextContent('No deviations found.');
      }
    },
  );

  it('keeps judging facets and facts in Judges and query explanations in Answer and SQL', async () => {
    const user = userEvent.setup();
    localStorage.setItem(explanationLanguageKey, 'both');
    const data = liveEvidenceTurns['chart-summary'];
    const { container } = renderTurn(data, 'tab=judges&list=day%3D2026-11-01');
    expect(screen.getByLabelText('Judge comparison')).toHaveTextContent(
      'Judges agreeYesDiagnosis confidence96.0%',
    );
    expect(block(container, 'judge-facts').getByText('Tool: suggest_chart')).toBeInTheDocument();
    for (const side of ['a', 'b'] as const) {
      const judge = block(container, `judge-${side}`);
      const card = container.querySelector(`[data-live-block="judge-${side}"]`)!;
      expect(card.querySelectorAll('[data-band]')).toHaveLength(3);
      expect(judge.getByText(`judge-${side}`).closest('[data-kind]')).toHaveAttribute('data-kind', 'data');
      expect(judge.getByText('Followed manifest')).toBeInTheDocument();
      expect(judge.getByText('Results match')).toBeInTheDocument();
      for (const facet of ['checks', 'against', 'review']) {
        expect(card.querySelector(`[data-judge-facet="${facet}"] dl`)).toHaveAttribute('data-columns', '3');
      }
      expect(judge.getByText('1/1')).toBeInTheDocument();
      expect(judge.getByText('Better SQL').closest('dt')?.nextElementSibling).toHaveTextContent('equivalent');
      const review = card.querySelector<HTMLElement>('[data-judge-facet="review"]')!;
      const facts = review.querySelector('dl')!;
      expect([...facts.querySelectorAll('dt')].map((label) => label.textContent)).toEqual([
        'Agreement',
        'Better SQL',
      ]);
      const reasoning = within(review).getByRole('heading', { name: 'Reasoning', level: 4 });
      expect(facts.nextElementSibling).toBe(reasoning.parentElement);
      expect(reasoning.nextElementSibling).toBe(review.querySelector('[data-language="both"]'));
      expect(card.querySelector('[data-judge-facet="sql"]')).not.toBeInTheDocument();
      expect(judge.queryByText('Own SQL')).not.toBeInTheDocument();
      expect(card.querySelector('[aria-expanded]')).not.toBeInTheDocument();
      expect(judge.queryByText(judgeOf(data.summary, side)!.sqlReasoningEn!)).not.toBeInTheDocument();
      expect(judge.queryByText(judgeOf(data.summary, side)!.sqlReasoningAr!)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Cross-review score')).not.toBeInTheDocument();
    for (const language of ['en', 'ar', 'both'] as const) {
      await user.click(
        screen.getByRole('radio', { name: { en: 'English', ar: 'العربية', both: 'Both' }[language] }),
      );
      for (const side of ['a', 'b'] as const) {
        const review = within(
          container.querySelector<HTMLElement>(
            `[data-live-block="judge-${side}"] [data-judge-facet="review"]`,
          )!,
        );
        const text = crossReviewOf(data.summary, side === 'a' ? 'a_on_b' : 'b_on_a')!;
        const en = review.queryByText(text.textEn!);
        const ar = review.queryByText(text.textAr!);
        if (language === 'ar') expect(en).not.toBeInTheDocument();
        else expect(en).toHaveAttribute('dir', 'ltr');
        if (language === 'en') expect(ar).not.toBeInTheDocument();
        else expect(ar).toHaveAttribute('dir', 'rtl');
      }
    }
    await user.click(screen.getByRole('tab', { name: 'Answer and SQL' }));
    for (const side of ['a', 'b'] as const) {
      await user.click(screen.getByRole('radio', { name: `Judge ${side.toUpperCase()}` }));
      const pane = within(container.querySelector<HTMLElement>('[data-sql-pane="judge"]')!);
      for (const language of ['en', 'ar', 'both'] as const) {
        await user.click(
          screen.getByRole('radio', { name: { en: 'English', ar: 'العربية', both: 'Both' }[language] }),
        );
        expect(screen.getAllByText('Why the judge wrote it this way')).toHaveLength(1);
        const en = pane.queryByText(judgeOf(data.summary, side)!.sqlReasoningEn!);
        const ar = pane.queryByText(judgeOf(data.summary, side)!.sqlReasoningAr!);
        if (language === 'ar') expect(en).not.toBeInTheDocument();
        else expect(en).toHaveAttribute('dir', 'ltr');
        if (language === 'en') expect(ar).not.toBeInTheDocument();
        else expect(ar).toHaveAttribute('dir', 'rtl');
      }
    }
  });

  it('falls back to old score checks, uses main score bands including zero and omits missing review fields', () => {
    const data = structuredClone(turnDetail);
    localStorage.setItem(explanationLanguageKey, 'both');
    data.summary.cross_review = {
      a_on_b: { agreement: false, better_sql: 'other' },
      b_on_a: { text_ar: 'تؤيد النتائج هذا التقييم.' },
    };
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
    expect(judge.getByText('0.0%').closest('[data-band]')).toHaveAttribute('data-band', '1');
    expect(judge.getByText('70.0%').closest('[data-band]')).toHaveAttribute('data-band', '3');
    expect(judge.getByText('69.0%').closest('[data-band]')).toHaveAttribute('data-band', '3');
    expect(container.querySelector('[data-live-block="judge-facts"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-judge-facet="route"]')).not.toBeInTheDocument();
    const reviewA = container.querySelector<HTMLElement>(
      '[data-live-block="judge-a"] [data-judge-facet="review"]',
    )!;
    expect(within(reviewA).queryByText('Reasoning')).not.toBeInTheDocument();
    expect(reviewA.querySelector('dl')!.parentElement!.children).toHaveLength(1);
    const reviewB = container.querySelector<HTMLElement>(
      '[data-live-block="judge-b"] [data-judge-facet="review"]',
    )!;
    expect(reviewB.querySelector('dl')).toBeNull();
    expect(within(reviewB).getByRole('heading', { name: 'Reasoning', level: 4 })).toBeInTheDocument();
    expect(within(reviewB).getByText('تؤيد النتائج هذا التقييم.')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('undefined');
  });

  it.each([
    ['correct', 'Correct route'],
    ['wrong', 'Wrong route'],
    ['unsure', 'Unsure'],
  ])('renders %s route review and privacy findings', (verdict, label) => {
    localStorage.setItem(explanationLanguageKey, 'both');
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

  it("keeps other tabs' evidence out of Diagnosis", () => {
    const { container } = renderTurn(liveEvidenceTurns['sql-mismatch']);
    for (const name of ['deviations', 'sql-comparison', 'answer', 'chart', 'turn-services', 'evaluator-line'])
      expect(container.querySelector(`[data-live-block="${name}"]`)).not.toBeInTheDocument();
  });
});
