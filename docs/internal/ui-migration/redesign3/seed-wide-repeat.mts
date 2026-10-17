import * as s from '/home/meshari-aldossari/Documents/qym/qym-wt-redesign3-run-detail/frontend/e2e/run-detail/seed.ts';
const base = process.argv[2];
const client = { baseUrl: base };
const p = await s.ensureProject(client, 'R3 seed', 'r3-seed');
const t = await s.createApiKey(client, p.id);
const out: any = { project: p.slug };
out.classic = await s.seedClassicRun(client, t);
out.repeat3 = await s.seedRepeatRun(client, t);
out.arabic = await s.seedArabicRepeatRun(client, t);
out.many = await s.seedManyCategories(client, t);
// big: 10 passes, 24 metrics
const specs: any = { correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, primary: true, schema_version: 2 } };
for (let m = 1; m <= 23; m++) specs[`rubric_metric_${String(m).padStart(2,'0')}`] = { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 };
const metrics = Object.keys(specs);
const samples = 10, n = 24;
const runId = await s.createRun(client, t, { task: 'big_repeat', dataset: 'ar-big', model: 'openai/gpt-5-mini', metrics, metric_specs: specs,
  run_metadata: { run_name: 'repeat-10-passes-24-metrics', owner: 'meshari', git_sha: 'a1b2c3d', prompt_version: 'v7' }, run_config: { samples, temperature: 0.7 } });
const st = new s.EventStream(client, t, runId, 77);
st.push('run_started', { task: 'big_repeat', dataset: 'ar-big', model: 'openai/gpt-5-mini', metrics, metric_specs: specs, total_items: n, started_at: new Date(Date.UTC(2026,9,4,9)).toISOString(), run_config: { samples } });
let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for (let p2 = 1; p2 <= samples; p2++) {
  for (let i = 0; i < n; i++) {
    const id = `big-${String(i+1).padStart(3,'0')}`;
    st.push('item_started', { item_id: id, index: i, pass_number: p2, input: i % 2 ? 'ما هي شروط الحصول على تمويل عقاري وفق الضوابط الحالية؟' : `Question ${i}: summarise clause ${i}`, expected: i % 2 ? 'تمويل بشروط' : `Clause ${i} requires approval`, item_metadata: { domain: ['finance','support','legal'][i%3], complexity: ['easy','hard'][i%2] } });
    st.push('item_attempt_started', { item_id: id, index: i, pass_number: p2, attempt_number: 1, trace_id: `t-${id}-${p2}`, task_started_at_ms: Date.UTC(2026,9,4,9) + (p2*n+i)*1000 });
    const ok = rnd() > 0.35 + (i%5)*0.05 ? 1 : 0;
    for (const mname of metrics) {
      const v = mname === 'correct' ? ok : Math.min(1, Math.max(0, (ok ? .8 : .4) + (rnd()-.5)*.4));
      st.push('metric_scored', { item_id: id, pass_number: p2, metric_name: mname, score_numeric: Number(v.toFixed(3)), ...(mname==='correct' ? { score_raw: ok===1 } : {}), meta: mname==='rubric_metric_01' ? { reason: 'يغطي معظم النقاط', judge_model: 'gpt-5', confidence: 0.7 } : {} });
    }
    st.push('item_completed', { item_id: id, index: i, pass_number: p2, is_final_pass: p2 === samples, output: { answer: i%2 ? `الإجابة ${p2}: التمويل العقاري يتطلب مستندات` : `Answer ${p2} for ${i}`, reasoning: i%2 ? 'حللت السؤال ثم استرجعت المستندات' : 'Looked up the clause then summarised it.', citations: [{ doc: 'policy', page: i+1, score: 0.9 }, { doc: 'guide', page: 4, score: 0.6 }], meta: { nested: { a: [1,2,{ b: 'deep' }], c: { d: 'e' } }, tags: ['x','y'] }, confidence: 0.7 }, latency_ms: 800 + Math.round(rnd()*2000), trace_id: `t-${id}-${p2}` });
  }
  st.push('pass_completed', { pass_number: p2, samples });
}
st.push('run_completed', { ended_at: new Date(Date.UTC(2026,9,4,10)).toISOString(), final_status: 'COMPLETED' });
await st.flush();
out.big = runId;
console.log(JSON.stringify(out));
