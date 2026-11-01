import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { StatusMark, Text } from '@/ui';
import styles from '../live.module.css';

export function Canaries({
  canaries,
  specs,
}: {
  canaries: LiveOverview['canaries'];
  specs: LiveMetricSpec[];
}) {
  return (
    <div className={styles.canaries} data-live-block="canaries">
      <Text variant="sm" tone="muted">
        Canaries
      </Text>
      {[...canaries]
        .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'))
        .map((probe) => (
          <span key={probe.canary} className={styles.inline} data-live-canary={probe.canary}>
            <StatusMark
              tone={probe.status === 'failed' ? 'danger' : probe.status === 'ok' ? 'success' : 'neutral'}
              shape={probe.status === 'failed' ? 'cross' : probe.status === 'ok' ? 'check' : 'pause'}
              label={`${specs.find((spec) => spec.metric_name === `service.${probe.canary}`)?.label ?? probe.canary} ${probe.status}`}
              title={probe.fault ?? undefined}
            />
            <span className={styles.number}>
              {probe.latency_ms === null ? '—' : `${probe.latency_ms} ms`}
            </span>
          </span>
        ))}
    </div>
  );
}
