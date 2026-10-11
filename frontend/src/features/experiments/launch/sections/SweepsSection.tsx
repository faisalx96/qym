/** PLACEHOLDER (L1): replaced by the section's own agent. Keep the export name and "no props". */
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { Text } from '@/ui';

export function SweepsSection() {
  const { review } = useLaunch();
  return (
    <LaunchSection id="sweeps" title="Sweeps">
      <Text variant="base" tone="muted">
        Placeholder: L2 builds the sweep axes here. ({review.items.length} problems in the form)
      </Text>
    </LaunchSection>
  );
}
