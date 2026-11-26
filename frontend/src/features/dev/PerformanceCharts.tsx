/**
 * Performance mocks: the charts now live with the real pages (`features/performance/components/shared`) and are
 * passed on from here, so the mocks and the pages draw with the same code. `LogLines` is the plain stand-in of
 * the log viewer for a static mock.
 */
import type { PerformanceLogLine } from '@/api/performance';
import { formatTime } from '@/lib/dates';
import styles from './PerformanceMocks.module.css';

export {
  ErrorBars,
  LineChart,
  PlotCard,
  Stepladder,
  type LineSeries,
} from '@/features/performance/components/shared';
export { OUTCOME_TONE, levelOutcomes, type LevelOutcome } from '@/features/performance/lib/status';

/** The log as lines of time, level and text. The page builds the real viewer (windowed, follows the tail). */
export function LogLines({ lines }: { lines: PerformanceLogLine[] }) {
  return (
    // A scrolling region must take keyboard focus so it can be scrolled with the keys.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className={styles.log} role="log" aria-label="Log lines" tabIndex={0} data-performance-block="log">
      {lines.map((line) => (
        <div key={line.seq} className={styles.logLine} data-level={line.level}>
          <span>{`${formatTime(line.at)}:${line.at.slice(17, 19)}`}</span>
          <span>{line.level}</span>
          <span>{line.message}</span>
        </div>
      ))}
    </div>
  );
}
