/**
 * Custom run seeding for the cutover specs: a run whose items carry exactly the scores, metadata,
 * reasons and errors a spec needs (the shared seeds fix those). Goes through the public RunEventV1 API.
 */
import { EventStream, createRun } from './seed';
import { client, type Seeded } from './support';

export interface CustomScore {
  score: number;
  meta?: Record<string, unknown>;
  label?: string;
  explanation?: string;
}

export interface CustomItem {
  id: string;
  input: unknown;
  expected?: unknown;
  /** Absent with `error`: the task failed. */
  output?: unknown;
  error?: string;
  latency?: number;
  metadata?: Record<string, unknown>;
  scores?: Record<string, CustomScore>;
}

export interface CustomRun {
  name: string;
  specs: Record<string, Record<string, unknown>>;
  items: CustomItem[];
  task?: string;
  dataset?: string;
  model?: string;
  runMetadata?: Record<string, unknown>;
  /** Default true. */
  complete?: boolean;
  /** Passes of a repeat run (default 1): every item is scored in each pass. */
  samples?: number;
}

export const PERCENT = { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 };

export async function seedCustomRun(s: Seeded, o: CustomRun): Promise<string> {
  const metrics = Object.keys(o.specs);
  const task = o.task ?? 'cutover_task';
  const dataset = o.dataset ?? 'cutover-set';
  const model = o.model ?? 'cutover/model';
  const runId = await createRun(client, s.token, {
    task,
    dataset,
    model,
    metrics,
    metric_specs: o.specs,
    run_metadata: { run_name: o.name, ...(o.runMetadata ?? {}) },
    ...(o.samples && o.samples > 1 ? { run_config: { samples: o.samples } } : {}),
  });
  const stream = new EventStream(client, s.token, runId, 5);
  stream.push('run_started', {
    task,
    dataset,
    model,
    metrics,
    metric_specs: o.specs,
    total_items: o.items.length,
    started_at: new Date().toISOString(),
    run_metadata: { run_name: o.name, ...(o.runMetadata ?? {}) },
    ...(o.samples && o.samples > 1 ? { run_config: { samples: o.samples } } : {}),
  });
  const passes = o.samples && o.samples > 1 ? o.samples : 1;
  for (let pass = 1; pass <= passes; pass++) {
    const tag = passes > 1 ? { pass_number: pass } : {};
    o.items.forEach((item, index) => {
      stream.push('item_started', {
        item_id: item.id,
        index,
        ...tag,
        input: item.input,
        expected: item.expected ?? 'expected',
        item_metadata: item.metadata ?? {},
      });
      if (item.error) {
        stream.push('item_failed', { item_id: item.id, index, ...tag, error: item.error, latency_ms: item.latency ?? 300 });
        return;
      }
      for (const [metric, sc] of Object.entries(item.scores ?? {})) {
        stream.push('metric_scored', {
          item_id: item.id,
          metric_name: metric,
          ...tag,
          score_numeric: sc.score,
          meta: sc.meta ?? {},
          ...(sc.label ? { label: sc.label } : {}),
          ...(sc.explanation ? { explanation: sc.explanation } : {}),
        });
      }
      stream.push('item_completed', {
        item_id: item.id,
        index,
        ...tag,
        output: item.output ?? `answer ${item.id}`,
        latency_ms: item.latency ?? 300,
        item_metadata: item.metadata ?? {},
      });
    });
  }
  if (o.complete !== false)
    stream.push('run_completed', { ended_at: new Date().toISOString(), final_status: 'COMPLETED' });
  await stream.flush();
  return runId;
}
