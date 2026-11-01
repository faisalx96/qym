/** Static API-shaped examples for the Live design round. Vocabulary matches scripts/seed_live.py. */
import type { LiveMetricSpec, LiveOverview, LiveTurnDetail, LiveTurnsPage } from '@/api/live';

const metric = (
  spec: Partial<LiveMetricSpec> & Pick<LiveMetricSpec, 'metric_name' | 'label'>,
): LiveMetricSpec => ({
  group: 'quality',
  score_type: 'percentage',
  direction: 'maximize',
  pass_threshold: 0.5,
  unit: null,
  precision: null,
  is_primary: false,
  position: 0,
  description: null,
  values: null,
  ...spec,
});

export const liveDiagnosisSpec = {
  ...metric({
    metric_name: 'diagnosis',
    label: 'Diagnosis',
    group: 'diagnosis',
    score_type: 'categorical',
    direction: null,
    pass_threshold: null,
  }),
  values: [
    { value: 'ok', label: 'OK', tone: 'accent' },
    { value: 'suboptimal', label: 'Suboptimal', tone: 'warning' },
    { value: 'agent_problem', label: 'Agent problem', tone: 'danger' },
    { value: 'reference_problem', label: 'Reference problem', tone: 'warning' },
    { value: 'system_problem', label: 'System problem', tone: 'meta' },
    { value: 'inconclusive', label: 'Inconclusive', tone: 'neutral' },
  ],
} satisfies LiveMetricSpec;

export const liveServiceNames = [
  'router',
  'retrieval',
  'sql_generation',
  'sql_execution',
  'visualization',
  'finalize',
];
export const liveSpecs: LiveMetricSpec[] = [
  metric({ metric_name: 'agent_success', label: 'Agent success', is_primary: true }),
  liveDiagnosisSpec,
  metric({ metric_name: 'compliance_a', label: 'Judge A compliance' }),
  metric({ metric_name: 'compliance_b', label: 'Judge B compliance' }),
  metric({ metric_name: 'error_detection', label: 'Error detection' }),
  metric({
    metric_name: 'response_latency',
    label: 'Response latency',
    group: 'latency',
    score_type: 'duration',
    direction: 'minimize',
    unit: 'ms',
    precision: 0,
    pass_threshold: null,
  }),
  metric({ metric_name: 'chart_fidelity', label: 'Chart fidelity', group: 'charts' }),
  metric({ metric_name: 'chart_vision', label: 'Chart vision', group: 'charts' }),
  ...[...liveServiceNames, 'eval_health'].map((name) =>
    metric({
      metric_name: `service.${name}`,
      label:
        name === 'eval_health'
          ? 'Evaluation health'
          : name.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()),
      group: 'service',
      score_type: 'boolean',
      pass_threshold: 1,
    }),
  ),
].map((spec, position) => ({ ...spec, position }));

export const liveDay = '2026-11-01';
const labelMix = {
  ok: 18,
  suboptimal: 7,
  agent_problem: 6,
  reference_problem: 4,
  system_problem: 5,
  inconclusive: 7,
};
const worker = {
  poll_interval_s: 60,
  judges: { a: 'judge-a', b: 'judge-b' },
  eval_code_version: 'seed-v1',
  worker_version: 'seed-v1',
  manifest_hash: 'sample-manifest-v1',
};
const totals = [32, 38, 41, 36, 45, 39, 0, 42, 48, 44, 51, 43, 49, 47];
const rates = [0.68, 0.72, 0.76, 0.7, 0.81, 0.74, null, 0.78, 0.8, 0.75, 0.83, 0.77, 0.73, 0.71];
const trend: LiveOverview['trend'] = totals.map((turns, i) => {
  const day = new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10);
  const counts = liveDiagnosisSpec.values.map(
    ({ value }, j) => [value, Math.floor((turns * Object.values(labelMix)[j]!) / 47)] as const,
  );
  const counts_by_label = Object.fromEntries(counts);
  counts_by_label.ok! += turns - Object.values(counts_by_label).reduce((a, b) => a + b, 0);
  return { day, turns, counts_by_label, primary_rate: rates[i]!, worker_gap: i === 6 };
});

