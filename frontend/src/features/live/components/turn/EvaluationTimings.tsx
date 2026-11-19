import { formatDurationMs } from '@/lib/format';
import { toDate } from '@/lib/dates';
import type { LiveTurnDetail } from '@/api/live';
import { Text } from '@/ui';
import { evaluationTiming } from '../../lib/evaluatorRecord';
import styles from './EvaluatorTab.module.css';

function lag(start: string | null, end: string | null) {
  const a = toDate(start);
  const b = toDate(end);
  return a && b && b.getTime() >= a.getTime() ? formatDurationMs(b.getTime() - a.getTime()) : null;
}

export function EvaluationTimings({ data }: { data: LiveTurnDetail }) {
  const timing = evaluationTiming(data.summary);
  const asked = lag(data.turn.turn_at, data.turn.evaluated_at);
  const received = lag(data.turn.evaluated_at, data.turn.received_at);
  if (timing.total === null && !asked && !received) return null;
  return (
    <section aria-label="Evaluation time" className={styles.timings}>
      <Text as="h3" variant="base" weight={600}>
        Evaluation time{timing.total !== null ? ` · Total ${formatDurationMs(timing.total * 1000)}` : ''}
      </Text>
      {timing.parts.length ? (
        <>
          <div className={styles.timingBar} aria-hidden="true">
            {timing.parts
              .filter((part) => part.seconds > 0)
              .map((part) => (
                <span
                  key={part.key}
                  data-stage={part.key}
                  style={{ flexGrow: timing.scale ? part.seconds / timing.scale : 0 }}
                />
              ))}
          </div>
          <ul className={styles.legend} aria-label="Stage durations">
            {timing.parts.map((part) => (
              <li key={part.key}>
                <span className={styles.stageMark} data-stage={part.key} aria-hidden="true" />
                <span>
                  {part.label} · {formatDurationMs(part.seconds * 1000)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {asked || received ? (
        <div className={styles.inline}>
          {asked ? <Text>Asked → evaluated {asked}</Text> : null}
          {received ? <Text>Evaluated → received {received}</Text> : null}
        </div>
      ) : null}
    </section>
  );
}
