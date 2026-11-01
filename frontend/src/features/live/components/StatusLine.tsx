import { useEffect, useState } from 'react';
import type { LiveSourceInfo } from '@/api/live';
import { formatRelative } from '@/lib/format';
import { Card, StatusMark, Tag } from '@/ui';
import { staleText, statusTime } from '../lib/stale';
import styles from '../live.module.css';

export function StatusLine({ status }: { status: LiveSourceInfo }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const { worker, stale } = status;
  const judges =
    worker.judges && typeof worker.judges === 'object'
      ? Object.values(worker.judges).filter((judge): judge is string => typeof judge === 'string')
      : [];
  const lastTurn = status.last_turn_at ? statusTime(status.last_turn_at, now) : '—';
  return (
    <Card
      compact
      tone={stale ? 'danger' : undefined}
      wash={stale ? 'danger' : undefined}
      data-live-block="status"
      data-live-stale={stale ? 'true' : 'false'}
    >
      <div className={styles.status} data-stale={stale ? '' : undefined}>
        <StatusMark
          tone={stale ? 'danger' : 'success'}
          data-tone={stale ? 'danger' : 'accent'}
          shape={stale ? 'cross' : 'orbit'}
          label={stale ? 'Stale' : 'Running'}
        />
        <span>{staleText(status, now)}</span>
        <span title={formatRelative(status.last_turn_at, now)}>
          Last turn <span className={styles.number}>{lastTurn}</span>
        </span>
        {judges.length > 0 ? (
          <span className={styles.inline}>
            Judges{' '}
            {judges.map((judge, index) => (
              <Tag key={`${index}-${judge}`} kind="data" dir="auto">
                {judge}
              </Tag>
            ))}
          </span>
        ) : null}
        {['eval_code_version', 'manifest_hash'].map((key) =>
          typeof worker[key] === 'string' && worker[key] ? (
            <Tag key={key} kind="version" dir="auto">
              {worker[key]}
            </Tag>
          ) : null,
        )}
      </div>
    </Card>
  );
}
