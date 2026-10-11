/** The one filter surface: search · analysis metric · threshold · show · rules · sort · Display, with chips (UX_DECISION). */
import { useMemo, useState } from 'react';
import { useSyncedInput } from '../../hooks/useSynced';
import {
  Button,
  Chip,
  Icon,
  MultiSelect,
  SearchField,
  SegmentedControl,
  Select,
  Slider,
  Popover,
  Text,
} from '@/ui';
import { setTextMode, type TextMode } from '@/lib/text';
import { metricHasPassThreshold } from '../../lib/runModel';
import { activeChips } from '../../lib/activeChips';
import {
  countActiveFilters,
  SORT_VALUES,
  type FilterGroup,
  type ItemShow,
  type SortBy,
} from '../../lib/filterRules';
import { useRunPage } from '../../RunContext';
import { RuleBuilder } from './RuleBuilder';
import styles from './FilterBar.module.css';

const SORT_LABELS: Record<SortBy, string> = {
  index: 'Index',
  score_asc: 'Score ↑',
  score_desc: 'Score ↓',
  latency_asc: 'Latency ↑',
  latency_desc: 'Latency ↓',
};

const SHOW_OPTIONS: Array<{ value: ItemShow; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'passed', label: 'Pass' },
  { value: 'failed', label: 'Fail' },
  { value: 'errors', label: 'Errors' },
];

export interface DisplayState {
  textMode: TextMode;
  onTextMode: (m: TextMode) => void;
}

export function FilterBar({ display }: { display: DisplayState }) {
  const { api, model, items, payload } = useRunPage();
  const { view, defs, selectedMetric } = api;
  const [rulesOpen, setRulesOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [query, setQuery] = useSyncedInput(view.q, (q) => api.setView({ q }), 250);
  const metric = selectedMetric;
  const hasThreshold = metricHasPassThreshold(model, metric);
  const threshold = metric
    ? Math.round((view.threshold ?? model.defaultThresholds[metric] ?? 0.8) * 100)
    : 80;
  const [thr, setThr] = useState(threshold);
  const [seenThr, setSeenThr] = useState(threshold);
  if (seenThr !== threshold) {
    setSeenThr(threshold);
    setThr(threshold);
  }
  const chips = useMemo(() => activeChips(view, defs, metric), [view, defs, metric]);
  const filterCount = countActiveFilters(view, defs);
  const showOptions = SHOW_OPTIONS.some((o) => o.value === view.show)
    ? SHOW_OPTIONS
    : [...SHOW_OPTIONS, { value: view.show, label: view.show.replace(/_/g, ' ') }];

  const metricItems = model.metricNames.map((n) => ({ key: n, label: n }));
  const hideFieldItems = model.allMetadataKeys.map((k) => ({ key: k, label: k }));
  const hideMetricItems = model.allMetricMetaKeys.map((k) => ({ key: k, label: k }));
  const visibleFields = new Set<string | number>(
    model.allMetadataKeys.filter((k) => !view.hideFields.includes(k)),
  );
  const visibleMetricFields = new Set<string | number>(
    model.allMetricMetaKeys.filter((k) => !view.hideMetricFields.includes(k)),
  );

  return (
    <div className={styles.bar} role="search" aria-label="Filter items">
      <div className={styles.row}>
        <SearchField
          label="Search inputs and outputs"
          hideLabel
          placeholder="Search inputs / outputs…"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          width="22ch"
        />
        {metricItems.length > 1 ? (
          <Select
            label="Analysis metric"
            items={metricItems}
            value={metric}
            onChange={(k) =>
              k &&
              api.setView({ metric: String(k) === model.defaultMetric ? null : String(k), threshold: null })
            }
            width="16ch"
          />
        ) : null}
        {hasThreshold ? (
          <Slider
            label="Pass if score"
            unit="%"
            minValue={0}
            maxValue={100}
            step={5}
            value={thr}
            onChange={(v) => setThr(v as number)}
            onChangeEnd={(v) => api.setView({ threshold: (v as number) / 100 })}
            width="140px"
          />
        ) : null}
        <SegmentedControl
          label="Show items"
          options={showOptions}
          value={view.show}
          onChange={(show) => api.setView({ show })}
        />
        <Popover
          label="Filter rules"
          placement="bottom start"
          isOpen={rulesOpen}
          onOpenChange={(o) => {
            setRulesOpen(o);
            if (!o) setDraft(null);
          }}
          trigger={
            <Button
              size="sm"
              variant="neutral"
              icon={<Icon name="list" size={12} />}
              data-testid="open-filters"
            >
              Filters{filterCount ? ` (${filterCount})` : ''}
            </Button>
          }
        >
          <RuleBuilder
            rules={draft ?? view.filters.rules}
            defs={defs}
            onChange={(rules: FilterGroup) => {
              setDraft(rules);
              api.setFilters({ rules });
            }}
          />
        </Popover>
        <Select
          label="Sort"
          items={SORT_VALUES.reduce(
            (acc, v) => [...acc, { key: v, label: SORT_LABELS[v] }],
            [{ key: 'index', label: SORT_LABELS.index }],
          )}
          value={view.sort}
          onChange={(k) => k && api.setView({ sort: String(k) as SortBy })}
          width="12ch"
        />
        <Popover
          label="Display"
          placement="bottom end"
          isOpen={displayOpen}
          onOpenChange={setDisplayOpen}
          trigger={
            <Button size="sm" variant="neutral" icon={<Icon name="settings" size={12} />}>
              Display
            </Button>
          }
        >
          <div className={styles.display}>
            {model.samples > 1 ? (
              <SegmentedControl
                label="Layout"
                options={[
                  { value: 'cards', label: 'Cards' },
                  { value: 'heatmap', label: 'Heatmap' },
                ]}
                value={view.view}
                onChange={(v) => api.setView({ view: v })}
              />
            ) : null}
            <SegmentedControl
              label="Text"
              options={[
                { value: 'raw', label: 'Raw' },
                { value: 'rendered', label: 'Rendered' },
              ]}
              value={display.textMode}
              onChange={(m) => {
                setTextMode(m);
                display.onTextMode(m);
              }}
            />
            {hideFieldItems.length ? (
              <MultiSelect
                label="Item fields"
                items={hideFieldItems}
                value={visibleFields}
                searchable
                selectAll
                onChange={(keys) =>
                  api.setView({ hideFields: model.allMetadataKeys.filter((k) => !keys.has(k)) })
                }
              />
            ) : null}
            {hideMetricItems.length ? (
              <MultiSelect
                label="Metric fields"
                items={hideMetricItems}
                value={visibleMetricFields}
                searchable
                selectAll
                onChange={(keys) =>
                  api.setView({ hideMetricFields: model.allMetricMetaKeys.filter((k) => !keys.has(k)) })
                }
              />
            ) : null}
          </div>
        </Popover>
      </div>
      <div className={styles.chips}>
        <Text variant="sm" tone="muted" aria-live="polite" data-testid="items-count">
          {items.length.toLocaleString('en-US')} of {payload.snapshot.rows.length.toLocaleString('en-US')}{' '}
          items
        </Text>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            isSelected
            removeLabel={`Remove filter ${chip.label}`}
            onRemove={() => api.replaceView(chip.clear(view))}
          >
            {chip.label}
          </Chip>
        ))}
        {filterCount > 0 ? (
          <Button size="sm" variant="ghost" onPress={() => api.clearFilters()} data-testid="clear-filters">
            Clear ({filterCount})
          </Button>
        ) : null}
      </div>
    </div>
  );
}
