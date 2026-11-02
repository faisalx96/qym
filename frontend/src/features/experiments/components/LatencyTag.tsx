import { Flag } from '@/ui';

/** The one Latency-sensitive tag: sans, info tone, passive (detail title, list, queue). */
export function LatencyTag() {
  return (
    <Flag tone="info" icon="clock" data-testid="latency-tag">
      Latency-sensitive
    </Flag>
  );
}
