// Round 5 seed: node seed-r5.mts <platform url>
// Posts (through the public API) the runs round 5 measures:
//   details  48 items, one pass. `quality` has all 11 score buckets filled (counts 1..14, one 22) so the histogram has 11 columns;
//            judge metadata with a long English reasoning, a table-shaped criteria list, a list of objects, a nested object;
//            `arabic_judge` has Arabic reason / reasoning / explanation; latency spreads over 20+ bins.
//   passes19 19 passes x 6 items, 2 metrics (Passes passed has 20 columns, per-pass rows have 19 rows).
//   wide     the round-3 wide repeat run (10 passes, 24 metrics) from the e2e seed.
import * as s from '/home/meshari-aldossari/Documents/qym/qym-wt-redesign5-run-detail/frontend/e2e/run-detail/seed.ts';

const base = process.argv[2];
const client = { baseUrl: base };
const p = await s.ensureProject(client, 'R5 seed', process.env.SLUG ?? 'r5-seed');
const t = await s.createApiKey(client, p.id);
const out: Record<string, string> = { project: p.slug };

let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- details run -------------------------------------------------------------------------------------------------
const specs: Record<string, unknown> = {
  quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2, primary: true },
  faithfulness: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  rubric_judge: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  arabic_judge: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  tokens_used: { score_type: 'count', schema_version: 2 },
};
const metrics = Object.keys(specs);
// bucket counts for `quality`: index 0..10 (0%..100%)
const bucketCounts = [2, 3, 5, 4, 6, 7, 9, 22, 14, 8, 6];
const qualityScores: number[] = [];
bucketCounts.forEach((c, b) => {
  for (let k = 0; k < c; k++) qualityScores.push(Math.min(1, b / 10 + (b === 10 ? 0 : 0.02 + (k % 3) * 0.02)));
});
const n = qualityScores.length;
const runId = await s.createRun(client, t, {
  task: 'support_agent', dataset: 'r5-details', model: 'openai/gpt-5-mini', metrics, metric_specs: specs,
  run_metadata: { run_name: 'r5-metric-details', owner: 'meshari' }, run_config: { temperature: 0.2 },
});
const st = new s.EventStream(client, t, runId, 501);
st.push('run_started', { task: 'support_agent', dataset: 'r5-details', model: 'openai/gpt-5-mini', metrics, metric_specs: specs, total_items: n, started_at: new Date(Date.UTC(2026, 9, 4, 9)).toISOString(), run_config: {} });
const longReasoning =
  'The answer identifies the correct policy (clause 4.2) and quotes the approval threshold, but it never mentions the exception for existing customers that the reference answer calls out. The tone is appropriate and the length is acceptable. Two of the three required steps are present; the escalation step is missing, which lowers the score from 0.9 to the value reported here. A reviewer should check whether the exception applies to this customer segment before trusting the result.';
