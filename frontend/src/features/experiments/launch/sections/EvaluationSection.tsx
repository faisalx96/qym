/** PLACEHOLDER (L1): replaced by the section's own agent. Keep the export name and "no props". */
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { Text } from '@/ui';

export function EvaluationSection() {
  const { review } = useLaunch();
  return (
    <LaunchSection id="evaluation" title="Evaluation configurations">
      <Text variant="base" tone="muted">
        Placeholder: L3 builds the evaluation inputs here. ({review.items.length} problems in the form)
      </Text>
    </LaunchSection>
  );
}
