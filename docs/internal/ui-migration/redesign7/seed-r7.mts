// Round 7 seed. Usage (Node 24, from the repo root):
//   node docs/internal/ui-migration/redesign7/seed-r7.mts <platform url> [slug] [out.json]
// Posts, through the public ingest API only, ONE project (default slug `r7-seed`) whose first runs page (50 rows,
// newest first) holds:
//   - 12 repeat runs, 10 passes x 300 items each, 3 metrics   (Q2: the passes of a typical repeat run)
//   - 1 repeat run, 10 passes x 1,200 items                     (Q2: the large case, `passes1200`)
//   - 4 repeat runs, 3 passes x 100 items                       (a group strip with 3 passes)
//   - `big1200`, a classic 1,200-item single run                (D1, D3: the frozen input column, 1,200 rows)
//   - `jsonKeys`, a run whose item outputs, expected values and metric details are JSON with long keys (40 and 80
//     characters, snake_case and camelCase), depth-4 nesting, Arabic keys and values, and a key named `reasoning` (D2);
//     it is `seedR7JsonKeys` of frontend/e2e/run-detail/seed.ts, the fixture the Playwright specs use too
//   - 31 classic runs of 60 items                               (the rest of the page)
// Output: JSON { slug, repeat300: [ids], passes1200, repeat3: [ids], big1200, jsonKeys, classic: [ids], runs: [all ids] }.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as s from '../../../../frontend/e2e/run-detail/seed.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:8971';
const slug = process.argv[3] ?? 'r7-seed';
const outFile = process.argv[4] ?? 'seed-r7.json';
const client = { baseUrl: base };
const project = await s.ensureProject(client, 'R7 seed', slug);
const token = await s.createApiKey(client, project.id);

let rs = 7;
const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);

