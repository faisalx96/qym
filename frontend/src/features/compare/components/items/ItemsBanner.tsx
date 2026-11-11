/** A filter that came from a click upstream (count button, winner / distribution segment, category or error card) says so here (C-items-2). */
import type { ReactNode } from 'react';
import { useCompare } from '../../CompareContext';
import { activeChips } from '../../lib/activeChips';
import { columnName } from '../../lib/columnName';
import styles from './ItemsBanner.module.css';

const UPSTREAM = (key: string) =>
  key === 'baseline' ||
  key === 'winner' ||
  key === 'pass_rate' ||
  key.startsWith('err:') ||
  key.startsWith('cat:');

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
  return (
    <div
      className={styles.banner}
      role="status"
      data-part="baseline-delta-banner"
      data-testid="baseline-delta-banner"
    >
      <span>{sentence}</span>
      {/* K6 (C154): one Clear, in the sticky nav */}
    </div>
  );
}
