/** The five group statistics (Pass@k, Pass^k, Avg@k, Consistency, Reliability) as label + value pairs in the strip. */
import type { GroupMetrics } from '@/api/dashboardTypes';
import { ScoreValue } from '@/ui';
import styles from './PassStats.module.css';

type Group = NonNullable<GroupMetrics['group']>;

export function statDefinitions(k: number | string): Array<{ label: string; help: string }> {
  return [
    { label: `Pass@${k}`, help: 'Share of items solved by at least one of the k passes at the threshold.' },
    { label: `Pass^${k}`, help: 'Share of items solved by every pass.' },
    { label: `Avg@${k}`, help: `Mean score across all items and all ${k} passes.` },
    { label: 'Consistency', help: 'Agreement between passes on the same item.' },
    { label: 'Reliability', help: 'Pass^k over Pass@k: how much of the ceiling is reached every time.' },
  ];
}

export function statValues(g: Group | null | undefined): Array<number | null | undefined> {
  return [g?.pass_at_k, g?.pass_hat_k, g?.avg_at_k, g?.consistency, g?.reliability];
}

export function PassStats({
  group,
  k,
  dir,
  busy,
}: {
  group: Group | null | undefined;
  k: number | string;
  dir: 'maximize' | 'minimize' | null;
  /** Group metrics are reloading: the previous values stay, dimmed. */
  busy: boolean;
}) {
  const values = statValues(group);
  return (
    <dl className={styles.stats} aria-busy={busy} data-busy={busy ? '' : undefined}>
      {statDefinitions(k).map((d, i) => (
        <div key={d.label} className={styles.stat} title={d.help}>
          <dt>{d.label}</dt>
          <dd>
            <ScoreValue value={values[i]} direction={dir ?? 'maximize'} digits={1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
