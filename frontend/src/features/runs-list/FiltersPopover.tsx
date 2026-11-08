/**
 * The Filters popover (variant A + C's facet lists): Time and Origin segmented
 * controls, then one disclosure per facet with checkbox lists and an "Only"
 * action (UX_DECISION: inline lists, not nested portalled selects, which closed
 * the popover). One disclosure is open at a time so the Tab order stays short.
 */
import { lazy, Suspense, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { Facets } from '@/api/dashboardTypes';
import {
  Button,
  Checkbox,
  Icon,
  IconButton,
  Popover,
  SearchField,
  SegmentedControl,
  Text,
  Skeleton,
} from '@/ui';
import { parseLocalDate, type QuickRange } from '@/lib/runs-order';

// C080: the date and time fields (react-aria date pickers and their calendar) load when the custom range opens, not with
// every page.
const DateTimeField = lazy(() => import('@/ui/DateTimeField').then((m) => ({ default: m.DateTimeField })));
import {
  countActiveFilters,
  DEFAULT_VIEW,
  EMPTY,
  modelOptionLabel,
  NONE,
  statusLabel,
  versioningKeyWords,
  type OriginFilter,
  type RunsView,
} from './urlState';
import type { ViewPatch } from './useRunsView';
import styles from './FiltersPopover.module.css';

type ListKey = 'tasks' | 'datasets' | 'models' | 'versions' | 'statuses' | 'owners';

export interface FacetDef {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  set: (values: string[]) => ViewPatch;
}

const SEP = '␟';
export const datasetLabel = (v: string) => {
  const [name, version] = v.split(SEP);
  return version ? `${name} (${version})` : (name ?? v);
};

function withSubmitted(statuses: string[] | undefined): string[] | undefined {
  if (!statuses || statuses.includes('SUBMITTED')) return statuses;
  const at = statuses.indexOf('COMPLETED');
  return at < 0
    ? [...statuses, 'SUBMITTED']
    : [...statuses.slice(0, at + 1), 'SUBMITTED', ...statuses.slice(at + 1)];
}

export function buildFacetDefs(
  view: RunsView,
  facets: Facets | undefined,
  owners: Record<string, string>,
): FacetDef[] {
  const f = facets;
  const opt = (values: string[] | undefined, label: (v: string) => string, selected: string[]) => {
    const all = [...(values ?? [])];
    for (const s of selected) if (s !== NONE && !all.includes(s)) all.push(s);
    return all
      .filter((v) => v !== NONE)
      .map((v) => ({ value: v, label: v === EMPTY ? 'Empty / Missing' : label(v) }));
  };
  const list = (
    key: ListKey,
    label: string,
    values: string[] | undefined,
    lab: (v: string) => string,
  ): FacetDef => ({
    id: key,
    label,
    options: opt(values, lab, view[key]),
    selected: view[key],
    set: (next) => (v) => ({ ...v, [key]: next }),
  });
  const defs: FacetDef[] = [
    list('tasks', 'Tasks', f?.tasks, (v) => v),
    list('datasets', 'Datasets', f?.datasets, datasetLabel),
    list('models', 'Models', f?.models, modelOptionLabel),
    list('versions', 'Versions', f?.versions, (v) => v),
    // C034: 'Submitted' is always a Status value, so reviewers can find the runs that wait for them
    list('statuses', 'Status', withSubmitted(f?.statuses), statusLabel),
    list('owners', 'Users', f?.users, (v) => owners[v] ?? v),
  ];
  const keys = new Set([...Object.keys(f?.versioning ?? {}), ...Object.keys(view.versioning)]);
  for (const key of [...keys].sort()) {
    const selected = view.versioning[key] ?? [];
    defs.push({
      id: `v.${key}`,
      label: versioningKeyWords(key),
      options: opt(f?.versioning?.[key], (v) => v, selected),
      selected,
      set: (next) => (v) => ({ ...v, versioning: { ...v.versioning, [key]: next } }),
    });
  }
  return defs;
}

function summary(def: FacetDef): string {
  if (!def.selected.length) return 'All';
  if (def.selected.includes(NONE)) return 'None';
  const labels = def.selected.map((s) => def.options.find((o) => o.value === s)?.label ?? s);
  return labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`;
}

export interface FiltersPopoverProps {
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  trigger?: ReactNode;
}

/**
 * Time and Origin segmented controls. `Range` expands two date fields in place, next to the control (no dialog);
 * they stay open while a custom range is applied, so its dates can be changed, and fold when another range is picked.
 */
export function TimeOriginControls({
  view,
  onChange,
  labels = true,
  showOrigin = true,
}: {
  view: RunsView;
  onChange: (patch: ViewPatch) => void;
  labels?: boolean;
  /** C208: false hides Origin in a project with no official run. */
  showOrigin?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const open = editing || view.range === 'custom';
  return (
    <>
      <div className={styles.row} data-range-open={open ? '' : undefined}>
        {labels ? (
          <Text variant="sm" tone="muted" as="span" className={styles.rowLabel}>
            Time
          </Text>
        ) : null}
        <SegmentedControl<QuickRange>
          label="Time range"
          value={open ? 'custom' : view.range}
          onChange={(range) => {
            if (range === 'custom') return setEditing(true);
            setEditing(false);
            onChange({ range, from: '', to: '' });
          }}
          options={[
            { value: 'all', label: 'All', title: 'Shortcut 1' },
            { value: 'today', label: 'Today', title: 'Shortcut 2' },
            { value: 'week', label: '7d', title: 'Shortcut 3' },
            { value: 'month', label: '30d', title: 'Shortcut 4' },
            { value: 'custom', label: 'Range' },
          ]}
        />
        {open ? (
          <RangeFields
            key={`${view.from}|${view.to}`}
            from={view.from}
            to={view.to}
            applied={view.range === 'custom'}
            autoFocus={editing && view.range !== 'custom'}
            onApply={(from, to) => {
              setEditing(false);
              onChange({ range: 'custom', from, to });
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </div>
      {showOrigin ? (
        <div className={styles.row}>
          {labels ? (
            <Text variant="sm" tone="muted" as="span" className={styles.rowLabel}>
              Origin
            </Text>
          ) : null}
          <SegmentedControl<OriginFilter>
            label="Origin"
            value={view.origin}
            onChange={(origin) => onChange({ origin })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'official', label: 'Official' },
              { value: 'local', label: 'Local' },
            ]}
          />
        </div>
      ) : null}
    </>
  );
}

/** The full filter list (Time, Origin, one disclosure per facet, Clear all / Done): popover body and phone drawer. */
export function FiltersPanel({
  view,
  facets,
  owners,
  onChange,
  onDone,
  doneLabel = 'Done',
  className,
}: {
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  onDone: () => void;
  doneLabel?: string;
  className?: string;
}) {
  const count = countActiveFilters(view) - (view.q ? 1 : 0);
  const defs = useMemo(() => buildFacetDefs(view, facets, owners), [view, facets, owners]);
  const [open, setOpen] = useState<string | null>(null);
  const footRef = useRef<HTMLDivElement>(null);
  return (
    <div className={[styles.panel, className].filter(Boolean).join(' ')} data-testid="filters-panel">
      <TimeOriginControls
        view={view}
        onChange={onChange}
        showOrigin={view.origin !== 'all' || (facets?.origins ?? []).includes('official')}
      />
      <div className={styles.facets}>
        {defs.map((def) => (
          <FacetSection
            key={def.id}
            def={def}
            open={open === def.id}
            onToggle={() => setOpen(open === def.id ? null : def.id)}
            onChange={(values) => onChange(def.set(values))}
          />
        ))}
      </div>
      <div className={styles.foot} ref={footRef}>
        <Button
          variant="neutral"
          onPress={() => {
            onChange({ ...DEFAULT_VIEW, versioning: {}, q: view.q, sort: view.sort });
            // the button disables itself: keep focus inside the panel so Esc still closes it
            footRef.current?.querySelector<HTMLElement>('[data-filters-done]')?.focus();
          }}
          isDisabled={!count}
        >
          Clear all
        </Button>
        <Button variant="primary" onPress={onDone} data-filters-done="">
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}

export function FiltersPopover({ view, facets, owners, onChange }: FiltersPopoverProps) {
  const count = countActiveFilters(view) - (view.q ? 1 : 0);
  return (
    <>
      <Popover
        label="Filters"
        placement="bottom start"
        trigger={
          <Button
            variant={count ? 'accent' : 'neutral'}
            icon={<Icon name="list" size={12} />}
            iconEnd={<Icon name="chevron-down" size={12} />}
            data-testid="filters-trigger"
          >
            Filters{count ? ` · ${count}` : ''}
          </Button>
        }
      >
        {({ close }) => (
          <FiltersPanel view={view} facets={facets} owners={owners} onChange={onChange} onDone={close} />
        )}
      </Popover>
    </>
  );
}

function FacetSection({
  def,
  open,
  onToggle,
  onChange,
}: {
  def: FacetDef;
  open: boolean;
  onToggle: () => void;
  onChange: (values: string[]) => void;
}) {
  const panelId = useId();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const options = q ? def.options.filter((o) => o.label.toLowerCase().includes(q)) : def.options;
  // No filter ticks every box (as the bar's lists do); NONE ticks none.
  const none = def.selected.includes(NONE);
  const ticked = (value: string) => !none && (def.selected.length === 0 || def.selected.includes(value));
  const emit = (next: Set<string>) => {
    if (next.size === 0) return onChange([NONE]);
    if (def.options.every((o) => next.has(o.value))) return onChange([]);
    onChange([...next]);
  };
  const toggle = (value: string) => {
    const next = new Set(def.options.map((o) => o.value).filter(ticked));
    if (next.has(value)) next.delete(value);
    else next.add(value);
    emit(next);
  };
  return (
    <section className={styles.facet} data-open={open ? '' : undefined} aria-label={def.label}>
      <AriaButton
        className={styles.facetHead}
        onPress={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={styles.facetName}>{def.label}</span>
        <span className={styles.facetSummary} data-active={def.selected.length ? '' : undefined}>
          {summary(def)}
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </AriaButton>
      {open ? (
        <div id={panelId} className={styles.facetBody}>
          {def.options.length > 1 ? (
            <SearchField
              label={`Search ${def.label}`}
              hideLabel
              placeholder={`Search ${def.label.toLowerCase()}`}
              value={query}
              onChange={setQuery}
              width="100%"
            />
          ) : null}
          <div className={styles.facetActions}>
            <Button variant="neutral" onPress={() => onChange([])}>
              Select all
            </Button>
            <Button variant="neutral" onPress={() => onChange([NONE])}>
              None
            </Button>
          </div>
          <ul className={styles.options} aria-label={`${def.label} values`}>
            {options.map((o) => (
              <li key={o.value} className={styles.option}>
                <Checkbox isSelected={ticked(o.value)} onChange={() => toggle(o.value)}>
                  {o.label}
                </Checkbox>
                <AriaButton
                  className={styles.only}
                  onPress={() => emit(new Set([o.value]))}
                  aria-label={`Only ${o.label}`}
                >
                  Only
                </AriaButton>
              </li>
            ))}
            {!options.length ? (
              <li className={styles.noOptions}>
                <Text variant="sm" tone="muted" as="span">
                  No values
                </Text>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The custom range, in place: From and To (a local day and time each, round 10; either side may stay open), Apply, and
 * a red Cancel while unapplied. A day picked without a time covers the whole day (From 00:00, To 23:59).
 */
function RangeFields({
  from,
  to,
  applied,
  autoFocus,
  onApply,
  onCancel,
}: {
  from: string;
  to: string;
  applied: boolean;
  autoFocus: boolean;
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
}) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [error, setError] = useState('');
  function apply() {
    const da = parseLocalDate(a);
    const db = parseLocalDate(b);
    if (!da && !db) return setError('Choose a start, an end or both.');
    if (da && db && da > db) return setError('The start must be on or before the end.');
    setError('');
    onApply(da ? a : '', db ? b : '');
  }
  const changed = a !== from || b !== to;
  // Enter applies, Escape folds an unapplied range (on the date fields; buttons keep their own keys)
  const onKey = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape' && !applied) onCancel();
  };
  return (
    <div
      className={styles.rangeFields}
      role="group"
      aria-label="Custom date range"
      data-testid="custom-range"
    >
      <Suspense fallback={<Skeleton kind="value" width={320} label="Loading the date fields" />}>
        <DateTimeField label="From" value={a} onChange={setA} onKeyDown={onKey} autoFocus={autoFocus} />
        <span className={styles.rangeDash} aria-hidden="true">
          –
        </span>
        <DateTimeField label="To" value={b} onChange={setB} onKeyDown={onKey} dayTime="end" />
      </Suspense>
      {!applied || changed ? (
        <Button variant="accent" onPress={apply}>
          Apply
        </Button>
      ) : null}
      {!applied ? (
        <IconButton label="Cancel custom range" icon="close" tone="reject" onPress={onCancel} />
      ) : null}
      {error ? (
        <Text variant="sm" tone="danger" as="span" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
