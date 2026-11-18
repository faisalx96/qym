import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LiveTurnDetail } from '@/api/live';
import { liveEvidenceTurns, liveTurnDetail } from '@/features/dev/liveFixtures';
import { DIFF_CHAR_BUDGET } from '@/features/datasets/lib/wordDiff';
import { AnswerSqlTab } from '../components/turn/AnswerSqlTab';
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
function show(data = liveEvidenceTurns['sql-mismatch'], url = '/turn?tab=answer') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AnswerSqlTab data={data} />
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
  it.each([
    ['privacy', "Blocked by Insightor's privacy guard."],
    ['table_permission', 'Blocked by table permissions.'],
    ['validation', 'Blocked by SQL validation.'],
    [undefined, 'Statement blocked.'],
  ])('keeps the real blocked reason for %s', (blocked, notice) => {
    show(
      custom(
        [{ text: 'SELECT a FROM t', status: 'blocked', blocked, error: 'Producer block details' }],
        [{ text: 'SELECT a FROM t' }],
      ),
    );
    expect(screen.getByText(`${notice} The evaluator did not run it.`)).toBeVisible();
    if (blocked !== 'privacy') {
      expect(screen.getByText('Producer block details')).toBeVisible();
      expect(screen.queryByText(/privacy guard/)).toBeNull();
    }
    expect(screen.getByLabelText('Agent results')).toHaveTextContent('Not run');
  });

  it.each([false, true])('keeps paired original execution facts with replay %s', (replayed) => {
    const { container } = show(
      custom(
        [{ text: 'SELECT a FROM t', executed: true, rows: 7, ...(replayed ? { replay: { rows: 2 } } : {}) }],
        [{ text: 'SELECT a FROM t', rows: 3 }],
      ),
    );
    const pane = container.querySelector('[data-sql-pane="agent"]')!;
    expect(pane).toHaveTextContent('Executed');
    expect(pane).toHaveTextContent('7 rows');
    expect(screen.getByLabelText('Judge A results')).toHaveTextContent('3 rows');
    expect(screen.getByLabelText('Agent results')).toHaveTextContent(replayed ? '2 rows' : '7 rows');
    if (replayed) expect(screen.getByLabelText('Agent results')).toHaveTextContent('Replayed for comparison');
  });

  it('keeps original errors on older paired statements without calling them replay errors', () => {
    const { container } = show(
      custom(
        [{ text: 'SELECT a FROM t', executed: false, rows: 0, error: 'Original execution failed' }],
        [{ text: 'SELECT a FROM t' }],
      ),
    );
    const pane = container.querySelector('[data-sql-pane="agent"]')!;
    expect(pane).toHaveTextContent('Failed');
    expect(pane).toHaveTextContent('0 rows');
    expect(screen.getByLabelText('Agent results')).toHaveTextContent('Original execution failed');
    expect(screen.queryByText(/The evaluator could not re-run/)).toBeNull();
  });

  it('shows a difference legend, two kinds of marks, original SQL and aligned preview groups', () => {
    const { container } = show();
    const row = screen.getByRole('region', { name: 'Sub-question 1 of 1' });
    expect(within(row).getByText("only in the agent's SQL")).toBeVisible();
    expect(within(row).getByText("only in Judge A's SQL")).toBeVisible();
    expect(row.querySelector('[data-sql-mark="agent"]')).toBeVisible();
    expect(row.querySelector('[data-sql-mark="judge"]')).toBeVisible();
    expect(row.querySelector('del, s')).toBeNull();
    expect(row.querySelector('[data-sql-pane="agent"] pre')).toHaveTextContent('GROUP BY region');
    expect(row.querySelector('[data-sql-pane="judge"] pre')).toHaveTextContent('group by city');
    expect(screen.getByLabelText('Judge A SQL summary')).toHaveTextContent('Not equivalent');
    expect(screen.getByText('Not equivalent')).toBeVisible();
    expect(screen.getByText('Results differ')).toBeVisible();
    expect(row.querySelector('[data-sql-pane="agent"]')).toHaveTextContent('2 rows');
    expect(row.querySelector('[data-sql-pane="judge"]')).toHaveTextContent('10 rows');
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
    expect(
      screen.getByText("The agent's SQL and Judge A's SQL are identical apart from formatting."),
    ).toBeVisible();
    expect(container.querySelector('[data-sql-mark]')).toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Ignore formatting' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(container.querySelector('[data-sql-mark="agent"]')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Judge A' })).toBeChecked();
    await user.click(toggle);
    expect(
      screen.getByText("The agent's SQL and Judge A's SQL are identical apart from formatting."),
    ).toBeVisible();
  });
  it('keeps vs in the URL and preserves other parameters and the statement anchor', async () => {
    const user = userEvent.setup();
    show(liveEvidenceTurns['chart-summary'], '/turn?tab=answer&vs=b&keep=1#part-1');
    expect(screen.getByRole('radio', { name: 'Judge B' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Judge A' }));
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/turn?tab=answer&vs=a&keep=1#part-1');
  });
  it('defaults to Judge A even when Judge B has more differences', () => {
    show(
      custom(
        [{ text: 'SELECT a FROM t' }],
        [{ text: 'select A from t' }],
        [{ text: 'SELECT b FROM t WHERE n=1' }],
      ),
    );
    expect(screen.getByRole('radio', { name: 'Judge A' })).toBeChecked();
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
    expect(screen.getByLabelText('Judge A SQL summary')).not.toHaveTextContent(
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
    expect(screen.queryByText('Replayed for comparison')).toBeNull();
    expect(screen.getByLabelText('Agent results')).toHaveTextContent('Not run');
    expect(screen.getByLabelText('Judge A results')).toHaveTextContent('0 rows');
    expect(screen.getByText("The agent's SQL and Judge A's SQL are identical.")).toBeVisible();
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
  it('defaults to A with an empty pane when only B has statements, and lets the viewer switch', async () => {
    const user = userEvent.setup();
    const data = custom([{ text: 'SELECT a FROM t' }], [], [{ text: 'SELECT b FROM t', agent_index: 0 }]);
    const judges = data.summary.judges as Record<string, Record<string, unknown>>;
    judges.b!.sql_reasoning_en = 'Select the requested field b.';
    const { container } = show(data);
    expect(screen.getByRole('radio', { name: 'Judge A' })).toBeChecked();
    expect(screen.getByText('No SQL available for Judge A')).toBeVisible();
    expect(screen.queryByText('Why the judge wrote it this way')).not.toBeInTheDocument();
    expect(container.querySelector('[data-sql-pane="agent"]')?.children).toHaveLength(3);
    expect(container.querySelector('[data-sql-pane="judge"]')?.children).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: 'Judge B' }));
    expect(screen.getByRole('radio', { name: 'Judge B' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Sub-question 1 of 1' })).toBeVisible();
    expect(
      screen
        .getByRole('region', { name: 'Sub-question 1 of 1' })
        .querySelector('[data-sql-pane="judge"] code'),
    ).toHaveTextContent('SELECT b FROM t');
    expect(screen.getByText('Why the judge wrote it this way')).toBeVisible();
    expect(screen.getByText('Select the requested field b.')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Judge A' }));
    expect(screen.queryByText('Why the judge wrote it this way')).not.toBeInTheDocument();
    expect(container.querySelector('[data-sql-pane="agent"]')?.children).toHaveLength(3);
    expect(container.querySelector('[data-sql-pane="judge"]')?.children).toHaveLength(3);
  });

  it('switches every right pane without reordering or replacing agent SQL and results', async () => {
    const user = userEvent.setup();
    const sample = (value: string) => ({ rows: 1, columns: ['value'], sample: [[value]] });
    const data = custom(
      [
        { text: 'SELECT city FROM cities', ...sample('الرياض') },
        { text: 'SELECT region FROM regions', ...sample('الوسطى') },
      ],
      [
        { text: 'SELECT city FROM cities', sub_question: 'A cities?', agent_index: 0, ...sample('A city') },
        {
          text: 'SELECT region FROM regions',
          sub_question: 'A regions?',
          agent_index: 1,
          ...sample('A region'),
        },
      ],
      [
        {
          text: 'SELECT region FROM regions WHERE active=1',
          sub_question: 'B active regions?',
          agent_index: 1,
          ...sample('B region'),
        },
        {
          text: 'SELECT city FROM cities WHERE active=1',
          sub_question: 'B active cities?',
          agent_index: 0,
          ...sample('B city'),
        },
        {
          text: 'SELECT count(*) FROM cities',
          sub_question: 'B city count?',
          agent_index: 0,
          ...sample('B count'),
        },
      ],
    );
    const judges = data.summary.judges as Record<string, Record<string, unknown>>;
    judges.a!.sql_reasoning_en = 'Read all cities and regions.';
    judges.b!.sql_reasoning_en = 'Filter for active cities and regions, then count cities.';
    const { container } = show(data);
    const agentPanes = () => [...container.querySelectorAll('[data-sql-pane="agent"]')];
    const explanation = () => {
      const label = screen.getByText('Why the judge wrote it this way');
      const pane = container.querySelector('[data-sql-pane="judge"]')!;
      expect(pane.children).toHaveLength(4);
      expect(pane.children[0]).toContainElement(
        screen.getByRole('radiogroup', { name: "Compare the agent's SQL with" }),
      );
      expect(pane.children[1]).toContainElement(label);
      expect(pane.children[2]).toContainElement(pane.querySelector('pre'));
      expect(agentPanes()[0]!.children[1]).toBeEmptyDOMElement();
      expect(container.querySelectorAll('[data-sql-pane="judge"]')[1]!.children).toHaveLength(3);
      return label.parentElement;
    };
    expect(explanation()).toHaveTextContent('Read all cities and regions.');
    const before = agentPanes().map((pane) => pane.textContent);
    const headings = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings()).toEqual([
      'Sub-question 1 of 3: A cities?',
      'Sub-question 2 of 3: A regions?',
      'Sub-question 3 of 3',
    ]);
    expect(screen.getAllByRole('radiogroup', { name: "Compare the agent's SQL with" })).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: 'Judge B' }));
    expect(explanation()).toHaveTextContent('Filter for active cities and regions, then count cities.');
    expect(screen.queryByText('Read all cities and regions.')).not.toBeInTheDocument();
    expect(agentPanes().map((pane) => pane.textContent)).toEqual(before);
    expect(headings()).toEqual([
      'Sub-question 1 of 3: B active cities?',
      'Sub-question 2 of 3: B active regions?',
      'Sub-question 3 of 3: B city count?',
    ]);
    expect(screen.queryByText('A city')).not.toBeInTheDocument();
    expect(screen.queryByText('A region')).not.toBeInTheDocument();
    expect(screen.getByText('B city')).toBeVisible();
    expect(screen.getByText('B region')).toBeVisible();
    expect(screen.getByText('B count')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Judge A' }));
    expect(explanation()).toHaveTextContent('Read all cities and regions.');
    expect(
      screen.queryByText('Filter for active cities and regions, then count cities.'),
    ).not.toBeInTheDocument();
    expect(agentPanes().map((pane) => pane.textContent)).toEqual(before);
    expect(headings()).toEqual([
      'Sub-question 1 of 3: A cities?',
      'Sub-question 2 of 3: A regions?',
      'Sub-question 3 of 3',
    ]);
  });

  it('replaces failed judge samples with their error and suppresses the difference legend', () => {
    const { container } = show(
      custom(
        [{ text: 'SELECT city FROM cities' }],
        [
          {
            text: 'SELECT bad_column FROM cities',
            agent_index: 0,
            executed: false,
            error: 'Unknown column bad_column',
            rows: 1,
            columns: ['city'],
            sample: [['Stale sample']],
          },
        ],
      ),
    );
    expect(
      screen.getByText("Judge A's SQL did not run, so there are no rows to compare with the agent's."),
    ).toBeVisible();
    expect(screen.getByLabelText('Judge A SQL summary')).toHaveTextContent('Judge A SQL failed');
    const result = screen.getByLabelText('Judge A results');
    expect(result.querySelector('[data-tone="danger"]')).toHaveTextContent('Unknown column bad_column');
    expect(within(result).queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale sample')).not.toBeInTheDocument();
    expect(container.querySelector('[data-sql-mark]')).toBeNull();
    expect(screen.queryByLabelText('SQL difference legend')).not.toBeInTheDocument();
  });
});

describe('final answer', () => {
  it('replaces chart tokens only in the answer, retaining unique tokens in the metadata grid', () => {
    const data = custom([], []);
    data.turn.answer =
      '**الإجابة** هي عشرون طلباً.\n\n[[viz:chart-one]]\n\nتفصيل إضافي. [[viz:chart-two]] [[viz:chart-one]]';
    const { container } = show(data);
    const answer = container.querySelector('[data-live-answer]')!;
    expect(answer).not.toHaveTextContent('[[viz:');
    expect(answer).toHaveAttribute('dir', 'rtl');
    expect(answer.querySelector('strong')).toHaveTextContent('الإجابة');
    expect(within(answer as HTMLElement).getAllByText('Chart shown here')).toHaveLength(3);
    const placeholders = screen.getByRole('group', { name: 'Chart placeholder' });
    expect(within(placeholders).getAllByText('[[viz:chart-one]]')).toHaveLength(1);
    expect(within(placeholders).getByText('[[viz:chart-two]]')).toBeVisible();
    expect(screen.queryByText(/Result rows:/)).not.toBeInTheDocument();
  });

  it.each([
    [1, false, 'Pass'],
    [0, false, 'Fail'],
    [null, false, 'Not evaluated'],
    [1, true, 'Not evaluated'],
  ] as const)('uses the recorded error detection score %s, skipped %s', (score, skipped, label) => {
    const data = custom([], []);
    data.turn.answer = 'A complete answer without a chart.';
    data.scores = [
      { ...liveTurnDetail.scores[0]!, metric_name: 'error_detection', score_numeric: score, skipped },
    ];
    show(data);
    expect(screen.getByRole('group', { name: 'Error detection' })).toHaveTextContent(label);
    expect(screen.queryByRole('group', { name: 'Chart placeholder' })).not.toBeInTheDocument();
  });
});
