/** One run's row in an error card: identity, count, change against the baseline. Every run is listed, zeros included. */
import { RunTag, useRunMark } from '../RunTag';
import styles from './Errors.module.css';

export function ErrorCardRow({
  index,
  name,
  title,
  count,
  delta,
}: {
  index: number;
  name: string;
  title: string;
  count: number;
  /** null for the baseline row. */
  delta: number | null;
}) {
  const mark = useRunMark(index);
  const tone = delta === null ? 'base' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return (
    <tr className={styles.run} data-testid="error-run" data-part="error-run" {...mark}>
      <td>
        <RunTag index={index} name={name} title={title} bare />
      </td>
      <td className={styles.num}>{count}</td>
      <td className={styles.change} data-tone={tone}>
        {delta === null ? 'Baseline' : delta === 0 ? '=' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`}
      </td>
    </tr>
  );
}
