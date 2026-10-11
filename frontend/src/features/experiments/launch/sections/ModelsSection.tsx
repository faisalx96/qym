/** PLACEHOLDER (L1): replaced by the section's own agent. Keep the export name and "no props". */
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { Text } from '@/ui';

export function ModelsSection() {
  const { review } = useLaunch();
  return (
    <LaunchSection id="models" title="Models">
      <Text variant="base" tone="muted">
        Placeholder: L3 builds the model cards here. ({review.items.length} problems in the form)
      </Text>
    </LaunchSection>
  );
}
