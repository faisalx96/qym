import { expect, test, type APIRequestContext } from '@playwright/test';
import { createApiKey, gotoApp, uniqueSlug } from '../helpers';
import { seedLive } from './support';

type Seed = Awaited<ReturnType<typeof seedLive>>;
interface ReadTurn {
  turn: Record<string, unknown> & { question: string };
  detail: unknown;
  scores: {
    metric_name: string;
    score_numeric: number | null;
    score_raw: unknown;
    label: string | null;
    explanation: string | null;
    meta: Record<string, unknown>;
    skipped: boolean;
    skip_reason: string | null;
  }[];
}
const judgeEvidence = (model: string, overall: number) => ({
  model,
  compliance: { sql: overall, response: overall - 0.05, overall },
  reasoning_en: 'The answer omitted a requested category.',
  reasoning_ar: 'أغفلت الإجابة فئة مطلوبة.',
  sql_reasoning_en:
    model === 'judge-a' ? 'Count the orders in each city.' : 'Sum the ordered quantities in each city.',
  sql_reasoning_ar: model === 'judge-a' ? 'عد الطلبات في كل مدينة.' : 'اجمع الكميات المطلوبة في كل مدينة.',
  sql_parts: [
    {
      text:
        model === 'judge-a'
          ? 'SELECT city, COUNT(*) AS TotalOrders FROM orders GROUP BY city'
          : 'SELECT city, SUM(quantity) AS TotalOrders FROM orders GROUP BY city',
      sub_question: 'كم عدد الطلبات في كل مدينة؟',
      agent_index: 0,
      executed: true,
      rows: 12,
      error: null,
      columns: ['اسم المدينة', 'TotalOrders'],
      sample: [
        ['الرياض', model === 'judge-a' ? '120' : '240'],
        ['جدة', '80'],
      ],
    },
  ],
  vs_agent: { equivalent: false, result_set_match: false, coverage: { covered: 1, total: 3 } },
});
const summary = {
  verdict: {
    basis: 'judges',
    confidence: 0.82,
    reason_en: 'The judges checked the requested categories.',
    reason_ar: 'راجع الحكمان الفئات المطلوبة.',
    steps: [
      {
        kind: 'judge',
        text_en: 'Both judges require the requested categories.',
        text_ar: 'يشترط الحكمان الفئات المطلوبة.',
        source: 'a',
      },
      { kind: 'fact', text_en: 'One SQL tool ran.', source: 'Tool: execute_sql_query' },
    ],
  },
  rules_applied: [
    {
      id: 'B10',
      role: 'decided',
      title_en: 'Include categories',
      title_ar: 'تضمين الفئات',
      verdict_en: 'Use every requested category.',
      verdict_ar: 'استخدم كل فئة مطلوبة.',
      sources: ['prompts/rules.md:10-20'],
    },
    { id: 'B2', role: 'told_to_judges', title_en: 'Ground the answer', verdict_en: 'Use the returned rows.' },
  ],
  rules_version: 'diagnosis-test-version',
  turn_class: { name: 'data_answer' },
  question_context: { enriched_question: 'كم عدد الطلبات؟' },
  judges: { a: judgeEvidence('judge-a', 0.42), b: judgeEvidence('judge-b', 0.38) },
  judges_agree: true,
  coverage: { covered: 1, total: 3 },
  deviations: [
    { judge: 'a', axis: 'sql', text: 'A requested category is missing.' },
    {
      judge: 'b',
      axis: 'response',
      text: 'The response omits the requested category and its explanatory context.',
    },
  ],
  envelope: {
    intent: 'query',
    expected_tools: ['sql_execution'],
    actual_tools: ['sql_execution'],
    matched: true,
  },
  tools: { calls: 1, budget: 8, failures: [], list: [{ name: 'sql_execution', step: 1, ok: true }] },
  charts: [
    { ref: 'chart-1', kind: 'bar', scores: { chart_fidelity: 0.45 }, issues: ['Missing category label'] },
  ],
  services: { sql_generation: { status: 'ok', score: 1, fault: null, signals: { latency_ms: 120 } } },
  eval_meta: {
    models: { a: 'judge-a', b: 'judge-b' },
    eval_code_version: 'e2e-v1',
    attempt: 1,
    durations: { evaluation_ms: 4200 },
  },
};
const turnPath = (seed: Seed, id: string, extra: Record<string, string> = {}) =>
  `/projects/${seed.projectSlug}/live/turns/${encodeURIComponent(id)}?${new URLSearchParams({ source: seed.sourceKey, ...extra })}`;

