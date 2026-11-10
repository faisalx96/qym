import { judgeOf, recordOf, stringOf } from '../../lib/summary';

/** Add the optional quote without changing Q0's evidence fallback rules. */
export function deviationEvidence(summary: Record<string, unknown>, side: 'a' | 'b') {
  // Reuse Q0's structured/flat-list fallback, including rows with no judge object.
  const judge = judgeOf(summary, side) ?? judgeOf({ ...summary, judges: { [side]: {} } }, side)!;
  const rawJudge = recordOf(recordOf(summary.judges)?.[side]);
  const raw = rawJudge && Object.hasOwn(rawJudge, 'deviations') ? rawJudge.deviations : summary.deviations;
  // Q0 does not expose quote yet. Match its record filtering so quotes retain their original index.
  const records = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const record = recordOf(item);
        return record && (raw === rawJudge?.deviations || record.judge === side) ? [record] : [];
      })
    : [];
  return judge.deviations.flatMap((item, index) => {
    const quote = stringOf(records[index]?.quote);
    return item.textEn || item.textAr || item.type || quote || item.droppedReason ? [{ ...item, quote }] : [];
  });
}
