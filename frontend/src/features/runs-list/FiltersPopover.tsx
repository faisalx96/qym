/**
 * The Filters popover (variant A + C's facet lists): Time and Origin segmented
 * controls, then one disclosure per facet with checkbox lists and an "Only"
 * action (UX_DECISION: inline lists, not nested portalled selects, which closed
 * the popover). One disclosure is open at a time so the Tab order stays short.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { Facets } from '@/api/dashboardTypes';
import { Button, Checkbox, Dialog, Icon, Popover, SearchField, SegmentedControl, Text, TextField } from '@/ui';
import { parseLocalDate, type QuickRange } from '@/lib/runs-order';
import { countActiveFilters, customRangeLabel, DEFAULT_VIEW, EMPTY, modelOptionLabel, NONE, statusLabel, versioningKeyWords, type OriginFilter, type RunsView } from './urlState';
import type { ViewPatch } from './useRunsView';
import styles from './FiltersPopover.module.css';

type ListKey = 'tasks' | 'datasets' | 'models' | 'versions' | 'statuses' | 'owners';

interface FacetDef {
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

export function buildFacetDefs(view: RunsView, facets: Facets | undefined, owners: Record<string, string>): FacetDef[] {
  const f = facets;
  const opt = (values: string[] | undefined, label: (v: string) => string, selected: string[]) => {
    const all = [...(values ?? [])];
    for (const s of selected) if (s !== NONE && !all.includes(s)) all.push(s);
    return all.filter((v) => v !== NONE).map((v) => ({ value: v, label: v === EMPTY ? 'Empty / Missing' : label(v) }));
  };
  const list = (key: ListKey, label: string, values: string[] | undefined, lab: (v: string) => string): FacetDef => ({
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
    list('statuses', 'Status', f?.statuses, statusLabel),
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

export function FiltersPopover({ view, facets, owners, onChange }: FiltersPopoverProps) {
  const count = countActiveFilters(view) - (view.q ? 1 : 0);
  const defs = useMemo(() => buildFacetDefs(view, facets, owners), [view, facets, owners]);
  const [open, setOpen] = useState<string | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  return (
    <>
      <Popover
        label="Filters"
        placement="bottom start"
        trigger={
          <Button variant={count ? 'accent' : 'neutral'} icon={<Icon name="list" size={12} />} iconEnd={<Icon name="chevron-down" size={12} />} data-testid="filters-trigger">
            Filters{count ? ` · ${count}` : ''}
          </Button>
        }
      >
        {({ close }) => (
          <div className={styles.panel} data-testid="filters-panel">
            <div className={styles.row}>
              <Text variant="sm" tone="muted" as="span" className={styles.rowLabel}>
                Time
              </Text>
              <SegmentedControl<QuickRange>
                label="Time range"
                value={view.range}
                onChange={(range) => (range === 'custom' ? setRangeOpen(true) : onChange({ range, from: '', to: '' }))}
                options={[
                  { value: 'all', label: 'All', title: 'Shortcut 1' },
                  { value: 'today', label: 'Today', title: 'Shortcut 2' },
                  { value: 'week', label: '7d', title: 'Shortcut 3' },
                  { value: 'month', label: '30d', title: 'Shortcut 4' },
                  { value: 'custom', label: view.range === 'custom' ? customRangeLabel(view.from, view.to) : 'Range…' },
                ]}
              />
            </div>
            <div className={styles.row}>
              <Text variant="sm" tone="muted" as="span" className={styles.rowLabel}>
                Origin
              </Text>
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
            <div className={styles.foot}>
              <Button variant="ghost" onPress={() => onChange({ ...DEFAULT_VIEW, versioning: {}, q: view.q, sort: view.sort })} isDisabled={!count}>
                Clear all
              </Button>
              <Button variant="primary" onPress={close}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Popover>
      <CustomRangeDialog
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        from={view.from}
        to={view.to}
        onApply={(from, to) => onChange({ range: 'custom', from, to })}
      />
    </>
  );
}

function FacetSection({ def, open, onToggle, onChange }: { def: FacetDef; open: boolean; onToggle: () => void; onChange: (values: string[]) => void }) {
  const panelId = useId();
  const [query, setQuery] = useState('');
  const selected = new Set(def.selected);
  const q = query.trim().toLowerCase();
  const options = q ? def.options.filter((o) => o.label.toLowerCase().includes(q)) : def.options;
  const toggle = (value: string) => {
    const next = new Set(selected);
    next.delete(NONE);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  };
  return (
    <section className={styles.facet} data-open={open ? '' : undefined} aria-label={def.label}>
      <AriaButton className={styles.facetHead} onPress={onToggle} aria-expanded={open} aria-controls={panelId}>
        <span className={styles.facetName}>{def.label}</span>
        <span className={styles.facetSummary} data-active={def.selected.length ? '' : undefined}>
          {summary(def)}
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </AriaButton>
      {open ? (
        <div id={panelId} className={styles.facetBody}>
          {def.options.length > 8 ? <SearchField label={`Search ${def.label}`} hideLabel placeholder={`Search ${def.label.toLowerCase()}`} value={query} onChange={setQuery} width="100%" /> : null}
          <div className={styles.facetActions}>
            <Button variant="ghost" onPress={() => onChange(def.options.map((o) => o.value))}>
              Select all
            </Button>
            <Button variant="ghost" onPress={() => onChange([])} isDisabled={!def.selected.length}>
              Clear
            </Button>
            <Button variant="ghost" onPress={() => onChange([NONE])}>
              None
            </Button>
          </div>
          <ul className={styles.options} aria-label={`${def.label} values`}>
            {options.map((o) => (
              <li key={o.value} className={styles.option}>
                <Checkbox isSelected={selected.has(o.value)} onChange={() => toggle(o.value)}>
                  {o.label}
                </Checkbox>
                <AriaButton className={styles.only} onPress={() => onChange([o.value])} aria-label={`Only ${o.label}`}>
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

export function CustomRangeDialog({ open, onOpenChange, from, to, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; from: string; to: string; onApply: (from: string, to: string) => void }) {
  return <RangeBody key={open ? 'open' : 'closed'} open={open} onOpenChange={onOpenChange} from={from} to={to} onApply={onApply} />;
}

function RangeBody({ open, onOpenChange, from, to, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; from: string; to: string; onApply: (from: string, to: string) => void }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [error, setError] = useState('');
  function apply() {
    const da = parseLocalDate(a);
    const db = parseLocalDate(b);
    if (!da && !db) return setError('Choose a start date, an end date or both.');
    if (da && db && da > db) return setError('The start date must be on or before the end date.');
    onApply(da ? a : '', db ? b : '');
    onOpenChange(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Custom date range"
      description="Local days; either side may stay open."
      size="sm"
      footer={
        <>
          <Button variant="neutral" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.rangeFields}>
        <TextField label="From" type="date" value={a} onChange={setA} />
        <TextField label="To" type="date" value={b} onChange={setB} />
      </div>
      {error ? (
        <Text variant="base" tone="danger" as="p" role="alert">
          {error}
        </Text>
      ) : null}
    </Dialog>
  );
}

