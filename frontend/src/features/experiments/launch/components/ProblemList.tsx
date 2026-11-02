import type { ValidationItem } from '../model';
import { useLaunch } from '../LaunchContext';
import styles from './launch.module.css';

/**
 * Review items as buttons: the human label first, the message, the pointer as secondary mono
 * text. Clicking opens the section / group and focuses the field (`focusIssue`).
 */
export function ProblemList({
  items,
  label = 'Problems',
}: {
  items: readonly ValidationItem[];
  label?: string;
}) {
  const { focusIssue } = useLaunch();
  if (!items.length) return null;
  return (
    <ul className={styles.problems} aria-label={label}>
      {items.map((item, i) => (
        <li key={`${item.pointer}|${item.message}|${item.environmentId ?? ''}|${i}`}>
          <button type="button" className={styles.problem} onClick={() => focusIssue(item)}>
            <span className={styles.problemLabel}>{item.label}</span>
            <span>{item.message}</span>
            {item.where.length ? <span className={styles.problemMeta}>{item.where.join(' · ')}</span> : null}
            {item.pointer && !item.pointer.startsWith('#') ? (
              <span className={styles.problemPointer} dir="ltr">
                {item.pointer}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