/** Enrich only this spec's first seeded turn; the shared seed intentionally has sparse evidence. */
async function addJudgeEvidence(request: APIRequestContext, seed: Seed, turnId: string) {
  const response = await request.get(
    `/api/projects/${seed.projectSlug}/live/turns/${turnId}?${new URLSearchParams({ source: seed.sourceKey })}`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const data = (await response.json()) as ReadTurn;
  const token = await createApiKey(request, seed.projectId);
  const fields = [
    'turn_id',
    'day',
    'turn_at',
    'evaluated_at',
    'conversation_id',
    'turn_index',
    'user_ref',
    'mode',
    'status',
    'outcome',
    'label',
    'label_reason',
    'question',
    'answer',
    'latency_ms',
    'result_rows',
    'tool_calls',
  ] as const;
  const result = await request.post(`/v1/projects/${seed.projectId}/live/sources/${seed.sourceKey}/turns`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      turns: [
        {
          ...Object.fromEntries(fields.map((key) => [key, data.turn[key]])),
          answer: 'الإجابة تتضمن الطلبات حسب المدينة. [[viz:orders-chart]]',
          sql: [
            {
              text: 'SELECT city, COUNT(*) AS TotalOrders\nFROM orders\nWHERE active = 1\nGROUP BY city',
              executed: true,
              rows: 12,
              error: null,
              columns: ['اسم المدينة', 'TotalOrders'],
              sample: [
                ['الرياض', '100'],
                ['جدة', '80'],
              ],
            },
          ],
          trace_url: 'https://example.com/product-trace',
          eval_trace_url: 'https://example.com/evaluation-trace',
          summary,
          detail: data.detail,
          scores: data.scores.map((score) => ({
            metric_name: score.metric_name,
            score_numeric: score.score_numeric,
            score_raw: score.score_raw,
            label: score.label,
            explanation: score.explanation,
            meta: score.meta,
            skipped: score.skipped,
            skip_reason: score.skip_reason,
          })),
        },
      ],
    },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  expect(await result.json()).toMatchObject({ updated: 1, rejected: 0 });
  return data;
}

test('turn diagnosis, judges, conversation and raw evaluator evidence', async ({ page, request }) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-detail'));
  const turnId = `${seed.days[0]!.day}/turn-1`;
  const data = await addJudgeEvidence(request, seed, turnId);
  await gotoApp(page, turnPath(seed, turnId));

  const header = page.locator('[data-live-block="turn-header"]');
  await expect(header.locator('[data-live-question]')).toContainText(data.turn.question);
  await expect(header.locator('[data-live-question]')).toHaveAttribute('dir', 'rtl');
  await expect(header.locator('[data-live-question]')).toHaveCSS('direction', 'rtl');
  await expect(header.getByRole('heading', { level: 1 })).toContainText(data.turn.question);
  await expect(header).toContainText(String(data.turn.conversation_id));
  await expect(page.locator('[data-live-block="diagnosis-label"]')).toContainText('OK');
  await expect(page.locator('[data-live-block="why"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Verdict', exact: true })).toHaveCount(0);
  await expect(header).toContainText('Turn 1 of 3');
  await expect(header.getByText('Preprod', { exact: true })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Product trace' })).toHaveAttribute(
    'href',
    'https://example.com/product-trace',
  );
  await expect(header.getByRole('link', { name: 'Evaluation trace' })).toHaveAttribute(
    'href',
    'https://example.com/evaluation-trace',
  );
  await expect(header.locator('[data-live-block="turn-navigation"]')).toHaveCount(0);
  await expect(page.locator('[data-live-block="turn-tiles"] [data-tile]')).toHaveCount(6);
  await expect(page.getByRole('group', { name: 'Turn numbers' })).toHaveAttribute('data-variant', 'compact');
  await expect(page.locator('[data-tile="compliance_a"] [data-live-stat]')).toHaveText('42.0%');
  await expect(page.locator('[data-tile="compliance_b"] [data-live-stat]')).toHaveText('38.0%');
  const diagnosis = page.getByRole('tabpanel');
  await expect(diagnosis.locator(':scope > [data-live-block]')).toHaveCount(3);
  expect(
    await diagnosis
      .locator(':scope > [data-live-block]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-live-block'))),
  ).toEqual(['diagnosis-steps', 'rules', 'turn-facts']);
  const steps = diagnosis.getByRole('grid', { name: 'How we got here' });
  await expect(steps.getByRole('columnheader')).toHaveText(['#', 'Check', 'What it found']);
  expect(
    (await steps.getByRole('columnheader', { name: '#', exact: true }).boundingBox())!.width,
  ).toBeLessThanOrEqual(56);
  await expect(steps.getByRole('rowheader').first()).toHaveCSS('text-align', 'start');
  for (const cell of await steps.locator('tbody tr').first().locator('td').all()) {
    await expect(cell).toHaveCSS('vertical-align', 'top');
    await expect(cell).toHaveCSS('padding-top', '8px');
    await expect(cell).toHaveCSS('padding-bottom', '8px');
  }
  await expect(steps.getByText('Judge: A', { exact: true })).toBeVisible();
  await expect(steps.getByText('a', { exact: true })).toHaveCount(0);
  const rules = diagnosis.locator('[data-live-block="rules"]');
  const toggle = rules.getByRole('button', { name: /Insightor rules behind this verdict/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rules).toContainText('1 of 2 rules were cited:');
  await expect(rules.getByRole('grid')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(rules.getByRole('grid').locator('tbody [data-col="rule"]')).toHaveText(['B10']);
  await rules.getByRole('button', { name: 'Show all 2' }).click();
  await expect(rules.getByRole('grid').locator('tbody [data-col="rule"]')).toHaveText(['B2', 'B10']);
  await expect(rules.getByRole('columnheader', { name: 'Cited by' })).toHaveCount(0);
  await expect(diagnosis).not.toContainText('prompts/rules.md:10-20');
  await expect(diagnosis).not.toContainText('diagnosis-test-version');
  await expect(diagnosis.getByRole('button', { name: 'Copy rule source' })).toHaveCount(0);
  await rules.getByRole('button', { name: 'Show cited only' }).click();
  await expect(rules.getByRole('grid').locator('tbody [data-col="rule"]')).toHaveText(['B10']);
  const question = diagnosis.getByRole('group', { name: 'Standalone question', exact: true });
  const value = question.getByText(summary.question_context.enriched_question, { exact: true });
  await expect(value).toHaveCSS('direction', 'rtl');
  const labelBox = (await question.getByText('Standalone question', { exact: true }).boundingBox())!;
  const valueBox = (await value.boundingBox())!;
  // Both label and value are anchored at the start; Arabic occupies only its reading width.
  expect(valueBox.x - (labelBox.x + labelBox.width)).toBeLessThanOrEqual(17);
  expect(valueBox.x).toBeGreaterThanOrEqual(labelBox.x);

  await page.getByRole('tab', { name: 'Judges', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('tab') === 'judges');
  await expect(page.getByText('Own SQL', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-judge-facet="sql"]')).toHaveCount(0);
  await expect(page.getByText(summary.judges.a.sql_reasoning_en, { exact: true })).toHaveCount(0);
  await expect(page.getByText(summary.judges.b.sql_reasoning_en, { exact: true })).toHaveCount(0);
  for (const [judge, overall] of [
    ['a', '42.0%'],
    ['b', '38.0%'],
  ]) {
    const card = page.getByLabel(`Judge ${judge!.toUpperCase()} compliance`, { exact: true });
    await expect(card.getByText('SQL', { exact: true })).toBeVisible();
    await expect(card.getByText('Response', { exact: true })).toBeVisible();
    await expect(
      card
        .locator(':scope > div')
        .filter({ has: page.getByText('Overall', { exact: true }) })
        .locator('dd'),
    ).toHaveText(overall!);
  }

  await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
  const siblings = page.getByRole('grid', { name: 'Conversation turns' });
  await expect(siblings.locator('tbody > tr')).toHaveCount(3);
  await expect(siblings.getByRole('columnheader', { name: 'Open turn' })).toHaveText('');
  await expect(siblings.locator('tbody > tr > [data-col="turn"]')).toHaveText(['1', '2', '3']);
  await expect(siblings.locator('tr[aria-current="page"]')).toContainText(data.turn.question);
  await expect(siblings.getByRole('link').nth(0)).toHaveAttribute(
    'href',
    turnPath(seed, `${seed.days[0]!.day}/turn-2`),
  );

  await page.getByRole('tab', { name: 'Evaluator', exact: true }).click();
  const raw = page.getByRole('button', { name: /Raw evaluation detail/ });
  await expect(raw).toHaveAttribute('aria-expanded', 'false');
  await raw.click();
  await expect(page.getByRole('tree', { name: 'Raw evaluation detail' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Raw evaluation detail' })).toContainText(
    'Synthetic evaluation evidence',
  );
  await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
  const otherRow = page
    .getByRole('grid', { name: 'Conversation turns' })
    .locator('tbody tr[data-href]')
    .first();
  const href = await otherRow.getByRole('link', { name: 'Open turn' }).getAttribute('href');
  await otherRow.locator('[data-col="question"]').click();
  await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
});

test('the explanation language applies across tabs and survives reload', async ({ page, request }) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-language'));
  const turnId = `${seed.days[0]!.day}/turn-1`;
  await addJudgeEvidence(request, seed, turnId);
  await gotoApp(page, turnPath(seed, turnId));
  await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
  await expect(page.getByText(summary.verdict.reason_en, { exact: true })).toHaveCount(1);
  await expect(page.getByText(summary.verdict.reason_ar, { exact: true })).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Explanation language' })
    .getByText('العربية', { exact: true })
    .click();
  await expect(page.getByRole('radio', { name: 'العربية' })).toBeChecked();
  await expect(page.getByText(summary.verdict.reason_en, { exact: true })).toHaveCount(0);
  await expect(page.getByText(summary.verdict.reason_ar, { exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: 'Judges', exact: true }).click();
  const judge = page.locator('[data-live-block="judge-a"]');
  await expect(judge.getByText(summary.judges.a.reasoning_en, { exact: true })).toHaveCount(0);
  await expect(judge.getByText(summary.judges.a.reasoning_ar, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Answer and SQL', exact: true }).click();
  const sql = page.locator('[data-sql-pane="judge"]').first();
  await expect(sql.getByText('Why the judge wrote it this way', { exact: true })).toBeVisible();
  await expect(sql.getByText(summary.judges.a.sql_reasoning_en, { exact: true })).toHaveCount(0);
  await expect(sql.getByText(summary.judges.a.sql_reasoning_ar, { exact: true })).toBeVisible();
  await sql.getByRole('radiogroup').getByText('Judge B', { exact: true }).click();
  await expect(sql.getByText(summary.judges.a.sql_reasoning_ar, { exact: true })).toHaveCount(0);
  await expect(sql.getByText(summary.judges.b.sql_reasoning_ar, { exact: true })).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Explanation language' })
    .getByText('Both', { exact: true })
    .click();
  await expect(page.getByRole('radio', { name: 'Both' })).toBeChecked();
  await expect(sql.getByText(summary.judges.b.sql_reasoning_en, { exact: true })).toBeVisible();
  await expect(sql.getByText(summary.judges.b.sql_reasoning_ar, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Judges', exact: true }).click();
  await expect(judge.getByText(summary.judges.a.reasoning_en, { exact: true })).toBeVisible();
  await expect(judge.getByText(summary.judges.a.reasoning_ar, { exact: true })).toBeVisible();
  const reason = page.locator('[data-live-block="why"] [data-language="both"]');
  await expect(reason).toHaveCSS('display', 'grid');
  const columns = await reason.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').map(parseFloat),
  );
  expect(columns).toHaveLength(2);
  expect(Math.abs(columns[0]! - columns[1]!)).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Both' })).toBeChecked();
  await expect(page.getByText(summary.verdict.reason_en, { exact: true })).toHaveCount(1);
  await expect(page.getByText(summary.verdict.reason_ar, { exact: true })).toHaveCount(1);
});

test('Answer and SQL aligns SQL and result rows, switches judges and stacks by container width', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-sql-layout'));
  const turnId = `${seed.days[0]!.day}/turn-1`;
  await addJudgeEvidence(request, seed, turnId);
  await page.setViewportSize({ width: 1366, height: 1000 });
  await gotoApp(page, turnPath(seed, turnId, { tab: 'answer' }));
  const answer = page.locator('[data-live-answer]');
  await expect(answer).not.toContainText('[[viz:');
  await expect(answer.getByText('Chart shown here')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Chart placeholder' })).toContainText('[[viz:orders-chart]]');
  const card = page.locator('[data-live-block="sql-comparison"]');
  const agent = card.locator('[data-sql-pane="agent"]').first();
  const judge = card.locator('[data-sql-pane="judge"]').first();
  const agentSql = agent.locator('pre');
  const judgeSql = judge.locator('pre');
  const agentRows = agent.getByRole('grid');
  const judgeRows = judge.getByRole('grid');
  await expect(agentRows).toBeVisible();
  await expect(judgeRows).toBeVisible();
  const agentText = await agentSql.textContent();
  await expect(judge.getByRole('radio', { name: 'Judge A' })).toBeChecked();
  await expect(card.getByText('Why the judge wrote it this way', { exact: true })).toHaveCount(1);
  await expect(judge.getByText(summary.judges.a.sql_reasoning_en, { exact: true })).toBeVisible();
  const aligned = async () => {
    expect(
      Math.abs((await agentSql.boundingBox())!.y - (await judgeSql.boundingBox())!.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await agentRows.boundingBox())!.y - (await judgeRows.boundingBox())!.y),
    ).toBeLessThanOrEqual(1);
  };
  await aligned();
  await expect(judgeRows.getByRole('columnheader', { name: 'TotalOrders' })).toHaveCSS(
    'text-transform',
    'none',
  );
  await expect(agentRows.getByText('100', { exact: true }).locator('xpath=ancestor::td')).toHaveCSS(
    'text-align',
    'end',
  );
  await expect(agentRows.getByRole('rowheader').first()).toHaveCSS('text-align', 'start');
  await expect(agent.getByText('Showing 2 of 12 rows')).toBeVisible();
  await judge.getByRole('radiogroup').getByText('Judge B', { exact: true }).click();
  await expect(judge.getByRole('radio', { name: 'Judge B' })).toBeChecked();
  await expect(judge.getByText(summary.judges.a.sql_reasoning_en, { exact: true })).toHaveCount(0);
  await expect(judge.getByText(summary.judges.b.sql_reasoning_en, { exact: true })).toBeVisible();
  await expect(agentSql).toHaveText(agentText!);
  await expect(judgeSql).toContainText('SUM(quantity)');
  await expect(judgeRows.getByText('240', { exact: true })).toBeVisible();
  await aligned();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);

  // Keep the viewport wide: only the actual page column gets narrower.
  await card.evaluate((element) => {
    element.style.inlineSize = '720px';
  });
  const agentSqlBox = (await agentSql.boundingBox())!;
  const agentRowsBox = (await agentRows.boundingBox())!;
  const judgeHeaderBox = (await judge.getByRole('radiogroup').boundingBox())!;
  const explanationBox = (await judge.getByText(summary.judges.b.sql_reasoning_en).boundingBox())!;
  const judgeSqlBox = (await judgeSql.boundingBox())!;
  const judgeRowsBox = (await judgeRows.boundingBox())!;
  expect(agentRowsBox.y).toBeGreaterThanOrEqual(agentSqlBox.y + agentSqlBox.height);
  expect(judgeHeaderBox.y).toBeGreaterThanOrEqual(agentRowsBox.y + agentRowsBox.height);
  expect(explanationBox.y).toBeGreaterThanOrEqual(judgeHeaderBox.y + judgeHeaderBox.height);
  expect(judgeSqlBox.y).toBeGreaterThanOrEqual(explanationBox.y + explanationBox.height);
  expect(judgeRowsBox.y).toBeGreaterThanOrEqual(judgeSqlBox.y + judgeSqlBox.height);
  expect(Math.abs(agentSqlBox.x - judgeSqlBox.x)).toBeLessThanOrEqual(1);
});

test('a sparse seeded turn uses Diagnosis empty states and the unavailable call-list message', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-sparse'));
  // support.ts supplies only charts/services: this unmodified turn has no structured deviations.
  await gotoApp(page, turnPath(seed, `${seed.days[0]!.day}/turn-2`));
  await expect(page.getByText('No diagnosis steps recorded for this turn')).toBeVisible();
  await expect(page.getByText('No turn facts recorded for this turn')).toBeVisible();
  await expect(page.getByRole('button', { name: /Insightor rules behind this verdict/ })).toHaveCount(0);
  await expect(page.getByText('No rules were recorded for this turn')).toBeVisible();
  await expect(page.locator('[data-live-block="rules"]')).not.toContainText('0 of 0');
  await page.getByRole('tab', { name: 'Services and tools', exact: true }).click();
  await expect(page.getByText('Call list not available for this turn', { exact: true })).toBeVisible();
});

test('Charts shows an uploaded screenshot, opens its dialog and explains a missing screenshot', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-charts'));
  const day = seed.days[0]!.day;
  await gotoApp(page, turnPath(seed, `${day}/turn-2`, { tab: 'charts' }));
  const screenshot = page.locator('[data-live-chart-image] img');
  await expect(screenshot).toBeVisible();
  await expect
    .poll(() => screenshot.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'bar chart — Monthly totals increased.' }).click();
  const dialog = page.getByRole('dialog', { name: 'bar chart — Monthly totals increased.' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveAttribute('src', (await screenshot.getAttribute('src'))!);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await gotoApp(page, turnPath(seed, `${day}/turn-12`, { tab: 'charts' }));
  await expect(
    page.locator('[data-live-chart-missing]').getByRole('heading', { name: 'No screenshot was captured' }),
  ).toBeVisible();
  await expect(page.locator('[data-live-chart-missing]')).toContainText(
    'The chart could not be checked by eye.',
  );
  await expect(page.locator('[data-live-chart-image]')).toHaveCount(0);
});

test('next and previous preserve the originating list order and disable its ends', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-neighbours'));
  const day = seed.days[0]!.day;
  const list = new URLSearchParams({
    source: seed.sourceKey,
    day,
    sort: '-latency_ms',
    page_size: '50',
  }).toString();
  await gotoApp(page, turnPath(seed, `${day}/turn-12`, { list }));
  await expect(page.getByRole('button', { name: 'Previous turn' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next turn' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next turn' }).click();
  await expect(page).toHaveURL(
    (url) =>
      decodeURIComponent(url.pathname).endsWith(`${day}/turn-11`) &&
      url.searchParams.get('list') === list &&
      url.searchParams.get('source') === seed.sourceKey,
  );
  await expect(page.locator('[data-live-block="turn-header"] [data-live-question]')).toHaveText(
    'What is the total for group 11?',
  );
  await page.getByRole('button', { name: 'Previous turn' }).click();
  await expect(page).toHaveURL(
    (url) =>
      decodeURIComponent(url.pathname).endsWith(`${day}/turn-12`) && url.searchParams.get('list') === list,
  );
  await gotoApp(page, turnPath(seed, `${day}/turn-1`, { list }));
  await expect(page.getByRole('button', { name: 'Next turn' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous turn' })).toBeEnabled();
});

test('LV-25: response axis stays on one line beside its wrapping explanation at 390', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = await seedLive(request, uniqueSlug('live-axis-width'));
  const id = `${seed.days.at(-1)!.day}/turn-1`;
  await addJudgeEvidence(request, seed, id);
  await gotoApp(page, turnPath(seed, id, { tab: 'judges' }));
  const deviations = page.getByRole('grid', { name: 'Judge B deviations' });
  const axis = deviations.locator('[data-col="where"]').getByText('Response', { exact: true });
  await expect(axis).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await axis.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const explanation = element.closest('tr')!.querySelector('[data-col="finding"] [data-text-mode]')!;
    const text = explanation.getBoundingClientRect();
    return {
      height: box.height,
      right: box.right,
      textLeft: text.left,
      textHeight: text.height,
      lineHeight: parseFloat(getComputedStyle(explanation).lineHeight),
    };
  });
  expect(geometry.height).toBeLessThanOrEqual(21);
  expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.right);
  expect(geometry.textHeight).toBeGreaterThan(geometry.lineHeight);
});