/** A run's event stream with big batches (the shared EventStream posts 400 lines per request). */
class Bulk {
  lines: string[] = [];
  seq = 0;
  runId: string;
  constructor(runId: string) {
    this.runId = runId;
  }
  push(type: string, payload: Record<string, unknown>): void {
    this.seq += 1;
    this.lines.push(
      JSON.stringify({
        schema_version: 1,
        event_id: randomUUID(),
        sequence: this.seq,
        sent_at: new Date(Date.UTC(2026, 9, 18, 12, 0, 0) + this.seq * 5).toISOString(),
        type,
        run_id: this.runId,
        payload,
      }),
    );
  }
  async flush(batch = 1500): Promise<void> {
    while (this.lines.length) {
      const body = this.lines.splice(0, batch).join('\n') + '\n';
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base}/v1/runs/${this.runId}/events`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
          body,
        });
        const text = await res.text();
        if (res.ok) {
          const j = JSON.parse(text) as { rejected: number; rejected_events?: unknown[] };
          if (j.rejected) throw new Error(`rejected ${JSON.stringify(j.rejected_events).slice(0, 600)}`);
          break;
        }
        if (attempt > 4) throw new Error(`events -> ${res.status}: ${text.slice(0, 400)}`);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
}

const SPECS = {
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, primary: true, schema_version: 2 },
  quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  faithfulness: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
};
const METRICS = Object.keys(SPECS);
let clock = 0; // run start times: newest first on the page, spaced one minute apart
const runStart = () => new Date(Date.UTC(2026, 9, 18, 12, 0, 0) - clock++ * 60_000).toISOString();

/** A repeat run (samples >= 2) with `items` items per pass. */
async function repeatRun(name: string, samples: number, items: number): Promise<string> {
  const started = runStart();
  const runId = await s.createRun(client, token, {
    task: 'sql_agent',
    dataset: `r7-${items}`,
    model: clock % 2 ? 'anthropic/claude-sonnet-4' : 'openai/gpt-5-mini',
    metrics: METRICS,
    metric_specs: SPECS,
    run_metadata: { run_name: name },
    run_config: { samples, temperature: 0.7 },
  });
  const st = new Bulk(runId);
  st.push('run_started', {
    task: 'sql_agent', dataset: `r7-${items}`, model: 'x', metrics: METRICS, metric_specs: SPECS, total_items: items,
    started_at: started, run_metadata: { run_name: name }, run_config: { samples },
  });
  const t0 = Date.parse(started);
  for (let p = 1; p <= samples; p++) {
    for (let i = 0; i < items; i++) {
      const id = `q-${String(i + 1).padStart(4, '0')}`;
      const latency = Math.round(400 + rnd() * 2600);
      st.push('item_started', { item_id: id, index: i, pass_number: p, input: `List the top ${i + 1} customers by revenue in region ${i % 4}`, expected: `SELECT name FROM customers LIMIT ${i + 1}`, item_metadata: { domain: ['commerce', 'finance', 'support'][i % 3] } });
      st.push('item_attempt_started', { item_id: id, index: i, pass_number: p, attempt_number: 1, trace_id: `t-${runId.slice(0, 6)}-${id}-p${p}`, task_started_at_ms: t0 + (p * items + i) * 40 });
      const stable = i % 5 !== 0;
      const correct = stable ? (i % 4 === 0 ? 0 : 1) : rnd() > 0.5 ? 1 : 0;
      const q = Math.min(1, Math.max(0, (correct ? 0.8 : 0.4) + (rnd() - 0.5) * 0.3));
      st.push('metric_scored', { item_id: id, pass_number: p, metric_name: 'correct', score_numeric: correct, score_raw: correct === 1, meta: {} });
      st.push('metric_scored', { item_id: id, pass_number: p, metric_name: 'quality', score_numeric: Number(q.toFixed(3)), meta: {} });
      st.push('metric_scored', { item_id: id, pass_number: p, metric_name: 'faithfulness', score_numeric: Number(Math.min(1, Math.max(0, q + (rnd() - 0.5) * 0.2)).toFixed(3)), meta: {} });
      st.push('item_completed', { item_id: id, index: i, pass_number: p, is_final_pass: p === samples, output: `SELECT name FROM customers ORDER BY ${correct ? 'revenue' : 'name'} LIMIT ${i + 1}`, latency_ms: latency, trace_id: `t-${runId.slice(0, 6)}-${id}-p${p}` });
    }
    st.push('pass_completed', { pass_number: p, samples });
  }
  st.push('run_completed', { ended_at: new Date(t0 + 3_600_000).toISOString(), final_status: 'COMPLETED' });
  await st.flush();
  return runId;
}

async function classicRun(name: string, items: number): Promise<string> {
  const started = runStart();
  const runId = await s.createRun(client, token, {
    task: ['text2sql', 'summarize', 'rag-qa'][clock % 3], dataset: 'r7-classic', model: clock % 2 ? 'openai/gpt-4o' : 'anthropic/claude-sonnet-4',
    metrics: METRICS, metric_specs: SPECS, run_metadata: { run_name: name }, run_config: {},
  });
  const st = new Bulk(runId);
  st.push('run_started', { task: 'x', dataset: 'r7-classic', model: 'x', metrics: METRICS, metric_specs: SPECS, total_items: items, started_at: started, run_metadata: { run_name: name }, run_config: {} });
  for (let i = 0; i < items; i++) {
    const id = `c-${String(i + 1).padStart(3, '0')}`;
    st.push('item_started', { item_id: id, index: i, input: `Question ${i}`, expected: 'a' });
    const q = rnd();
    st.push('metric_scored', { item_id: id, metric_name: 'correct', score_numeric: q > 0.4 ? 1 : 0, score_raw: q > 0.4, meta: {} });
    st.push('metric_scored', { item_id: id, metric_name: 'quality', score_numeric: Number(q.toFixed(3)), meta: {} });
    st.push('metric_scored', { item_id: id, metric_name: 'faithfulness', score_numeric: Number(Math.min(1, q + 0.1).toFixed(3)), meta: {} });
    st.push('item_completed', { item_id: id, index: i, output: 'a', latency_ms: 300 + Math.round(rnd() * 1500) });
  }
  st.push('run_completed', { ended_at: new Date(Date.parse(started) + 60_000).toISOString(), final_status: 'COMPLETED' });
  await st.flush();
  return runId;
}

// ---- go ----------------------------------------------------------------------------------------------------------
const out: Record<string, unknown> = { slug };
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const repeat300: string[] = [];
for (let r = 0; r < 12; r++) {
  repeat300.push(await repeatRun(`r7-repeat300-${String(r + 1).padStart(2, '0')}`, 10, 300));
  log(`repeat300 ${r + 1}/12`);
}
out.passes1200 = await repeatRun('r7-passes1200', 10, 1200);
log('passes1200');
const repeat3: string[] = [];
for (let r = 0; r < 4; r++) repeat3.push(await repeatRun(`r7-repeat3-${r + 1}`, 3, 100));
log('repeat3');
out.big1200 = await s.seedClassicRun(client, token, { items: 1200, traced: 5, runName: 'r7-big-1200' });
log('big1200');
out.jsonKeys = await s.seedR7JsonKeys(client, token, { startedAt: new Date(runStart()) });
log('jsonKeys');
const classic: string[] = [];
for (let r = 0; r < 31; r++) classic.push(await classicRun(`r7-classic-${String(r + 1).padStart(2, '0')}`, 60));
log('classic');
out.repeat300 = repeat300;
out.repeat3 = repeat3;
out.classic = classic;
out.keys = s.R7_KEYS;
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ slug, repeat300: repeat300.length, passes1200: out.passes1200, big1200: out.big1200, jsonKeys: out.jsonKeys }));