for (let i = 0; i < n; i++) {
  const id = `r5-${String(i + 1).padStart(3, '0')}`;
  const ar = i % 3 === 1;
  st.push('item_started', { item_id: id, index: i, input: ar ? 'ما هي شروط الحصول على تمويل عقاري وفق الضوابط الحالية؟' : `Question ${i}: summarise clause ${i} of the policy`, expected: ar ? 'تمويل بشروط' : `Clause ${i} requires approval`, item_metadata: { domain: ['finance', 'support', 'legal'][i % 3], complexity: ['easy', 'hard'][i % 2] } });
  st.push('item_attempt_started', { item_id: id, index: i, attempt_number: 1, trace_id: `t-${id}`, task_started_at_ms: Date.UTC(2026, 9, 4, 9) + i * 1000 });
  const q = qualityScores[i]!;
  const scores: Record<string, number> = {
    quality: q, faithfulness: Math.min(1, Math.max(0, q + (rnd() - 0.5) * 0.3)), correct: q >= 0.6 ? 1 : 0,
    rubric_judge: Math.min(1, Math.max(0, q + (rnd() - 0.5) * 0.2)), arabic_judge: Math.min(1, Math.max(0, q + (rnd() - 0.5) * 0.2)), tokens_used: 300 + Math.round(rnd() * 900),
  };
  const meta: Record<string, Record<string, unknown>> = {
    quality: { reason: 'Covers most of the required points and cites the right policy.', judge_model: 'gpt-5', confidence: 0.82 },
    faithfulness: { reason: 'Every claim is supported by the retrieved passages.', unsupported_claims: 0 },
    correct: { reason: 'The final answer matches the reference.' },
    rubric_judge: {
      reasoning: longReasoning,
      detailed_reasoning_trace: 'Step 1 matched the question to clause 4.2. Step 2 compared the quoted threshold with the reference. Step 3 looked for the exception and did not find it.',
      self_consistency_check_result: 'Three of three re-scored samples agree within 0.05, so the judge was stable on this item.',
      judge_model: 'gpt-5', confidence: 0.74, latency_ms: 2140, temperature: 0.2,
      criteria: [
        { criterion: 'Cites the governing policy', weight: 0.3, score: 1, note: 'Clause 4.2 quoted' },
        { criterion: 'States the approval threshold', weight: 0.25, score: 1, note: 'SAR 50,000' },
        { criterion: 'Mentions the existing-customer exception', weight: 0.25, score: 0, note: 'Missing' },
        { criterion: 'Escalation step is present', weight: 0.2, score: 0.5, note: 'Mentioned without an owner' },
      ],
      evidence: [
        { doc: 'policy-handbook.pdf', page: 12, quote: 'Approvals above SAR 50,000 require a second reviewer.', relevance: 0.93 },
        { doc: 'faq.md', page: 3, quote: 'Existing customers follow the fast track.', relevance: 0.61 },
        { doc: 'guide.pdf', page: 7, quote: 'Escalate to the regional owner within two days.', relevance: 0.48 },
      ],
      breakdown: { retrieval: { precision: 0.8, recall: 0.6, notes: ['one miss', 'one extra'] }, generation: { fluency: 0.95, tone: 'neutral' } },
      flags: ['missing_exception', 'no_owner'],
      log_table: Array.from({ length: 14 }, (_, k) => ({ step: `step_${k + 1}`, tool: ['search', 'rerank', 'read'][k % 3], ms: 120 + k * 17, ok: k % 5 !== 4 })),
      score_table: { columns: ['criterion', 'weight', 'score', 'note'], rows: [['Cites the governing policy', 0.3, 1, 'Clause 4.2 quoted'], ['States the approval threshold', 0.25, 1, 'SAR 50,000'], ['Mentions the existing-customer exception', 0.25, 0, 'Missing'], ['Escalation step is present', 0.2, 0.5, 'Mentioned without an owner']] },
    },
    arabic_judge: {
      reason: 'الإجابة تغطي معظم النقاط المطلوبة وتستشهد بالسياسة الصحيحة.',
      reasoning: 'حللت السؤال أولاً ثم قارنت الإجابة بالمرجع. الإجابة تذكر الحد الأدنى للموافقة لكنها لا تذكر الاستثناء الخاص بالعملاء الحاليين، لذلك خُفضت الدرجة. يُنصح بمراجعة الحالة يدوياً قبل الاعتماد على النتيجة.',
      explanation: 'درجة جيدة مع نقص في الاستثناءات',
      step_by_step_reasoning_notes: 'الخطوة الأولى: قراءة السؤال. الخطوة الثانية: مطابقة الإجابة مع المرجع. الخطوة الثالثة: البحث عن الاستثناء ولم يُعثر عليه.',
      confidence: 0.77, judge_model: 'gpt-5',
      checks: [{ name: 'السياسة', passed: true, weight: 0.5 }, { name: 'الاستثناء', passed: false, weight: 0.5 }],
    },
    tokens_used: {},
  };
  for (const m of metrics) st.push('metric_scored', { item_id: id, metric_name: m, score_numeric: Number(scores[m]!.toFixed(3)), ...(m === 'correct' ? { score_raw: scores[m] === 1 } : {}), meta: meta[m] });
  st.push('item_completed', { item_id: id, index: i, output: ar ? { answer: 'التمويل العقاري يتطلب مستندات', reasoning: 'حللت السؤال ثم استرجعت المستندات' } : { answer: `Answer for ${i}`, reasoning: 'Looked up the clause then summarised it.' }, latency_ms: Math.round(500 * Math.exp(rnd() * 3.2)), trace_id: `t-${id}` });
}
st.push('run_completed', { ended_at: new Date(Date.UTC(2026, 9, 4, 10)).toISOString(), final_status: 'COMPLETED' });
await st.flush();
out.details = runId;

// ---- 19 passes ---------------------------------------------------------------------------------------------------
{
  const sp: Record<string, unknown> = {
    correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, primary: true, schema_version: 2 },
    quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  };
  const ms = Object.keys(sp);
  const samples = 19, items = 6;
  const rid = await s.createRun(client, t, { task: 'passes19', dataset: 'r5-p19', model: 'openai/gpt-5-mini', metrics: ms, metric_specs: sp, run_metadata: { run_name: 'r5-19-passes' }, run_config: { samples } });
  const s2 = new s.EventStream(client, t, rid, 77);
  s2.push('run_started', { task: 'passes19', dataset: 'r5-p19', model: 'openai/gpt-5-mini', metrics: ms, metric_specs: sp, total_items: items, started_at: new Date(Date.UTC(2026, 9, 4, 9)).toISOString(), run_config: { samples } });
  for (let ps = 1; ps <= samples; ps++) {
    for (let i = 0; i < items; i++) {
      const id = `p-${i + 1}`;
      s2.push('item_started', { item_id: id, index: i, pass_number: ps, input: `Question ${i}`, expected: 'x' });
      s2.push('item_attempt_started', { item_id: id, index: i, pass_number: ps, attempt_number: 1, trace_id: `t-${id}-${ps}`, task_started_at_ms: Date.UTC(2026, 9, 4, 9) + (ps * items + i) * 1000 });
      const ok = rnd() > 0.2 + i * 0.12 ? 1 : 0;
      s2.push('metric_scored', { item_id: id, pass_number: ps, metric_name: 'correct', score_numeric: ok, score_raw: ok === 1, meta: {} });
      s2.push('metric_scored', { item_id: id, pass_number: ps, metric_name: 'quality', score_numeric: Number(Math.min(1, Math.max(0, (ok ? 0.8 : 0.4) + (rnd() - 0.5) * 0.4)).toFixed(3)), meta: {} });
      s2.push('item_completed', { item_id: id, index: i, pass_number: ps, is_final_pass: ps === samples, output: { answer: `a${ps}` }, latency_ms: 700 + Math.round(rnd() * 2500), trace_id: `t-${id}-${ps}` });
    }
    s2.push('pass_completed', { pass_number: ps, samples });
  }
  s2.push('run_completed', { ended_at: new Date(Date.UTC(2026, 9, 4, 10)).toISOString(), final_status: 'COMPLETED' });
  await s2.flush();
  out.passes19 = rid;
}
if (process.argv[3] !== 'small') {
  out.classic = await s.seedClassicRun(client, t);
  out.wide = await s.seedWideRepeatRun(client, t);
}
console.log(JSON.stringify(out));
