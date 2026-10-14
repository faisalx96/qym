/** The group-metrics band: five tiles (Pass@k, Pass^k, Avg@k, Consistency, Reliability), value plus a thin score bar. */
import type { GroupMetrics } from '@/api/dashboardTypes';
import { ScoreValue, StatStrip, type StatStripItem } from '@/ui';
import { metricBand } from '@/lib/metrics';
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

export function statItems(
  g: Group | null | undefined,
  k: number | string,
  dir: 'maximize' | 'minimize' | null,
): StatStripItem[] {
  const values = [g?.pass_at_k, g?.pass_hat_k, g?.avg_at_k, g?.consistency, g?.reliability];
  return statDefinitions(k).map((d, i) => {
    const v = values[i];
    const band = metricBand(v, undefined, dir);
    return {
      key: d.label,
      label: <span title={d.help}>{d.label}</span>,
      value: <ScoreValue value={v} direction={dir ?? 'maximize'} digits={1} />,
      bar: v == null ? 0 : v,
      barBand: band ?? undefined,
    };
  });
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
  return (
    <div className={styles.band} aria-busy={busy} data-busy={busy ? '' : undefined}>
      <StatStrip variant="compact" aria-label="Group metrics" items={statItems(group, k, dir)} />
    </div>
  );
}
