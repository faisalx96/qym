/** One run's line in an error card: identity, count, change against the baseline. */
import { Tag, Text } from '@/ui';
import { RunTag, useRunMark } from '../RunTag';
import styles from './Panel.module.css';

export function ErrorCardRow({
  index,
  name,
  title,
  count,
  max,
  delta,
}: {
  index: number;
  name: string;
  title: string;
  count: number;
  /** The card's largest count: the bar's full width. */
  max: number;
  /** null for the baseline row. */
  delta: number | null;
}) {
  const mark = useRunMark(index);
  return (
    <li className={styles.errorRun} data-testid="error-run" {...mark}>
      <RunTag index={index} name={name} title={title} compact bare />
      <span className={styles.errorNum}>{count}</span>
      <span className={styles.errorBar} aria-hidden="true">
        <span style={{ inlineSize: `${max > 0 ? Math.round((count / max) * 100) : 0}%` }} />
      </span>
      {delta === null ? (
        <Text variant="sm" tone="muted">
          Baseline
        </Text>
      ) : delta === 0 ? (
        <Text variant="sm" tone="muted">
          =
        </Text>
      ) : (
        <Tag kind="data" tone={delta < 0 ? 'success' : 'danger'}>
          {delta < 0 ? '▼' : '▲'} {delta > 0 ? '+' : '−'}
          {Math.abs(delta)}
        </Tag>
      )}
    </li>
  );
}
