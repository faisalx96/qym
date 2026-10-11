/** PLACEHOLDER (L1): replaced by the section's own agent. Keep the export name and "no props". */
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import { Text } from '@/ui';

export function RawJsonSection() {
  const { review } = useLaunch();
  return (
    <LaunchSection id="raw" title="Raw JSON">
      <Text variant="base" tone="muted">
        Placeholder: L3 builds the editor here. ({review.items.length} problems in the form)
      </Text>
    </LaunchSection>
  );
}
