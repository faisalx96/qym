import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LiveTurnDetail } from '@/api/live';
import { liveEvidenceTurns, liveTurnDetail } from '@/features/dev/liveFixtures';
import { DIFF_CHAR_BUDGET } from '@/features/datasets/lib/wordDiff';
import { AnswerSqlTab } from '../components/turn/AnswerSqlTab';
import { DiagnosisTab } from '../components/turn/DiagnosisTab';
import { clauseDiff } from '../lib/sqlDiff';

function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current URL">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}
function show(data = liveEvidenceTurns['sql-mismatch'], url = '/turn?tab=answer', compact = false) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      {compact ? <DiagnosisTab data={data} /> : <AnswerSqlTab data={data} />}
      <Location />
    </MemoryRouter>,
  );
}
function custom(
  agent: Record<string, unknown>[],
  a: Record<string, unknown>[],
  b: Record<string, unknown>[] = [],
): LiveTurnDetail {
  return {
    ...liveTurnDetail,
    turn: { ...liveTurnDetail.turn, sql: agent },
    summary: {
      judges: { a: { sql_parts: a }, b: { sql_parts: b } },
    },
  };
}

describe('clauseDiff', () => {
  it('locates inserted WHERE and replaced GROUP BY fragments on their respective sides', () => {
    expect(
      clauseDiff('SELECT x FROM t GROUP BY region', 'SELECT x FROM t WHERE year = 2025 GROUP BY city'),
    ).toEqual({
      clauses: ['WHERE', 'GROUP BY'],
      leftOnly: 1,
      rightOnly: 2,
    });
  });
  it('keeps joins in FROM, nested queries in their outer clause, and CTE bodies in WITH', () => {
    expect(
      clauseDiff(
        'WITH c AS (SELECT x FROM old WHERE n=1) SELECT x FROM c JOIN a ON c.x=a.x WHERE x IN (SELECT x FROM a WHERE n=1)',
        'WITH c AS (SELECT x FROM new WHERE n=2) SELECT x FROM c JOIN b ON c.x=b.x WHERE x IN (SELECT x FROM a WHERE n=2)',
      ).clauses,
    ).toEqual(['WITH', 'FROM', 'WHERE']);
  });
  it('does not read quoted strings, comments or window ordering as top-level clauses', () => {
    expect(
      clauseDiff(
        "SELECT 'WHERE', ROW_NUMBER() OVER (ORDER BY a) /* GROUP BY */ FROM t",
        "SELECT 'FROM', ROW_NUMBER() OVER (ORDER BY b) /* LIMIT */ FROM t",
      ).clauses,
    ).toEqual(['SELECT']);
  });
  it('names HAVING, ORDER BY and LIMIT, including comments inside multiword clauses', () => {
    expect(
      clauseDiff(
        'SELECT x FROM t GROUP /* note */ BY a HAVING n>1 ORDER BY a LIMIT 10',
        'SELECT x FROM t GROUP /* note */ BY b HAVING n>2 ORDER BY b LIMIT 20',
      ).clauses,
    ).toEqual(['GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT']);
  });
  it('ignores formatting by default and counts merged fragments', () => {
    expect(clauseDiff('SELECT a FROM t', 'select A\nfrom T')).toEqual({
      clauses: [],
      leftOnly: 0,
      rightOnly: 0,
    });
    expect(clauseDiff('SELECT a FROM t', 'SELECT b,c FROM t')).toEqual({
      clauses: ['SELECT'],
      leftOnly: 1,
      rightOnly: 1,
    });
    expect(clauseDiff('SELECT a', 'select a', { ignoreFormatting: false }).clauses).toEqual(['SELECT']);
  });
  it('handles empty and over-budget inputs without claiming a clause changed', () => {
    expect(clauseDiff('', '')).toEqual({ clauses: [], leftOnly: 0, rightOnly: 0 });
    expect(clauseDiff('x'.repeat(DIFF_CHAR_BUDGET + 1), 'SELECT a')).toEqual({
      clauses: [],
      leftOnly: 0,
      rightOnly: 0,
    });
  });
});

