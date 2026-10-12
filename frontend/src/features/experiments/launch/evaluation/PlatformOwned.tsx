import { Tag } from '@/ui';
import { useLaunch } from '../LaunchContext';
import { platformOwnedList } from '../model';
import styles from './evaluation.module.css';

/** What the platform sets itself; these cannot be edited. */
export function PlatformOwned() {
  const { ctx } = useLaunch();
  const owned = platformOwnedList(ctx.evaluatorPanel);
  const groups: Array<[string, string[]]> = [
    ['Config keys', owned.config],
    ['Evaluator keys', owned.evaluator],
    ['Run metadata keys', owned.metadata],
  ];
  return (
    <section className={styles.panel} aria-label="Set by the platform">
      <h4 className={styles.panelTitle}>Set by the platform</h4>
      <p className={styles.hint}>These are filled in at launch and ignored if they appear in the inputs above.</p>
      <dl className={styles.platform}>
        {groups.map(([title, keys]) => (
          <div key={title} style={{ display: 'contents' }}>
            <dt>{title}</dt>
            <dd>
              <ul className={styles.list}>
                {keys.map((k) => (
                  <li key={k}>
                    <Tag kind="data">{k}</Tag>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
