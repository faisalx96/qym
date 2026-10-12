/** Run chips (baseline star, remove), the cohort banner with inline-editable labels, and the metric / pass controls. */
import { useState } from 'react';
import {
  Button,
  Chip,
  IconButton,
  RunStatusBadge,
  Select,
  SegmentedControl,
  Tag,
  Text,
  TextField,
} from '@/ui';
import { useCompare, letterOf } from '../CompareContext';
import { MIN_COMPARE_RUNS } from '../lib/refs';
import { RunDot } from './common';
import styles from './SelectionBar.module.css';

export function RunChips() {
  const { model, c, baseline, columns } = useCompare();
  const bases = model.bases;
  const removable = bases.length > MIN_COMPARE_RUNS;
  // "Each pass" lists every pass as its own candidate baseline; otherwise one chip per run.
  const each = c.view.columns === 'each' && columns.some((col) => col.pass);
  const entries = each
    ? columns.map((col) => ({
        key: col.key,
        base: col.base,
        idx: col.runIdxs[0] ?? 0,
        label: col.label,
        isBase: baseline.key === col.key,
      }))
    : bases.map((base) => {
        const idx = model.runs.findIndex((r) => r.base === base);
        const run = model.runs[idx];
        return {
          key: base,
          base,
          idx,
          label: (run?.label ?? base).replace(/ · pass \d+$/, ''),
          isBase: baseline.base === base,
        };
      });
  return (
    <div className={styles.chips} role="group" aria-label="Runs in this comparison">
      {entries.map(({ key, base, idx, label, isBase }) => {
        const run = model.runs[idx];
        if (!run) return null;
        const status = String(run.run.status).toUpperCase();
        // Anything but a finished run is flagged on its chip: its numbers may be partial.
        const unfinished = !['COMPLETED', 'APPROVED', 'SUBMITTED'].includes(status);
        return (
          <Chip
            key={key}
            isSelected={isBase}
            onChange={() => c.setView({ baseline: key })}
            aria-label={`${letterOf(idx)} ${label}${unfinished ? `, ${status.toLowerCase()}` : ''}${isBase ? ', baseline' : ', set as baseline'}`}
            removeLabel={`Remove ${label} from the comparison`}
            onRemove={removable ? () => c.removeRun(base) : undefined}
          >
            <RunDot index={idx} />
            <span className={styles.letter}>{letterOf(idx)}</span> {label}
            {isBase ? <span className={styles.baseMark}> {'★'} Baseline</span> : null}
            {unfinished ? (
              <>
                {' '}
                <RunStatusBadge status={status} label={status} />
              </>
            ) : null}
          </Chip>
        );
      })}
    </div>
  );
}

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
    <span className={styles.side}>
      <Tag kind="role">{tag}</Tag>
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
          <Text variant="md" weight={600} tone="primary">
            {label}
          </Text>
          <IconButton label={`Rename cohort ${tag}`} icon="edit" onPress={() => setEditing(true)} />
        </>
      )}
      <Text variant="sm" tone="muted">
        {count} execution{count === 1 ? '' : 's'}
      </Text>
    </span>
  );
}

export function CohortBanner() {
  const { cohorts } = useCompare();
  if (!cohorts) return null;
  return (
    <div className={styles.cohort} role="group" aria-label="Compare sides">
      <Text variant="sm" tone="muted" weight={650}>
        Compare sides
      </Text>
      <CohortSide side="left" />
      <Text variant="sm" tone="muted">
        vs
      </Text>
      <CohortSide side="right" />
      <Tag kind="count">k = {cohorts.k} executions each</Tag>
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

export function MetricSelect() {
  const { model, metric, c } = useCompare();
  if (model.metrics.length < 2) return null;
  return (
    <Select
      label="Metric"
      hideLabel
      value={metric}
      onChange={(k) => k && c.setView({ metric: String(k), filters: { ...c.view.filters, baseline: null } })}
      items={model.metrics.map((m) => ({ key: m, label: m }))}
      searchable="auto"
      width={170}
    />
  );
}

export function SelectionBar() {
  const { cohorts, c, model } = useCompare();
  // The baseline is a per-run concept: Sweep compares two cohorts, so no baseline to reset there.
  const sweep = !!cohorts && c.view.tab === 'sweep';
  const hasPasses = model.runs.some((r) => r.pass);
  const showReset = !sweep;
  return (
    <div className={styles.bar}>
      {cohorts ? <CohortBanner /> : <RunChips />}
      {hasPasses || showReset ? (
        <div className={styles.tools}>
          <PassToggle />
          {showReset ? (
            <Button
              size="sm"
              variant="ghost"
              isDisabled={!c.view.baseline && !Object.keys(c.view.thresholds).length}
              onPress={() => c.setView({ baseline: null, thresholds: {} })}
            >
              Reset baseline
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