export const liveOverview: LiveOverview = {
  status: {
    id: 'source-preprod',
    key: 'worker-preprod',
    name: 'Evaluation worker',
    environment: 'preprod',
    product: null,
    stale: false,
    seconds_since_heartbeat: 12,
    last_heartbeat_at: '2026-11-01T09:18:00Z',
    last_turn_at: '2026-11-01T09:12:00Z',
    worker,
  },
  day: {
    row: {
      id: 'day-2026-11-01',
      source_id: 'source-preprod',
      day: liveDay,
      run_ref: `daily-${liveDay}`,
      status: 'running',
      turns_seen: 47,
      evaluated: 44,
      failed: 5,
      incomplete: 3,
      excluded: 0,
      first_poll_at: '2026-11-01T00:00:00Z',
      last_poll_at: '2026-11-01T09:18:00Z',
      closed_at: null,
      polls: 559,
      max_poll_gap_s: 78,
      parameters: worker,
    },
    in_qym: 47,
    not_in_qym: 0,
    label_mix: labelMix,
    metric_means: [
      ['agent_success', 0.71, 35],
      ['compliance_a', 0.78, 40],
      ['compliance_b', 0.74, 40],
      ['error_detection', 0.93, 44],
      ['chart_fidelity', 0.82, 19],
      ['chart_vision', 0.88, 19],
    ].map(([name, mean, n]) => ({
      metric_name: String(name),
      mean: Number(mean),
      n: Number(n),
      spec: liveSpecs.find((s) => s.metric_name === name)!,
    })),
    services: liveServiceNames.map((name, i): LiveOverview['day']['services'][number] => ({
      name,
      ok_rate: [1, 0.98, 0.36, 0.89, 0.84, 0.98][i]!,
      n: name === 'visualization' ? 19 : 47,
      fault_breakdown: name === 'sql_generation' ? { agent: 30 } : {},
    })),
    latency: { median_ms: 84000, p90_ms: 214000, over_5min: 3 },
    worker_gap_s: 78,
  },
  canaries: liveServiceNames.map((canary, i) => ({
    canary,
    status: canary === 'visualization' ? 'failed' : 'ok',
    fault: canary === 'visualization' ? 'system' : null,
    latency_ms: [32, 128, 440, 210, 1200, 28][i]!,
    checked_at: '2026-11-01T09:18:00Z',
  })),
  trend,
  days: {
    rows: trend
      .slice(-7)
      .reverse()
      .map((d) => ({
        day: d.day,
        status: d.day === liveDay ? 'running' : 'closed',
        turns_seen: d.turns,
        evaluated: d.turns - (d.day === liveDay ? 3 : 0),
        failed: d.counts_by_label.system_problem ?? 0,
        polls: d.day === liveDay ? 559 : 1440,
        max_poll_gap_s: 78,
        in_qym: d.turns,
        primary_rate: d.primary_rate,
        label_mix: d.counts_by_label,
        worker_gap: d.worker_gap,
      })),
    total: 7,
    page: 1,
    page_size: 30,
  },
  specs: liveSpecs,
  primary_metric: 'agent_success',
};

const questions = [
  'ما إجمالي عدد السكان في المناطق خلال عام 2025؟',
  'كيف تغير عدد السكان بين عامي 2024 و2025؟',
  'ما توزيع التأشيرات حسب النوع في الربع الأول؟',
  'قارن عدد التأشيرات الصادرة في يناير وفبراير.',
  'ما نسبة التوظيف حسب الفئة العمرية؟',
  'أي القطاعات سجلت أعلى نمو في عدد العاملين؟',
];
const reason = 'The generated query uses an incomplete category filter.';
const chartCounts = [1, 0, 2, 1, 0, 3];
const failedChartCounts = [1, 0, 1, 0, 0, 2];
export const liveTurnsPage: LiveTurnsPage = {
  rows: questions.map((question, i) => ({
    turn_id: `turn-${liveDay}-${String(i + 1).padStart(4, '0')}`,
    turn_at: `2026-11-01T${['09:12', '09:04', '08:53', '08:41', '08:32', '08:17'][i]}:00Z`,
    day: liveDay,
    question,
    mode: 'inquiry',
    label: 'agent_problem',
    label_reason: reason,
    status: 'completed',
    outcome: 'agent_failed',
    latency_ms: [84000, 20000, 122000, 194000, 62000, 360000][i]!,
    result_rows: [1, 2, 3, 2, 3, 4][i]!,
    user_ref: `u-${4821 + Math.floor(i / 3)}`,
    conversation_id: `conversation-${liveDay}-${String(Math.floor(i / 3) + 1).padStart(3, '0')}`,
    turn_index: 2 - (i % 3),
    charts: { count: chartCounts[i]!, failed: failedChartCounts[i]! },
    services_not_ok: [
      { name: 'sql_generation', fault: 'agent' },
      ...(failedChartCounts[i]! > 0 ? [{ name: 'visualization', fault: i === 5 ? 'system' : 'agent' }] : []),
    ],
    scores: Object.fromEntries(
      [
        ['agent_success', 0],
        ['compliance_a', 0.42 + i * 0.03],
        ['compliance_b', 0.38 + i * 0.04],
        ['chart_fidelity', 0.45],
      ].map(([name, score]) => [
        name,
        {
          score_numeric: name === 'chart_fidelity' && chartCounts[i] === 0 ? null : Number(score),
          label: null,
          skipped: name === 'chart_fidelity' && chartCounts[i] === 0,
        },
      ]),
    ),
  })),
  total: 6,
  facets: {
    labels: labelMix,
    statuses: { completed: 6 },
    outcomes: { agent_failed: 6 },
    modes: { inquiry: 47 },
    services: { sql_generation: 30, sql_execution: 5, visualization: 3 },
    users: [
      { user_ref: 'u-4821', n: 3 },
      { user_ref: 'u-4822', n: 3 },
    ],
  },
};

