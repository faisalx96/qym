/** Where this experiment's jobs sit in the dispatch queue; hidden when nothing is live. */
import { useMemo } from 'react';
import { useExperimentQueue } from '@/api/experiments';
import { LinkButton, SectionHeader, Card } from '@/ui';
import { buildQueueStrip } from '../lib/matrix';
import { queuePath } from '../paths';
import styles from './detail.module.css';

export function QueueStrip({
  projectId,
  slug,
  experimentId,
  live,
}: {
  projectId: string;
  slug: string;
  experimentId: string;
  live: boolean;
}) {
  const query = useExperimentQueue(projectId, experimentId, live);
  const rows = useMemo(() => (live ? buildQueueStrip(query.data?.jobs ?? []) : []), [live, query.data]);
  if (!rows.length) return null;
  return (
    <Card as="section" aria-labelledby="queue-strip-title" data-exp-queue-strip>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <SectionHeader
            id="queue-strip-title"
            title="Queue"
            description="Jobs of this experiment that have not finished."
          />
          <LinkButton to={queuePath(slug, { experiment: experimentId })} variant="neutral">
            Open in queue →
          </LinkButton>
        </div>
        <ul className={styles.queueList}>
          {rows.map((row) => (
            <li key={row.environmentId} className={styles.queueRow}>
              <span className={styles.queueEnv}>{row.environmentName}</span>
              <span className={styles.mono}>
                {row.queued} queued · {row.running} running · {row.blocked} blocked
                {row.position !== null ? ` · position ${row.position}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
