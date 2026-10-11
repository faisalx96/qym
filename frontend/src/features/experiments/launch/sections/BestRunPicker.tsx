/** PLACEHOLDER (L1): L3 builds the picker on useBestRunScope / useBestRuns / chooseBase('best_run', ...). */
import { Text } from '@/ui';
import { useLaunch } from '../LaunchContext';

export function BestRunPicker() {
  const { doc } = useLaunch();
  return (
    <Text variant="sm" tone="muted">
      Best-run picker goes here{doc.base.pending ? ' (pick a scope to find runs)' : ''}.
    </Text>
  );
}
