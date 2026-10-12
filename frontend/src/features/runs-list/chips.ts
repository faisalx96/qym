/** One removable chip per active filter, in canonical URL order. */
import { datasetLabel } from './FiltersPopover';
import {
  customRangeLabel,
  modelOptionLabel,
  modelUrlValues,
  NONE,
  statusLabel,
  versioningKeyWords,
  type RunsView,
} from './urlState';

export interface FilterChip {
  id: string;
  label: string;
  remove: (v: RunsView) => RunsView;
}

type ListKey = 'tasks' | 'datasets' | 'models' | 'versions' | 'statuses' | 'owners';

export function activeChips(view: RunsView, ownerLabel: (id: string) => string = (id) => id): FilterChip[] {
  const chips: FilterChip[] = [];
  if (view.range !== 'all') {
    const label = {
      today: 'Today',
      week: '7 days',
      month: '30 days',
      custom: customRangeLabel(view.from, view.to),
    }[view.range];
    chips.push({
      id: 'range',
      label: `range: ${label}`,
      remove: (v) => ({ ...v, range: 'all', from: '', to: '' }),
    });
  }
  const lists: [ListKey, string, (v: string) => string][] = [
    ['tasks', 'task', (v) => v],
    ['models', 'model', modelOptionLabel],
    ['datasets', 'dataset', datasetLabel],
    ['statuses', 'status', statusLabel],
    ['versions', 'version', (v) => v],
    ['owners', 'user', ownerLabel],
  ];
  for (const [key, singular, label] of lists) {
    const values = key === 'models' ? modelUrlValues(view.models) : view[key];
    for (const value of values) {
      chips.push({
        id: `${key}:${value}`,
        label: `${singular}: ${value === NONE ? 'none' : label(value)}`,
        remove: (v) => {
          const rest = (key === 'models' ? modelUrlValues(v.models) : v[key]).filter((x) => x !== value);
          // A collapsed plain name stands for both variants.
          const expanded =
            key === 'models'
              ? rest.flatMap((x) =>
                  /\|\|\|(plain|reasoning)$/.test(x) || x === NONE
                    ? [x]
                    : [`${x}|||plain`, `${x}|||reasoning`],
                )
              : rest;
          return { ...v, [key]: expanded };
        },
      });
    }
  }
  for (const [key, values] of Object.entries(view.versioning)) {
    for (const value of values) {
      chips.push({
        id: `v.${key}:${value}`,
        label: `${versioningKeyWords(key)}: ${value === '__empty__' ? 'empty' : value}`,
        remove: (v) => ({
          ...v,
          versioning: { ...v.versioning, [key]: (v.versioning[key] ?? []).filter((x) => x !== value) },
        }),
      });
    }
  }
  if (view.origin !== 'all')
    chips.push({ id: 'origin', label: `origin: ${view.origin}`, remove: (v) => ({ ...v, origin: 'all' }) });
  if (view.q) chips.push({ id: 'q', label: `search: “${view.q}”`, remove: (v) => ({ ...v, q: '' }) });
  return chips;
}
