import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { formatDuration } from '@/lib/format';
import { humanizeKey } from '@/lib/humanizeKey';
import { StatusMark, Text } from '@/ui';
import { statusWord } from './turn/presentation';
import styles from '../live.module.css';

/** A canary key as a name: 'judge_a' -> 'Judge A', any other key in plain words (B-08). */
function canaryName(key: string): string {
  const judge = /^judge_([a-z])$/i.exec(key);
  return judge ? `Judge ${judge[1]!.toUpperCase()}` : humanizeKey(key);
}

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
      {!canaries.length ? (
        <Text variant="sm" tone="muted">
          No canary results for this day
        </Text>
      ) : null}
      {[...canaries]
        .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'))
        .map((probe) => (
          <span key={probe.canary} className={styles.inline} data-live-canary={probe.canary}>
            <StatusMark
              tone={probe.status === 'failed' ? 'danger' : probe.status === 'ok' ? 'success' : 'neutral'}
              shape={probe.status === 'failed' ? 'cross' : probe.status === 'ok' ? 'check' : 'pause'}
              label={`${specs.find((spec) => spec.metric_name === `service.${probe.canary}`)?.label ?? canaryName(probe.canary)} ${statusWord(probe.status)}`}
              title={probe.fault ?? undefined}
            />
            <span className={styles.number}>
              {probe.latency_ms === null ? '—' : formatDuration(probe.latency_ms)}
            </span>
          </span>
        ))}
    </div>
  );
}