describe('SQL comparison', () => {
  it('shows mismatch clauses, two kinds of marks, original SQL and default-visible previews', () => {
    const { container } = show();
    const row = screen.getByRole('region', { name: 'Sub-question 1 of 1' });
    expect(within(row).getByText('WHERE')).toBeVisible();
    expect(within(row).getByText('GROUP BY')).toBeVisible();
    expect(row.querySelector('[data-sql-mark="agent"]')).toBeVisible();
    expect(row.querySelector('[data-sql-mark="judge"]')).toBeVisible();
    expect(row.querySelector('del, s')).toBeNull();
    expect(row.querySelector('[data-sql-pane="agent"] pre')).toHaveTextContent('GROUP BY region');
    expect(row.querySelector('[data-sql-pane="judge"] pre')).toHaveTextContent('group by city');
    expect(within(row).getByText('Not equivalent')).toBeVisible();
    expect(within(row).getByText('Results differ')).toBeVisible();
    expect(row).toHaveTextContent('Agent 2 rows · Judge 10 rows');
    expect(within(row).getAllByRole('grid')).toHaveLength(2);
    expect(within(row).getByText('المنطقة الوسطى')).toBeVisible();
    expect(within(row).getByText('الرياض')).toBeVisible();
    expect(within(row).queryByRole('button', { name: /First .* rows/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent-only statements' })).toHaveTextContent(
      'Warehouse connection timed out.',
    );
    expect(screen.getByRole('region', { name: 'Agent-only statements' })).toHaveTextContent(
      'The evaluator could not re-run this statement: Warehouse replay timed out.',
    );
    expect(container.querySelectorAll('[aria-label="SQL difference legend"]')).toHaveLength(1);
  });
  it('distinguishes formatting and toggles literal differences without changing the selected judge', async () => {
    const user = userEvent.setup();
    const { container } = show(liveEvidenceTurns['chart-summary']);
    expect(screen.getByText('Same apart from formatting')).toBeVisible();
    expect(container.querySelector('[data-sql-mark]')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Ignore formatting' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('[data-sql-mark="agent"]')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Judge A' })).toBeChecked();
    await user.click(toggle);
    expect(screen.getByText('Same apart from formatting')).toBeVisible();
  });
  it('keeps vs in the URL and preserves other parameters and the statement anchor', async () => {
    const user = userEvent.setup();
    show(liveEvidenceTurns['chart-summary'], '/turn?tab=answer&vs=b&keep=1#part-1');
    expect(screen.getByRole('radio', { name: 'Judge B' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Judge A' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/turn?tab=answer&vs=a&keep=1#part-1');
  });
  it('defaults to the more-different judge and uses A for ties', () => {
    show(
      custom(
        [{ text: 'SELECT a FROM t' }],
        [{ text: 'select A from t' }],
        [{ text: 'SELECT b FROM t WHERE n=1' }],
      ),
    );
    expect(screen.getByRole('radio', { name: 'Judge B' })).toBeChecked();
  });
  it('shows blocked SQL, the privacy notice and no replay or empty-pane diff', () => {
    const { container } = show(liveEvidenceTurns['query-blocked']);
    expect(
      screen.getByText("Blocked by Insightor's privacy guard. The evaluator did not run it."),
    ).toBeVisible();
    expect(screen.getByText(/SELECT salary FROM/)).toBeVisible();
    expect(screen.getByText(/withheld replay for privacy/)).toBeVisible();
    expect(container.querySelector('[data-sql-mark]')).toBeNull();
    expect(screen.queryByText(/Replayed for comparison/)).not.toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
  it('pairs old rows by similarity without inventing per-statement verdicts', () => {
    const { container } = show(
      custom([{ text: 'SHOW TABLES' }, { text: 'SELECT a FROM t' }], [{ text: 'SELECT a FROM t WHERE a=1' }]),
    );
    const row = container.querySelector('#part-1')!;
    expect(row.querySelector('[data-sql-pane="agent"] pre')).toHaveTextContent('SELECT a FROM t');
    expect(row.querySelector('[data-sql-verdict]')).not.toHaveTextContent(
      /Equivalent|Results match|Not equivalent|Results differ/,
    );
    expect(screen.getByRole('region', { name: 'Agent-only statements' })).toHaveTextContent('SHOW TABLES');
  });
  it('does not mark missing statements and explains absent samples and judge errors', () => {
    const { container } = show(
      custom(
        [{ text: 'SHOW TABLES' }],
        [{ text: 'SELECT a FROM t', executed: false, error: 'Invalid column' }],
      ),
    );
    expect(screen.getByText('The agent ran no statement for this sub-question.')).toBeVisible();
    expect(container.querySelector('[data-sql-mark]')).toBeNull();
    expect(screen.getByLabelText('Judge A results')).toHaveTextContent('Invalid column');
  });
  it('preserves both texts when too large and never calls the comparison identical', () => {
    const large = `SELECT ${'x'.repeat(DIFF_CHAR_BUDGET)}`;
    const { container } = show(custom([{ text: large }], [{ text: 'SELECT x', agent_index: 0 }]));
    expect(screen.getByText('Too large to mark differences')).toBeVisible();
    expect(container.querySelector('[data-sql-mark]')).toBeNull();
    expect(container.querySelector('[data-sql-pane="agent"] code')?.textContent).toBe(large);
  });
  it('places the dialect fact with judge summary and omits dead keys', () => {
    const data = structuredClone(liveEvidenceTurns['chart-summary']);
    data.summary.sql_notes = { dialect_ok: true, validator_ok: false, reused_by_judges: true };
    show(data);
    expect(screen.getByLabelText('Judge A SQL summary')).toHaveTextContent('Judge SQL dialect OK');
    expect(screen.queryByText(/Validator|Reused by judges/)).not.toBeInTheDocument();
  });
  it('shows replay skips and zero rows without fabricated samples', () => {
    show(
      custom(
        [{ text: 'SELECT a FROM t', replay: { skipped: 'not_runnable', rows: null } }],
        [{ text: 'SELECT a FROM t', rows: 0 }],
      ),
    );
    expect(screen.getByText(/because it was not runnable/)).toBeVisible();
    expect(screen.getByLabelText('Agent results')).toHaveTextContent('Not run');
    expect(screen.getByLabelText('Judge A results')).toHaveTextContent('0 rows');
    expect(screen.getByText('Identical')).toBeVisible();
  });
  it('shows the worst A pair in Diagnosis and the other judge without a disclosure', () => {
    const data = custom(
      [{ text: 'SELECT a FROM t' }],
      [
        { text: 'SELECT a FROM t', agent_index: 0 },
        { text: 'SELECT b FROM t WHERE n=1', agent_index: 0 },
      ],
      [{ text: 'select A from t', agent_index: 0 }],
    );
    const { container } = show(data, '/turn?tab=diagnosis&keep=1', true);
    expect(screen.getByRole('region', { name: 'Sub-question 2 of 2' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open the full comparison' })).toHaveAttribute(
      'href',
      '/turn?tab=answer&keep=1&vs=a#part-2',
    );
    expect(screen.getByText('Judge B: same apart from formatting')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Compare with Judge B' })).toHaveAttribute(
      'href',
      '/turn?tab=answer&keep=1&vs=b#part-1',
    );
    expect(container.querySelector('[data-live-block="agent-sql"] [data-sql-mark]')).toBeVisible();
    expect(container.querySelector('[data-live-block="judge-sql"] [data-sql-mark]')).toBeVisible();
  });
  it('scrolls a comparison deep link to its statement', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      const { container } = show(
        custom([{ text: 'SELECT a FROM t' }], [{ text: 'SELECT a FROM t' }, { text: 'SELECT b FROM t' }]),
        '/turn?tab=answer&vs=a#part-2',
      );
      expect(scroll.mock.instances).toContain(container.querySelector('#part-2'));
    } finally {
      scroll.mockRestore();
    }
  });
  it('labels replay failures even when production has the same error text', () => {
    show(
      custom(
        [{ text: 'SELECT a FROM t', status: 'error', error: 'Timed out', replay: { error: 'Timed out' } }],
        [{ text: 'SELECT a FROM t' }],
      ),
    );
    expect(screen.getByText('The evaluator could not re-run this statement: Timed out')).toBeVisible();
    expect(screen.getAllByText('Timed out')).toHaveLength(2);
  });
  it.each([
    [{ skipped: true }, 'evaluation was skipped'],
    [{ turn_class: { name: 'refused_privacy' } }, 'refused privacy'],
    [{}, 'No judge SQL available'],
  ])('explains missing judge SQL from optional summary facts %#', (summary, reason) => {
    show({ ...custom([], []), summary });
    expect(screen.getByText(new RegExp(reason))).toBeVisible();
  });
  it('uses B in Diagnosis when A has no statements', () => {
    show(
      custom([{ text: 'SELECT a FROM t' }], [], [{ text: 'SELECT b FROM t', agent_index: 0 }]),
      '/turn',
      true,
    );
    expect(screen.getByRole('link', { name: 'Open the full comparison' })).toHaveAttribute(
      'href',
      '/turn?tab=answer&vs=b#part-1',
    );
  });
});
