import type { LiveMetricSpec } from '@/api/live';
import { ScoreValue } from '@/ui';
import { scoreText } from './presentation';

export function ThresholdScore({ value, spec }: { value: number | null; spec?: LiveMetricSpec | null }) {
  const verdict =
    value !== null && spec?.pass_threshold != null
      ? (spec.direction === 'minimize' ? value <= spec.pass_threshold : value >= spec.pass_threshold)
        ? 'pass'
        : 'fail'
      : null;
  return (
    <ScoreValue
      value={value}
      text={scoreText(value, spec)}
      direction={spec?.direction}
      variant="plain"
      verdict={verdict}
    />
  );
}
