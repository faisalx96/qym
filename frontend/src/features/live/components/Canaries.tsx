import type { LiveOverview } from '@/api/live';
import { StatusMark, Text } from '@/ui';
import { statusWord } from './turn/presentation';

/** The latest canary result for one service, beside its daily health. */
export function CanaryStatus({ probe }: { probe?: LiveOverview['canaries'][number] }) {
  return (
    <span
      data-live-canary={probe?.canary}
      title={probe?.fault ?? (probe?.status === 'skipped' ? 'Canary skipped' : undefined)}
    >
      {!probe || probe.status === 'skipped' ? (
        <Text variant="sm" tone="muted">
          No canary
        </Text>
      ) : (
        <StatusMark
          tone={probe.status === 'ok' ? 'success' : 'danger'}
          shape={probe.status === 'ok' ? 'check' : 'cross'}
          label={statusWord(probe.status)}
        />
      )}
    </span>
  );
}
