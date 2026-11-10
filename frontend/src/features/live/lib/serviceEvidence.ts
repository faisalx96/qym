import { recordsOf, stringsOf } from './evidenceValues';
import { booleanOf, numberOf, recordOf, servicesOf, stringOf, type ToolsEvidence } from './summary';

export function servicesTabBadge(summary: Record<string, unknown>) {
  const services = servicesOf(summary);
  return {
    count: services.filter((service) => service.status !== 'ok').length,
    tone: services.some((service) => service.status === 'failed') ? ('danger' as const) : undefined,
  };
}

export const faultLabel = (fault: string) =>
  fault === 'infra' ? 'infrastructure' : fault === 'policy' ? 'privacy guard' : fault;

/** Known worker signal shapes have a short, default-visible reading. Unknown shapes stay inspectable. */
export function serviceEvidence(signals: Record<string, unknown> | null): string | null {
  if (!signals) return null;
  const s = signals;
  const n = (key: string) => numberOf(s[key]);
  const t = (key: string) => stringOf(s[key]);
  if (t('span') !== null) {
    return `${t('span')}${t('status_message') ? `: ${t('status_message')}` : ''}${n('error_count') !== null ? ` (${n('error_count')} errors)` : ''}`;
  }
  if (n('total_calls') !== null) {
    const total = n('total_calls')!;
    const failed = n('failed_calls');
    const blocked = n('blocked');
    const faults = Object.entries(recordOf(s.fault_breakdown) ?? {}).flatMap(([key, value]) =>
      numberOf(value) !== null && (value as number) > 0 ? [`${faultLabel(key)} ${value}`] : [],
    );
    return `${failed ? `${failed} of ${total} calls failed${faults.length ? ` (${faults.join(', ')})` : ''}` : `${total} calls`}${blocked ? `, ${blocked} blocked by the privacy guard` : ''}${booleanOf(s.recovered) ? ', recovered' : ''}`;
  }
  if (t('router_intent') !== null || t('classified_intent') !== null) {
    return [
      t('router_intent')
        ? `Router: ${t('router_intent')}${n('router_confidence') !== null ? ` (${n('router_confidence')!.toFixed(2)})` : ''}`
        : null,
      t('classified_intent')
        ? `Evaluator read it as: ${t('classified_intent')}${t('classifier_used') ? ` (${t('classifier_used')})` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('. ');
  }
  if (Array.isArray(s.selected_tables) || Array.isArray(s.judge_tables) || Array.isArray(s.missing_tables)) {
    const missing = stringsOf(s.missing_tables);
    return [
      missing.length ? `Missing: ${missing.join(', ')}` : null,
      Array.isArray(s.selected_tables) ? `Selected ${stringsOf(s.selected_tables).length}` : null,
      Array.isArray(s.judge_tables) ? `judges needed ${stringsOf(s.judge_tables).length}` : null,
    ]
      .filter(Boolean)
      .join('. ');
  }
  if (n('sql_score_a') !== null || n('sql_score_b') !== null || n('delta') !== null) {
    return [
      ['sql_score_a', 'Judge A'],
      ['sql_score_b', 'Judge B'],
      ['delta', 'gap'],
    ]
      .flatMap(([key, label]) => (n(key!) === null ? [] : [`${label} ${n(key!)!.toFixed(2)}`]))
      .join(', ');
  }
  if (
    n('attempt') !== null ||
    Array.isArray(s.component_failures) ||
    booleanOf(s.skipped_before_evaluation) !== null
  ) {
    const failures = stringsOf(s.component_failures);
    return (
      [
        n('attempt') !== null ? `Attempt ${n('attempt')}` : null,
        failures.length ? `Failed parts: ${failures.join(', ')}` : null,
        booleanOf(s.skipped_before_evaluation) ? 'Skipped before evaluation' : null,
      ]
        .filter(Boolean)
        .join('. ') || null
    );
  }
  if (Array.isArray(s.granted) || Array.isArray(s.fired) || Array.isArray(s.pii_judge)) {
    const fired = [
      ...stringsOf(s.fired),
      ...recordsOf(s.fired).flatMap((item) => {
        const stage = stringOf(item.stage)?.replaceAll('_', ' ');
        const rule = stringOf(item.rule_id);
        return stage ? [`${stage}${rule ? ` (${rule})` : ''}`] : [];
      }),
    ];
    const judges = stringsOf(s.pii_judge);
    return [
      'Privacy guardrail active',
      fired.length ? `Fired: ${fired.join(', ')}` : null,
      judges.length ? `PII judge: ${judges.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('. ');
  }
  return null;
}

/** Match repeated tool names in call order; an explicit step takes precedence. Never discard an unmatched failure. */
export function matchToolFailures(tools: ToolsEvidence | null) {
  const remaining = [...(tools?.failures ?? [])];
  const calls = (tools?.list ?? []).map((call) => {
    let index = remaining.findIndex(
      (failure) => failure.name === call.name && failure.step !== null && failure.step === call.step,
    );
    if (index < 0 && call.ok !== true)
      index = remaining.findIndex((failure) => failure.name === call.name && failure.step === null);
    const failure = index < 0 ? null : remaining.splice(index, 1)[0]!;
    return { ...call, failure };
  });
  // Some producers mark empty output as OK in the trace and failed in health.
  for (const call of calls) {
    if (call.failure) continue;
    const index = remaining.findIndex((failure) => failure.name === call.name && failure.step === null);
    if (index >= 0) call.failure = remaining.splice(index, 1)[0]!;
  }
  return { calls, unmatched: remaining };
}
