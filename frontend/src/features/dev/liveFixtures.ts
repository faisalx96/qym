/** Static API-shaped examples for the Live design round. Vocabulary matches scripts/seed_live.py. */
import { workerDefaults, type LiveWorkerRead, type LiveWorkerEvent } from '@/api/liveWorker';
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
    { value: 'reference_problem', label: 'Reference problem', tone: 'info' },
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
// Generated 240 × 140 PNG, shared with e2e/live/fixtures/chart.png (836 bytes).
export const liveChartImage = {
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAACMCAIAAADN17N/AAADC0lEQVR4nO3SsY1YQQxDQZZxoctw8+7LoWMnGwlfoDDA5MsVXn5+fsEZWV8Ag7K+AAZlfQEMyvoCGJT1BTAo6wtgUNYXwKCsL4BBWV8Ag7K+AAZlfQEMyvoCGJT1BTAo6wtgUNYXwKCsL4BBWV8Ag7K+AAZlfQEMyvoCGJT1BTAo6wtgUNYXwKCsL+Bjv//8/cz3v8v6ffmYoDlF0JwiaE4RNKcImlMEzSmC5hRBc4qgOUXQnCJoThE0pwiaUwTNKYLmFEFziqA5RdCcImhOETSnCJpTBM0pguY/7UG073/Leh912oNo3/+W9T7qtAfRvv8t633UaQ+iff9b1vuo0x5E+/63rPdRpz2I9v1vWe+jTnsQ7fvfst5HnfYg2ve/Zb2POu1BtO9/y3ofddqDaN//lvU+6rQH0b7/Let91GkPon3/W9b7qNMeRPv+t6z3Uac9iPb9b1nvo057EO3737LeR532INr3v2W9jzrtQbTvf8t6H3Xag2jf/5b1Puq0B9G+/y3rfdRpD6J9/1vW+6jTHkT7/res91GnPYj2/W9Z76NOexDt+9+y3ked9iDa979lvY867UG073/Leh912oNo3/+W9T7qtAfRvv8t633UaQ+iff9bBGF/1/63fP9k+0HtF/Spg9ov6FMHtV/Qpw5qv6BPHdR+QZ86qP2CPnVQ+wV96qD2C/rUQe0X9KmD2i/oUwe1X9CnDmq/oE8d1H5Bnzqo/YI+dVD7BX3qoPYL+tRB7Rf0qYPaL+hTB7Vf0KcOar+gTx3UfkGfOqj9gj51UPsFfeqg9gv61EHtF/Spg9ov6FMHtV/Qpw5qv6BPHdR+QZ86qP2CPnVQ+wV96qD2C/rUQe0X9KmD2i/oUwe1X9CnDmq/oE8d1H5Bnzqo/YI+dVD7BX3qoPYL+tRB7Rc0fCTrC2BQ1hfAoKwvgEFZXwCDsr4ABmV9AQzK+gIYlPUFMCjrC2BQ1hfAoKwvgEFZXwCDsr4ABmV9AQzK+gIYlPUFMCjrC2BQ1hfAoKwvgEFZXwCDsr4ABv0DyyvFMm6/1agAAAAASUVORK5CYII=',
  width: 240,
  height: 140,
  byte_size: 836,
};

