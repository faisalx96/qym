import { formatDurationMs } from '@/lib/format';
import { toDate } from '@/lib/dates';
import type { LiveTurnDetail } from '@/api/live';
import { Subsection, Text } from '@/ui';
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
    <Subsection
      title="Timings"
      className={styles.stack}
      aside={
        timing.total !== null ? <Text mono>Total {formatDurationMs(timing.total * 1000)}</Text> : undefined
      }
    >
      {timing.parts.length ? (
        <>
          <div className={styles.timingBar} aria-hidden="true">
            {timing.parts.map((part) => (
              <span key={part.key} style={{ flexGrow: timing.scale ? part.seconds / timing.scale : 0 }} />
            ))}
          </div>
          <div className={styles.inline} aria-label="Stage durations">
            {timing.parts.map((part) => (
              <Text key={part.key}>
                {part.label} <span className={styles.mono}>{formatDurationMs(part.seconds * 1000)}</span>
              </Text>
            ))}
          </div>
        </>
      ) : null}
      {asked || received ? (
        <div className={styles.inline}>
          {asked ? (
            <Text>
              Asked → evaluated <span className={styles.mono}>{asked}</span>
            </Text>
          ) : null}
          {received ? (
            <Text>
              Evaluated → received <span className={styles.mono}>{received}</span>
            </Text>
          ) : null}
        </div>
      ) : null}
    </Subsection>
  );
}
