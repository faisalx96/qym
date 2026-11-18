import type { LiveTurnDetail } from '@/api/live';
import { DiagnosisRules, DiagnosisSteps } from './DiagnosisVerdict';
import { TurnFacts } from './TurnFacts';

export function DiagnosisTab({ data }: { data: LiveTurnDetail }) {
  return (
    <>
      <DiagnosisSteps data={data} />
      <DiagnosisRules summary={data.summary} />
      <TurnFacts summary={data.summary} />
    </>
  );
}