export const liveTurnDetail: LiveTurnDetail = {
  chart_images: { [liveTurnEvidence.charts[0]!.ref]: liveChartImage },
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

const workerValues = workerDefaults();
workerValues.models = {
  connection_id: 'gateway-prod',
  judge_a: 'judge-a',
  judge_b: 'judge-b',
  vision_judge: 'vision-judge',
  vision_extractor: 'vision-extractor',
  vision_design_judge: 'vision-design',
};
workerValues.langfuse = { host: 'https://langfuse.example.com', public_key: 'pk-live-demo' };
workerValues.dataiku = { url: 'https://dataiku.example.com', database: 'analytics' };
workerValues.database = {
  host: 'evaluation-db.internal',
  port: 5432,
  database: 'evaluation',
  user: 'worker',
  sslmode: 'require',
};
const workerAt = '2026-11-03T14:20:00Z';
export const liveWorkerRead: LiveWorkerRead = {
  state: { desired: 'running', changed_at: workerAt, changed_by: 'Ali' },
  running: {
    state: 'running',
    reason: null,
    settings_version_applied: 3,
    applied_at: workerAt,
    verification: {
      version: 3,
      ok: true,
      checked_at: workerAt,
      checks: { 'database.dns': { ok: true, latency_ms: 12, error: null } },
    },
    running: workerValues,
    models: {
      listed_at: workerAt,
      ids: ['judge-a', 'judge-b', 'vision-judge', 'vision-extractor', 'vision-design'],
    },
    errors_last_hour: 19,
    last_error: {
      at: workerAt,
      component: 'gateway',
      code: 'gateway_timeout',
      message: 'The model gateway did not respond in time.',
    },
    job: { id: 'job-running', kind: 'backfill', progress: { found: 22, evaluated: 12 } },
  },
  stale: false,
  worker_key: {
    id: 'key-worker',
    name: 'Evaluation worker',
    prefix: 'qym_worker',
    changed_at: workerAt,
    changed_by: 'Ali',
  },
  api_keys: [
    { id: 'key-worker', name: 'Evaluation worker', prefix: 'qym_worker' },
    { id: 'key-next', name: 'Replacement worker', prefix: 'qym_next' },
  ],
  settings: {
    version: 3,
    created_at: workerAt,
    created_by: 'Ali',
    note: 'Production settings',
    values: workerValues,
    secret_hints: { langfuse_secret_key: '1234', database_password: '5678', dataiku_api_key: '9012' },
  },
  versions: [
    { version: 3, created_at: workerAt, created_by: 'Ali', note: 'Production settings' },
    { version: 2, created_at: '2026-11-02T09:00:00Z', created_by: 'Sara', note: 'Initial connection checks' },
  ],
  jobs: [
    {
      id: 'job-running',
      kind: 'backfill',
      params: {
        since_day: '2026-11-01',
        until_day: '2026-11-02',
        since: '2026-11-01T00:00:00Z',
        until: '2026-11-03T00:00:00Z',
        limit: 200,
      },
      status: 'running',
      progress: { found: 22, skipped_existing: 2, evaluated: 12, failed: 1 },
      error: null,
      requested_by: 'Ali',
      requested_at: workerAt,
      started_at: workerAt,
      finished_at: null,
      cancel_requested: false,
    },
    {
      id: 'job-done',
      kind: 'backfill_preview',
      params: {
        since_day: '2026-10-30',
        until_day: '2026-10-31',
        since: '2026-10-30T00:00:00Z',
        until: '2026-11-01T00:00:00Z',
        limit: 200,
      },
      status: 'done',
      progress: { found: 22, skipped_existing: 2, evaluated: 22, failed: 1 },
      error: null,
      requested_by: 'Sara',
      requested_at: '2026-11-02T09:00:00Z',
      started_at: '2026-11-02T09:00:01Z',
      finished_at: '2026-11-02T09:00:04Z',
      cancel_requested: false,
    },
  ],
  connections: [
    {
      id: 'gateway-prod',
      name: 'Production gateway',
      base_url: 'https://gateway.example.com',
      api_key_last4: '1234',
    },
    {
      id: 'gateway-dev',
      name: 'Development gateway',
      base_url: 'https://gateway-dev.example.com',
      api_key_last4: '5678',
    },
    {
      id: 'gateway-vision',
      name: 'Vision gateway',
      base_url: 'https://vision.example.com',
      api_key_last4: '9012',
    },
  ],
  model_ids: ['judge-a', 'judge-b', 'vision-judge', 'vision-extractor', 'vision-design'],
};
export const liveWorkerWaiting: LiveWorkerRead = {
  ...liveWorkerRead,
  worker_key: null,
  settings: null,
  versions: [],
  jobs: [],
  model_ids: [],
  running: {
    ...liveWorkerRead.running!,
    state: 'waiting',
    reason: 'no settings version',
    settings_version_applied: null,
    applied_at: null,
    verification: null,
    running: null,
    models: null,
    job: null,
    errors_last_hour: 0,
    last_error: null,
  },
};
export const liveWorkerPaused: LiveWorkerRead = {
  ...liveWorkerRead,
  state: { ...liveWorkerRead.state, desired: 'paused' },
  running: { ...liveWorkerRead.running!, state: 'paused', job: null },
  jobs: [],
};
export const liveWorkerPending: LiveWorkerRead = {
  ...liveWorkerRead,
  settings: {
    ...liveWorkerRead.settings!,
    version: 4,
    values: {
      ...workerValues,
      database: { ...workerValues.database, host: 'estishraf-agent-preprod-db.estishraf-agent-preprod' },
    },
  },
  versions: [
    { version: 4, created_at: workerAt, created_by: 'Ali', note: 'Change database host' },
    ...liveWorkerRead.versions,
  ],
  running: { ...liveWorkerRead.running!, settings_version_applied: 3, verification: null },
};
export const liveWorkerFailed: LiveWorkerRead = {
  ...liveWorkerPending,
  running: {
    ...liveWorkerPending.running!,
    verification: {
      version: 4,
      ok: false,
      checked_at: workerAt,
      checks: {
        'database.dns': {
          ok: false,
          latency_ms: null,
          error:
            'could not translate host name "estishraf-agent-preprod-db.estishraf-agent-preprod" to address: Temporary failure in name resolution',
        },
      },
    },
  },
};
export const liveWorkerEvents: LiveWorkerEvent[] = [
  {
    id: 6,
    level: 'error',
    component: 'gateway',
    code: 'gateway_timeout',
    message: 'The model gateway did not respond in time.',
    details: { model: 'judge-a', timeout_s: 60 },
    count: 14,
    first_at: '2026-11-03T14:08:00Z',
    last_at: workerAt,
  },
  {
    id: 5,
    level: 'error',
    component: 'langfuse',
    code: 'langfuse_unavailable',
    message: 'Could not fetch chats from Langfuse.',
    details: { status: 503 },
    count: 3,
    first_at: '2026-11-03T14:00:00Z',
    last_at: '2026-11-03T14:12:00Z',
  },
  {
    id: 4,
    level: 'warning',
    component: 'renderer',
    code: 'chart_render_timeout',
    message: 'The chart renderer timed out; the remaining evaluation continued.',
    details: { chart: 'revenue-by-region' },
    count: 2,
    first_at: '2026-11-03T13:50:00Z',
    last_at: '2026-11-03T14:02:00Z',
  },
  {
    id: 3,
    level: 'error',
    component: 'qym_push',
    code: 'push_rejected',
    message: 'The result could not be sent to qym. The worker will retry.',
    details: { status: 502 },
    count: 1,
    first_at: '2026-11-03T13:55:00Z',
    last_at: '2026-11-03T13:55:00Z',
  },
  {
    id: 2,
    level: 'warning',
    component: 'gateway',
    code: 'model_list_unavailable',
    message: 'Could not refresh the list of model ids.',
    details: {},
    count: 4,
    first_at: '2026-11-03T13:30:00Z',
    last_at: '2026-11-03T13:45:00Z',
  },
  {
    id: 1,
    level: 'error',
    component: 'langfuse',
    code: 'trace_read_failed',
    message: 'A chat trace could not be read.',
    details: { trace_id: 'trace-demo-1' },
    count: 1,
    first_at: '2026-11-03T13:40:00Z',
    last_at: '2026-11-03T13:40:00Z',
  },
];
