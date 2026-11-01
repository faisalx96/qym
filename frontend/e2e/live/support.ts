import { expect, type APIRequestContext } from '@playwright/test';
import { createApiKey, createProject } from '../helpers';

const diagnoses = [
  { value: 'ok', label: 'OK', tone: 'accent' },
  { value: 'suboptimal', label: 'Suboptimal', tone: 'warning' },
  { value: 'problem_a', label: 'Problem A', tone: 'danger' },
  { value: 'problem_b', label: 'Problem B', tone: 'warning' },
  { value: 'problem_c', label: 'Problem C', tone: 'meta' },
  { value: 'inconclusive', label: 'Inconclusive', tone: 'neutral' },
];

interface SeededDay {
  day: string;
  turns_seen: number;
  evaluated: number;
  turns: {
    label: string;
    latency_ms: number;
    scores: { metric_name: string; score_numeric: number | null; skipped: boolean }[];
  }[];
}

/** A small producer fixture, authenticated exactly like a live worker. */
export async function seedLive(
  request: APIRequestContext,
  slug: string,
  opts: { stale?: boolean; days?: number } = {},
) {
  const project = await createProject(request, 'Live evaluation demo', slug);
  const token = await createApiKey(request, project.id);
  const sourceKey = 'worker-preprod';
  const base = `/v1/projects/${project.id}/live/sources/${sourceKey}`;
  const headers = { Authorization: `Bearer ${token}` };
  const worker = {
    version: 'e2e-v1',
    poll_interval_s: 60,
    judges: { a: 'judge-a', b: 'judge-b' },
    eval_code_version: 'e2e-v1',
    manifest_hash: 'e2e-manifest',
  };
  const now = new Date();
  const days: SeededDay[] = [];

  const source = await request.put(base, {
    headers,
    data: { name: 'Preproduction worker', environment: 'preprod', day_key_timezone: 'UTC', worker },
  });
  expect(source.ok(), await source.text()).toBeTruthy();

  const metrics = [
    {
      metric_name: 'agent_success',
      group: 'quality',
      label: 'Agent success',
      score_type: 'percentage',
      is_primary: true,
    },
    {
      metric_name: 'diagnosis',
      group: 'diagnosis',
      label: 'Diagnosis',
      score_type: 'categorical',
      values: diagnoses,
    },
    { metric_name: 'compliance_a', group: 'quality', label: 'Compliance A', score_type: 'percentage' },
    { metric_name: 'compliance_b', group: 'quality', label: 'Compliance B', score_type: 'percentage' },
    { metric_name: 'chart_fidelity', group: 'charts', label: 'Chart fidelity', score_type: 'percentage' },
    { metric_name: 'chart_design', group: 'charts', label: 'Chart design', score_type: 'percentage' },
    {
      metric_name: 'service.sql_generation',
      group: 'service',
      label: 'SQL generation',
      score_type: 'boolean',
    },
    { metric_name: 'service.viz_agent', group: 'service', label: 'Visualization', score_type: 'boolean' },
  ];
  const specs = await request.put(`${base}/metric-specs`, {
    headers,
    data: {
      specs: metrics.map((metric, position) => ({
        ...metric,
        position,
        ...(metric.score_type === 'categorical' ? {} : { direction: 'maximize', pass_threshold: 1 }),
      })),
    },
  });
  expect(specs.ok(), await specs.text()).toBeTruthy();

  for (let offset = (opts.days ?? 3) - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const counters = { turns_seen: 14, evaluated: 8, failed: 2, incomplete: 2, excluded: 0 };
    const dayResult = await request.put(`${base}/days/${day}`, {
      headers,
      data: {
        status: offset ? 'closed' : 'running',
        ...counters,
        first_poll_at: `${day}T09:00:00Z`,
        last_poll_at: `${day}T09:12:00Z`,
        closed_at: offset ? `${day}T23:59:00Z` : null,
        parameters: { sample: 'navigation' },
      },
    });
    expect(dayResult.ok(), await dayResult.text()).toBeTruthy();

    const turns = Array.from({ length: 12 }, (_, index) => {
      const diagnosis = diagnoses[index % diagnoses.length]!;
      const failed = index % 6 === 2;
      const incomplete = index % 6 === 5;
      const chartFailed = index % 6 === 1;
      const charts =
        index % 2 === 0
          ? []
          : [
              {
                type: 'bar',
                title: 'Monthly totals',
                issues: chartFailed ? ['missing_axis_label'] : [],
              },
            ];
      const services = {
        sql_generation: { status: failed ? 'failed' : 'ok', fault: failed ? 'timeout' : null },
        viz_agent: { status: chartFailed ? 'failed' : 'ok', fault: chartFailed ? 'validation' : null },
      };
      return {
        turn_id: `${day}/turn-${index + 1}`,
        day,
        turn_at: `${day}T09:${String(index).padStart(2, '0')}:00Z`,
        evaluated_at: `${day}T09:${String(index).padStart(2, '0')}:30Z`,
        conversation_id: `${day}/conversation-${Math.floor(index / 3) + 1}`,
        turn_index: index % 3,
        user_ref: `user-${(index % 3) + 1}`,
        mode: index % 2 ? 'report' : 'chat',
        status: incomplete ? 'incomplete_ingest' : failed ? 'failed' : 'completed',
        outcome: incomplete ? 'unknown' : failed ? 'error' : 'success',
        label: diagnosis.value,
        label_reason: diagnosis.label,
        question: index === 0 ? 'ما إجمالي الطلبات؟' : `What is the total for group ${index + 1}?`,
        answer:
          failed || incomplete ? null : index === 0 ? 'إجمالي الطلبات 10.' : `The total is ${index + 10}.`,
        sql: [{ query: 'SELECT COUNT(*) AS total FROM orders', rows: 1 }],
        latency_ms: (index + 1) * 1000,
        result_rows: failed ? 0 : 1,
        tool_calls: 2,
        summary: { charts, services },
        detail: { evidence: { note: 'Synthetic evaluation evidence' } },
        scores: metrics.map((metric) => {
          const categorical = metric.score_type === 'categorical';
          const skipped = incomplete || metric.metric_name === 'chart_design';
          const score =
            metric.metric_name === 'service.sql_generation'
              ? Number(!failed)
              : metric.metric_name === 'service.viz_agent'
                ? Number(!chartFailed)
                : metric.metric_name === 'chart_fidelity'
                  ? Number(!chartFailed)
                  : diagnosis.value === 'ok'
                    ? 1
                    : 0.5;
          return {
            metric_name: metric.metric_name,
            score_numeric: categorical || skipped ? null : score,
            score_raw: categorical ? diagnosis.value : score,
            label: categorical ? diagnosis.value : null,
            explanation: 'Synthetic evaluation score',
            meta:
              metric.group === 'service' && score === 0 ? { fault: failed ? 'timeout' : 'validation' } : {},
            skipped,
            skip_reason: incomplete ? 'incomplete_ingest' : skipped ? 'not_applicable' : null,
          };
        }),
      };
    });
    const result = await request.post(`${base}/turns`, { headers, data: { turns } });
    expect(result.ok(), await result.text()).toBeTruthy();
    expect(await result.json()).toMatchObject({ accepted: 12, rejected: 0 });
    days.push({ day, ...counters, turns });
  }

  const canaries = await request.post(`${base}/canaries`, {
    headers,
    data: {
      results: ['sql_generation', 'viz_agent'].map((canary) => ({
        canary,
        checked_at: now.toISOString(),
        status: canary === 'viz_agent' ? 'failed' : 'ok',
        fault: canary === 'viz_agent' ? 'validation' : null,
        latency_ms: 120,
        detail: { probe: 'synthetic' },
        eval_code_version: 'e2e-v1',
      })),
    },
  });
  expect(canaries.ok(), await canaries.text()).toBeTruthy();
  expect(await canaries.json()).toMatchObject({ accepted: 2 });

  if (!opts.stale) {
    const heartbeat = await request.post(`${base}/heartbeat`, {
      headers,
      data: {
        at: now.toISOString(),
        last_poll_at: now.toISOString(),
        current_day: now.toISOString().slice(0, 10),
        worker,
      },
    });
    expect(heartbeat.ok(), await heartbeat.text()).toBeTruthy();
  }
  return { projectId: project.id, projectSlug: project.slug, sourceKey, days, labels: diagnoses, metrics };
}
