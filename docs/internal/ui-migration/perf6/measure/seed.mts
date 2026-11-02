/**
 * Perf6 seed (measurement only). Through the public ingest API of a running platform:
 *   - `big`   a classic run with 1,200 items (items-virtual shape, 5 traced)
 *   - `wide`  the round-3 wide repeat run (10 passes x 24 metrics)
 *   - 200 runs x 20 metric columns (4 items each; every 10th run has 3 passes, the round-4 passes shape)
 * Usage: node seed.mts http://127.0.0.1:8997 perf6 out.json
 */
import { writeFileSync } from 'node:fs';
import {
  EventStream,
  createApiKey,
  createRun,
  ensureProject,
  seedClassicRun,
  seedWideRepeatRun,
} from '../../../../../frontend/e2e/run-detail/seed.ts';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8997';
const slug = process.argv[3] ?? 'perf6';
const out = process.argv[4] ?? 'seed.json';
const client = { baseUrl };

const project = await ensureProject(client, 'Perf6', slug);
const token = await createApiKey(client, project.id);
const big = await seedClassicRun(client, token, { items: 1200, traced: 5, runName: 'big-1200' });
const wide = await seedWideRepeatRun(client, token);

const METRICS = Array.from({ length: 20 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`);
const specs = Object.fromEntries(
  METRICS.map((m, i) => [
    m,
    { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, primary: i === 0, schema_version: 2 },
  ]),
);
const runs: string[] = [];
for (let r = 0; r < 200; r++) {
  const samples = r % 10 === 0 ? 3 : 1;
  const name = `wide-${String(r).padStart(3, '0')}`;
  const runId = await createRun(client, token, {
    task: ['text2sql', 'summarize', 'rag-qa'][r % 3],
    dataset: 'perf-set',
    model: r % 2 ? 'openai/gpt-4o' : 'anthropic/claude-sonnet-4',
    metrics: METRICS,
    metric_specs: specs,
    run_metadata: { run_name: name },
    run_config: { samples },
  });
  const s = new EventStream(client, token, runId, r + 1);
  s.push('run_started', {
    task: 'perf',
    dataset: 'perf-set',
    model: 'x',
    metrics: METRICS,
    metric_specs: specs,
    total_items: 4,
    started_at: new Date(Date.UTC(2026, 8, 1) + r * 3_600_000).toISOString(),
    run_metadata: { run_name: name },
    run_config: { samples },
  });
  for (let p = 1; p <= samples; p++)
    for (let i = 0; i < 4; i++) {
      const id = `i${i}`;
      const base = { item_id: id, index: i, pass_number: p };
      s.push('item_started', { ...base, input: `q${i}`, expected: 'a' });
      for (const [k, m] of METRICS.entries())
        s.push('metric_scored', {
          item_id: id,
          pass_number: p,
          metric_name: m,
          score_numeric: ((r * 7 + i * 13 + k * 17 + p) % 100) / 100,
          meta: {},
        });
      s.push('item_completed', { ...base, output: 'a', latency_ms: 500 + i * 50 });
    }
  s.push('run_completed', { ended_at: new Date(Date.UTC(2026, 8, 1) + r * 3_600_000 + 60_000).toISOString(), final_status: 'COMPLETED', summary: { total_items: 4 } });
  await s.flush();
  runs.push(runId);
}
writeFileSync(out, JSON.stringify({ slug, big, wide, runs, metrics: METRICS }, null, 2));
console.log('seeded', { slug, big, wide, runs: runs.length });
