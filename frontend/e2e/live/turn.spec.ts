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
  reasoning: 'The answer omitted a requested category.',
  sql_parts: [{ text: 'SELECT COUNT(*) FROM orders', executed: true, rows: 1, error: null }],
  vs_agent: { equivalent: false, result_set_match: false, coverage: { covered: 1, total: 3 } },
});
const summary = {
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
          sql: [{ text: 'SELECT COUNT(*) AS total FROM orders', executed: true, rows: 1, error: null }],
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
  await expect(header.locator('[data-live-question]')).toHaveText(data.turn.question);
  await expect(header.locator('[data-live-question]')).toHaveAttribute('dir', 'auto');
  await expect(header.locator('[data-live-question]')).toHaveCSS('direction', 'rtl');
  await expect(header.locator('[data-live-block="diagnosis-label"]')).toContainText('OK');
  await expect(header).toContainText('turn 1 of 3');
  await expect(header).toContainText('preprod');
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
  await expect(page.locator('[data-tile="compliance_a"] [data-part="value"]')).toHaveText('42%');
  await expect(page.locator('[data-tile="compliance_b"] [data-part="value"]')).toHaveText('38%');
  for (const block of ['why', 'deviations', 'agent-sql', 'judge-sql', 'answer', 'chart', 'turn-services']) {
    await expect(page.locator(`[data-live-block="${block}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-live-block="why"] dt')).toHaveCount(6);
  await expect(page.getByText('Deviations the judges found')).toBeVisible();
  await expect(page.locator('[data-live-block="judge-b"]').getByRole('button')).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  await page.getByRole('tab', { name: 'Judges', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('tab') === 'judges');
  for (const [judge, overall] of [
    ['a', '42%'],
    ['b', '38%'],
  ]) {
    const card = page.locator(`[data-live-block="judge-${judge}"]`);
    await expect(card.getByText('SQL compliance', { exact: true })).toBeVisible();
    await expect(card.getByText('Response compliance', { exact: true })).toBeVisible();
    await expect(
      card
        .locator('dl > div')
        .filter({ has: page.getByText('Overall compliance', { exact: true }) })
        .locator('dd'),
    ).toHaveText(overall!);
  }

  await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
  const siblings = page.getByRole('list', { name: 'Conversation turns' });
  await expect(siblings.getByRole('listitem')).toHaveCount(3);
  await expect(siblings.locator('a[aria-current="page"]')).toHaveText(data.turn.question);
  await expect(siblings.getByRole('link').nth(1)).toHaveAttribute(
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
});

test('a sparse seeded turn uses the reasoning fallback and unavailable call-list message', async ({
  page,
  request,
}) => {
  const seed = await seedLive(request, uniqueSlug('live-turn-sparse'));
  // support.ts supplies only charts/services: this unmodified turn has no structured deviations.
  await gotoApp(page, turnPath(seed, `${seed.days[0]!.day}/turn-2`));
  await expect(page.locator('[data-live-block="deviations"]')).toContainText('What each judge said');
  await expect(page.locator('[data-live-block="deviations"]')).toContainText('Judge A');
  await expect(page.locator('[data-live-block="deviations"]')).toContainText('Judge B');
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
  await expect(page.locator('[data-live-chart-missing]')).toHaveText(
    'No screenshot was captured for this chart',
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

test('LV-25: response axis stays on one line at 390 while its explanation wraps', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = await seedLive(request, uniqueSlug('live-axis-width'));
  const id = `${seed.days.at(-1)!.day}/turn-1`;
  await addJudgeEvidence(request, seed, id);
  await gotoApp(page, turnPath(seed, id));
  const axis = page.locator('[data-live-block="deviations"]').getByText('response', { exact: true });
  await expect(axis).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await axis.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const text = element.nextElementSibling!.getBoundingClientRect();
    return {
      height: box.height,
      flexShrink: getComputedStyle(element).flexShrink,
      right: box.right,
      textLeft: text.left,
      textHeight: text.height,
      lineHeight: parseFloat(getComputedStyle(element.nextElementSibling!).lineHeight),
    };
  });
  expect(geometry.flexShrink).toBe('0');
  expect(geometry.height).toBeLessThanOrEqual(21);
  expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.right);
  expect(geometry.textHeight).toBeGreaterThan(geometry.lineHeight);
});
