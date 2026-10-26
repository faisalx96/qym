/** The cohort banner with inline-editable labels, and the metric / baseline / pass controls. */
import { useState } from 'react';
import { IconButton, Select, SegmentedControl, Tag, TextField } from '@/ui';
import { useCompare, letterOf } from '../CompareContext';
import { columnName } from '../lib/columnName';
import styles from './SelectionBar.module.css';

function CohortSide({ side }: { side: 'left' | 'right' }) {
  const { cohorts, c } = useCompare();
  const [editing, setEditing] = useState(false);
  if (!cohorts) return null;
  const label = side === 'left' ? cohorts.leftLabel : cohorts.rightLabel;
  const tag = side === 'left' ? 'A' : 'B';
  const count = (side === 'left' ? cohorts.left : cohorts.right).length;
  const commit = (value: string) => {
    setEditing(false);
    if (value.trim() !== label)
      c.setCohortLabels(side === 'left' ? { leftLabel: value.trim() } : { rightLabel: value.trim() });
  };
  return (
    <div className={styles.side} data-part="cohort-side">
      <Tag kind="role">
        {tag} / {side}
      </Tag>
      {editing ? (
        <TextField
          label={`Label for cohort ${tag}`}
          hideLabel
          autoFocus
          defaultValue={label}
          width="18ch"
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <>
          <b className={styles.sideName}>{label}</b>
          <IconButton label={`Rename cohort ${tag}`} icon="edit" onPress={() => setEditing(true)} />
        </>
      )}
      <span className={styles.sideCount}>
        {count} run{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export function CohortBanner() {
  const { cohorts } = useCompare();
  if (!cohorts) return null;
  return (
    <div className={styles.cohort} role="group" aria-label="Compare sides" data-part="cohort-banner">
      <span className={styles.cohortLabel}>Compare sides</span>
      <div className={styles.sidesRow}>
        <CohortSide side="left" />
        <CohortSide side="right" />
      </div>
    </div>
  );
}

export function PassToggle() {
  const { model, c } = useCompare();
  if (!model.runs.some((r) => r.pass)) return null;
  return (
    <SegmentedControl<'run' | 'each'>
      label="Repeat run columns"
      value={c.view.columns}
      onChange={(v) => c.setView({ columns: v })}
      options={[
        { value: 'run', label: 'Run average' },
        { value: 'each', label: 'Each pass' },
      ]}
    />
  );
}

/** The analysis metric: segmented tabs up to four metrics, a select beyond (round 8, C-ov-1). */
export function MetricTabs() {
  const { model, metric, c } = useCompare();
  if (model.metrics.length < 2) return null;
  const set = (k: string) => c.setView({ metric: k, filters: { ...c.view.filters, baseline: null } });
  if (model.metrics.length > 4)
    return (
      <Select
        label="Metric"
        hideLabel
        value={metric}
        onChange={(k) => k && set(String(k))}
        items={model.metrics.map((m) => ({ key: m, label: m }))}
        searchable="auto"
        width={170}
      />
    );
  return (
    <SegmentedControl<string>
      label="Overview metric"
      value={metric}
      onChange={set}
      options={model.metrics.map((m) => ({ value: m, label: m }))}
    />
  );
}

const RESET_KEY = '__reset-baseline__';

/** Which column every change is measured against; also resets thresholds. Lives in the Averages head (C-avg-1). */
export function BaselineSelect() {
  const { columns, baseline, model, c } = useCompare();
  if (columns.length < 2) return null;
  const dirty = !!c.view.baseline || Object.keys(c.view.thresholds).length > 0;
  const items = [
    ...columns.map((col) => {
      const idx = col.runIdxs[0] ?? 0;
      const name = columnName(model, col);
      return { key: col.key, label: `${letterOf(idx)}  ${name}` };
    }),
    ...(dirty ? [{ key: RESET_KEY, label: 'Reset baseline and thresholds' }] : []),
  ];
  return (
    <span className={styles.inlineLabel} data-part="baseline-control">
      <span aria-hidden="true">Baseline</span>
      <Select
        label="Baseline"
        hideLabel
        value={baseline.key}
        onChange={(k) => {
          if (k === null) return;
          if (k === RESET_KEY) c.setView({ baseline: null, thresholds: {} });
          else c.setView({ baseline: String(k) });
        }}
        items={items}
        searchable="auto"
        width="14rem"
      />
    </span>
  );
}
