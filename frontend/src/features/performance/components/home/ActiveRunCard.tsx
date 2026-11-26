/** Performance home: the run in progress (what it is, where it stands, Stop, the plan picture). Its title opens it. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PerformanceActiveRun, PerformanceRunRow } from '@/api/performance';
import { performanceRunPath } from '@/app/routes';
import { formatTime } from '@/lib/dates';
import { Button, Card, DatasetTag, Icon, StatStrip, Text, UserName } from '@/ui';
import { P95_HINT, TEST_NAME, count, pct, secs, span } from '../../lib/format';
import { Seconds } from './Seconds';
import { Legend, Quantity, RunStatus, Stepladder } from '../shared';
import { StopRunDialog } from './StopRunDialog';
import { activeOutcomes, comingUp, planBaseline, planTop } from './model';
import styles from './home.module.css';

export function ActiveRunCard({
  slug,
  active,
  row,
  stopLocked,
}: {
  slug: string;
  active: PerformanceActiveRun;
  /** The run's row of the history, when the first page holds it: it names the questions. */
  row?: PerformanceRunRow;
  /** Why this person cannot stop the run (a viewer): Stop stays in place, disabled with the reason (§3.1). */
  stopLocked?: string;
}) {
  const [asking, setAsking] = useState(false);
  const stages = active.stages ?? [];
  const top = planTop(stages);
  const finished = active.answers_finished ?? 0;
  const ok = finished - (active.errors ?? 0);
  const share = active.p95_ms === null ? null : Math.round((active.p95_ms / active.limit_ms) * 100);
  const to = performanceRunPath(slug, active.id);
  const stopAsked = active.stop_requested || active.status === 'stopping';
  const started = active.started_at
    ? `Started ${formatTime(active.started_at)} by`
    : `Asked for at ${formatTime(active.requested_at)} by`;
  return (
    <Card as="section" aria-label="Run in progress" data-performance-block="active-run">
      <div className={styles.stack}>
        <div className={styles.runHead}>
          <div className={styles.tight}>
            <div className={styles.row}>
              <Text variant="lg" as="h2">
                <Link to={to} data-link="name">
                  Run {active.number}
                </Link>
              </Text>
              <RunStatus status={active.status} />
            </div>
            <div className={styles.row}>
              <span>
                {TEST_NAME[active.test_type]} on {active.target.name}
              </span>
              {row ? <DatasetTag name={row.dataset.name} version={row.dataset.version} /> : null}
              <span className={styles.figures}>{started}</span>
              <UserName id={active.requested_by_user_id} name={active.requested_by} />
            </div>
          </div>
          {/* No Open beside the title: the title already opens the run (Q07 B). */}
          <div className={styles.row}>
            <Button
              variant="danger"
              icon={<Icon name="stop" size={12} />}
              onPress={() => setAsking(true)}
              isDisabled={stopAsked || stopLocked !== undefined}
              disabledReason={stopLocked ?? 'Stop was already asked for'}
            >
              Stop run
            </Button>
          </div>
        </div>
        <div className={styles.runBody} data-plain={stages.length ? undefined : ''}>
          <div>
            <StatStrip
              variant="compact"
              pairs
              aria-label="Run in progress, in numbers"
              items={[
                {
                  key: 'level',
                  label: 'Level now',
                  value: (
                    <Quantity
                      value={count(active.level ?? active.users)}
                      unit={top === null ? 'users' : `of ${top} users`}
                    />
                  ),
                  sub: comingUp(active) ?? (active.elapsed_s === null ? 'not started yet' : undefined),
                },
                {
                  key: 'p95',
                  label: 'p95 so far',
                  help: P95_HINT,
                  value: <Seconds ms={active.p95_ms} after={`of ${secs(active.limit_ms, 0)}`} />,
                  sub: share === null ? 'no answers yet' : `${share}% of the time limit`,
                },
                {
                  key: 'answered',
                  label: 'Answered',
                  value: finished ? pct((ok / finished) * 100) : '–',
                  sub: finished ? `${count(ok)} of ${count(finished)} questions` : 'no answers yet',
                },
                {
                  key: 'left',
                  label: 'Time left',
                  value: span(Math.max(0, active.planned_s - (active.elapsed_s ?? 0))),
                  sub: active.elapsed_s === null ? 'not started yet' : `${span(active.elapsed_s)} in`,
                },
              ]}
            />
          </div>
          {stages.length ? (
            <div className={styles.tight}>
              <Stepladder
                stages={stages}
                baseline={planBaseline(stages)}
                outcomes={activeOutcomes(active)}
                nowS={active.elapsed_s ?? undefined}
                height={96}
                compact
              />
              <Legend
                items={[
                  { label: 'Passed', tone: 'success' },
                  { label: 'Measuring now', tone: 'info' },
                  { label: 'Not measured', tone: 'neutral' },
                ]}
              />
            </div>
          ) : null}
        </div>
      </div>
      {stopLocked === undefined ? (
        <StopRunDialog slug={slug} active={active} open={asking} onOpenChange={setAsking} />
      ) : null}
    </Card>
  );
}
