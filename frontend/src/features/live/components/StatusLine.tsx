import { useEffect, useState } from 'react';
import type { LiveSourceInfo } from '@/api/live';
import { Link } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { modelSeriesOf } from '@/features/runs-list/model';
import { formatRelative } from '@/lib/format';
import { Card, ModelTag, StateTag, Tag, Text } from '@/ui';
import { staleText, statusTime } from '../lib/stale';
import { workerStateTag } from './worker/format';
import styles from '../live.module.css';

export function StatusLine({
  status,
  slug,
  source,
  modelIndex,
}: {
  status: LiveSourceInfo;
  slug: string;
  source: string;
  modelIndex?: Record<string, number> | null;
}) {
  const workerUrl = `${projectPath(slug, 'live/worker')}?${new URLSearchParams({ source })}`;
  const control = status.worker.control;
  const errors = status.errors_last_hour ?? control?.errors_last_hour ?? 0;
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
  const workerState = control ? workerStateTag(control.state, control.settings_version_applied) : null;
  return (
    <Card
      compact
      data-live-block="status"
      data-live-stale={stale ? 'true' : 'false'}
    >
      <div className={styles.status} data-stale={stale ? '' : undefined}>
        {stale ? <StateTag tone="danger">Stale</StateTag> : <StateTag tone="info">Running</StateTag>}
        {stale ? null : <span>{staleText(status, now)}</span>}
        <span title={formatRelative(status.last_turn_at, now)}>
          Last turn <span className={styles.time}>{lastTurn}</span>
        </span>
        {workerState ? (
          <span className={styles.inline}>
            <Text as="span" tone="muted">
              Worker
            </Text>
            <StateTag tone={workerState.tone}>{workerState.label}</StateTag>
          </span>
        ) : null}
        {errors > 0 ? (
          <Link to={`${workerUrl}#problems`}>
            <Tag tone="danger">
              {errors} {errors === 1 ? 'problem' : 'problems'} in the last hour
            </Tag>
          </Link>
        ) : null}
        {judges.length > 0 ? (
          <span className={styles.inline}>
            Judges{' '}
            {judges.map((judge, index) => (
              <ModelTag
                key={`${index}-${judge}`}
                name={judge}
                series={modelSeriesOf(modelIndex ?? null, judge, false)}
              />
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