const agentSql = {
  text: "SELECT SUM(population) AS population\nFROM population_sample\nWHERE year = 2025 AND region = 'central'",
  executed: true,
  rows: 1,
  error: null,
};
const judgeSql = {
  text: 'SELECT SUM(population) AS population\nFROM population_sample\nWHERE year = 2025',
  executed: true,
  rows: 1,
  error: null,
};
const judge = (model: string, score: number) => ({
  model,
  compliance: { sql: score, response: score - 0.05, overall: score },
  reasoning: reason,
  sql_parts: [judgeSql],
  vs_agent: { equivalent: false, result_set_match: false, coverage: { covered: 1, total: 3 } },
});
/** Kept separately with inferred field types; both API evidence slots reference this same object. */
export const liveTurnEvidence = {
  router: { intent: 'analytical_query', confidence: 0.97 },
  judges: { a: judge('judge-a', 0.42), b: judge('judge-b', 0.38) },
  judges_agree: true,
  coverage: { covered: 1, total: 3 },
  cross_review: {
    a_on_b: { text: 'The assessment is supported by the results.', score: 0.95 },
    b_on_a: { text: reason, score: 0.38 },
  },
  deviations: [
    { judge: 'a', axis: 'sql', text: 'The region filter excludes categories requested in the question.' },
    {
      judge: 'b',
      axis: 'response',
      text: 'The response presents a regional subtotal as the total for all regions.',
    },
  ],
  envelope: {
    intent: 'analytical_query',
    expected_tools: ['retrieval', 'sql_execution', 'visualization'],
    actual_tools: ['retrieval', 'sql_execution', 'visualization'],
    matched: true,
  },
  tools: {
    calls: 3,
    budget: 8,
    failures: [{ name: 'visualization', step: 3, error: 'Output validation failed', fault: 'agent' }],
    list: [
      { name: 'retrieval', step: 1, ok: true },
      { name: 'sql_execution', step: 2, ok: true },
      { name: 'visualization', step: 3, ok: false },
    ],
  },
  sql_notes: { reused_by_judges: false, dialect_ok: true, validator_ok: false },
  charts: [
    {
      ref: 'chart-2026-11-01-1',
      kind: 'bar',
      scores: { chart_fidelity: 0.45, chart_vision: 0.6 },
      issues: ['Missing category label'],
      reading: 'يقارن الرسم القيم في الفئات الواردة في السؤال.',
    },
  ],
  services: Object.fromEntries(
    [...liveServiceNames, 'eval_health'].map((name) => [
      name,
      {
        status: ['sql_generation', 'visualization'].includes(name) ? 'failed' : 'ok',
        score: ['sql_generation', 'visualization'].includes(name) ? 0 : 1,
        fault: ['sql_generation', 'visualization'].includes(name) ? 'agent' : null,
        signals: { latency_ms: 120 },
      },
    ]),
  ),
  manifest_hash: worker.manifest_hash,
  evaluation_failed: false,
  skipped: false,
  eval_meta: {
    models: worker.judges,
    eval_code_version: worker.eval_code_version,
    attempt: 1,
    durations: { evaluation_ms: 4200 },
    mode: 'inquiry',
  },
};

const firstTurn = liveTurnsPage.rows[0]!;
export const liveTurnDetail: LiveTurnDetail = {
  turn: {
    ...firstTurn,
    id: 1,
    source_id: liveOverview.status.id,
    evaluated_at: '2026-11-01T09:13:24Z',
    received_at: '2026-11-01T09:14:00Z',
    answer: 'تعذر إكمال المقارنة المطلوبة؛ النتائج المتاحة غير مكتملة.',
    sql: [agentSql],
    tool_calls: 3,
    trace_url: 'https://example.com/traces/turn-0001',
    eval_trace_url: 'https://example.com/evaluations/turn-0001',
    summary: liveTurnEvidence,
    detail: { sample: true, evaluation: { verdict: 'agent_problem', reasoning: reason } },
    rejected: null,
  },
  summary: liveTurnEvidence,
  detail: { sample: true, evaluation: { verdict: 'agent_problem', reasoning: reason } },
  scores: liveSpecs.map((spec, i) => ({
    id: i + 1,
    turn_pk: 1,
    metric_name: spec.metric_name,
    score_numeric:
      firstTurn.scores[spec.metric_name]?.score_numeric ??
      (spec.metric_name.startsWith('service.')
        ? liveTurnEvidence.services[spec.metric_name.slice(8)]?.score
        : null) ??
      { error_detection: 1, response_latency: 84000, chart_vision: 0.6 }[spec.metric_name] ??
      null,
    score_raw: spec.metric_name === 'diagnosis' ? 'agent_problem' : null,
    label: spec.metric_name === 'diagnosis' ? 'agent_problem' : null,
    explanation: reason,
    meta: {},
    skipped: false,
    skip_reason: null,
    spec,
  })),
  conversation: liveTurnsPage.rows
    .slice(0, 3)
    .reverse()
    .map((r) => ({
      turn_id: r.turn_id,
      turn_at: r.turn_at,
      turn_index: r.turn_index,
      question: r.question,
      label: r.label,
      current: r.turn_id === firstTurn.turn_id,
    })),
  specs: liveSpecs,
};
