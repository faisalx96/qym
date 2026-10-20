import { Tag } from '@/ui';

/** The one Latency-sensitive tag: sans, info tone, passive (detail title, list, queue). */
export function LatencyTag() {
  return (
    <Tag tone="info" data-testid="latency-tag">
      Latency-sensitive
    </Tag>
  );
}
