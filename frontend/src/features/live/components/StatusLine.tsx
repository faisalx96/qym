import { useEffect, useState } from 'react';
import type { LiveSourceInfo } from '@/api/live';
import { Link } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { modelSeriesOf } from '@/features/runs-list/model';
import { formatAgo } from '@/lib/dates';
import { formatRelative } from '@/lib/format';
import { Card, ModelTag, StateTag, StatusMark, Tag } from '@/ui';
import { statusTime } from '../lib/stale';
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
    <Card compact data-live-block="status" data-live-stale={stale ? 'true' : 'false'}>
      <dl className={styles.status} data-stale={stale ? '' : undefined}>
        <div className={styles.statusItem}>
          <dt>State</dt>
          <dd>
            <StatusMark
              tone={stale ? 'danger' : 'info'}
              shape={stale ? 'cross' : 'orbit'}
              label={stale ? 'Stale' : 'Running'}
            />
          </dd>
        </div>
        <div className={styles.statusItem}>
          <dt>Last poll</dt>
          <dd className={styles.time} title={formatRelative(status.last_poll_at, now)}>
            {status.last_poll_at ? formatAgo(status.last_poll_at, now) : '—'}
          </dd>
        </div>
        <div className={styles.statusItem}>
          <dt>Last turn</dt>
          <dd className={styles.time} title={formatRelative(status.last_turn_at, now)}>
            {lastTurn}
          </dd>
        </div>
        <div className={styles.statusItem}>
          <dt>Judges</dt>
          <dd className={styles.inline}>
            {judges.map((judge, index) => (
              <ModelTag
                key={`${index}-${judge}`}
                name={judge}
                series={modelSeriesOf(modelIndex ?? null, judge, false)}
              />
            ))}
            {judges.length === 0 ? '—' : null}
          </dd>
        </div>
        {(
          [
            ['eval_code_version', 'Worker version'],
            ['manifest_hash', 'Rules version'],
          ] as const
        ).map(([key, label]) =>
          typeof worker[key] === 'string' && worker[key] ? (
            <div key={key} className={styles.statusItem}>
              <dt>{label}</dt>
              <dd>
                <Tag kind="version" dir="auto">
                  {worker[key]}
                </Tag>
              </dd>
            </div>
          ) : null,
        )}
        {workerState ? (
          <div className={styles.statusItem}>
            <dt>Worker</dt>
            <dd>
              <StateTag tone={workerState.tone}>{workerState.label}</StateTag>
            </dd>
          </div>
        ) : null}
        {errors > 0 ? (
          <div className={styles.statusItem}>
            <dt>Problems</dt>
            <dd>
              <Link to={`${workerUrl}#problems`}>
                <Tag tone="danger">
                  {errors} {errors === 1 ? 'problem' : 'problems'} in the last hour
                </Tag>
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
