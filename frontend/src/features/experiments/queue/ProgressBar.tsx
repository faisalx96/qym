/** Run progress bar (.exq-progress): determinate when `value` is 0..1, indeterminate when null. */
import styles from './ProgressBar.module.css';

export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      data-indeterminate={value === null ? '' : undefined}
    >
      <div className={styles.fill} style={value === null ? undefined : { width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
