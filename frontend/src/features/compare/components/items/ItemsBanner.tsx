/** A filter that came from a click upstream (count button, winner / distribution segment, category or error card) says so here (C-items-2). */
import type { ReactNode } from 'react';
import { Button, Icon } from '@/ui';
import { useCompare } from '../../CompareContext';
import { activeChips } from '../../lib/activeChips';
import { columnName } from '../../lib/columnName';
import type { CompareView } from '../../lib/filters';
import styles from './ItemsBanner.module.css';

const UPSTREAM = (key: string) =>
  key === 'baseline' || key === 'winner' || key === 'pass_rate' || key.startsWith('err:') || key.startsWith('cat:');

export function ItemsBanner() {
  const { c, model, columns, baseline } = useCompare();
  const label = (key: string) => {
    const col = columns.find((x) => x.key === key);
    return col ? columnName(model, col) : key;
  };
  const chips = activeChips(c.view, model, label).filter((chip) => UPSTREAM(chip.key));
  if (!chips.length) return null;
  const f = c.view.filters.baseline;
  const only = chips.length === 1 && f && chips[0]!.key === 'baseline' ? f : null;
  const sentence: ReactNode = only ? (
    <>
      Showing items where <b>{label(only.columnKey)}</b>{' '}
      {only.kind === 'improved' ? 'improved' : only.kind === 'regressed' ? 'regressed' : 'did not change'} on{' '}
      <b>{only.metric}</b> against the baseline <b>{columnName(model, baseline)}</b>.
    </>
  ) : (
    <>
      Showing items filtered by{' '}
      {chips.map((chip, i) => (
        <span key={chip.key}>
          {i ? ', ' : ''}
          <b>{chip.label}</b>
        </span>
      ))}
      .
    </>
  );
  const clear = () => {
    let view: CompareView = c.view;
    let patch: Partial<CompareView> = {};
    for (const chip of chips) {
      const next = chip.clear(view);
      patch = { ...patch, ...next };
      view = { ...view, ...next };
    }
    c.setView(patch);
  };
  return (
    <div className={styles.banner} role="status" data-part="baseline-delta-banner" data-testid="baseline-delta-banner">
      <span>{sentence}</span>
      <Button size="sm" variant="ghost" icon={<Icon name="close" size={12} />} onPress={clear}>
        Clear
      </Button>
    </div>
  );
}
