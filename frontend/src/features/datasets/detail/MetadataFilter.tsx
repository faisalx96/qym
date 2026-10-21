/** Metadata filter button and popover (A3-1 to A3-14, QA1-1 to QA1-18): key from the facets, then one value (scalar key) or several with a match mode (list key). */
import { useMemo, useState } from 'react';
import { ListBox, ListBoxItem, type Key } from 'react-aria-components';
import { useMetadataFacets } from '@/api/datasets';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Popover,
  SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  Text,
  Tooltip,
  useToast,
} from '@/ui';
import {
  DEFAULT_MODE,
  MAX_META_VALUES,
  META_LIMIT_HINT,
  canAddMetaFilter,
  orderByFacet,
  type MetaFilter,
  type MetaMode,
} from '../lib/metaFilter';
import styles from './MetadataFilter.module.css';

export interface MetadataFilterProps {
  slug: string;
  datasetRef: string;
  version: string;
  filters: MetaFilter[];
  onAdd: (filter: MetaFilter) => void;
}

export function MetadataFilter({ slug, datasetRef, version, filters, onAdd }: MetadataFilterProps) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const canAdd = canAddMetaFilter(filters);
  const button = (
    <Button
      variant="neutral"
      size="sm"
      icon={<Icon name="plus" size={12} />}
      // At the limit the button reads disabled but stays focusable, so its tooltip can say why.
      className={canAdd ? undefined : styles.limit}
      data-limit={canAdd ? undefined : ''}
      onPress={canAdd ? undefined : () => toast.show(META_LIMIT_HINT, { tone: 'info' })}
      data-testid="metadata-filter"
    >
      Metadata
    </Button>
  );
  if (!canAdd) {
    return <Tooltip content={META_LIMIT_HINT}>{button}</Tooltip>;
  }
  return (
    <Popover
      label="Filter by metadata"
      isOpen={open}
      onOpenChange={setOpen}
      trigger={button}
      testId="meta-popover"
    >
      {({ close }) => (
        <FacetPanel
          slug={slug}
          datasetRef={datasetRef}
          version={version}
          onCancel={close}
          onAdd={(f) => {
            onAdd(f);
            close();
          }}
        />
      )}
    </Popover>
  );
}

const MATCH_HELP = {
  pick: 'Choose two or more values to pick a match mode.',
  any: 'Items that have at least one of the chosen values.',
  all: 'Items that have every chosen value. An item may have more.',
} as const;

function keyDescription(kind: string, count: number): string {
  const base = `${count} ${count === 1 ? 'value' : 'values'}`;
  if (kind === 'list') return `${base} · list`;
  if (kind === 'mixed') return `${base} · list or value`;
  return base;
}

function FacetPanel({
  slug,
  datasetRef,
  version,
  onCancel,
  onAdd,
}: {
  slug: string;
  datasetRef: string;
  version: string;
  onCancel: () => void;
  onAdd: (filter: MetaFilter) => void;
}) {
  const facets = useMetadataFacets(slug, datasetRef, version, true);
  const [path, setPath] = useState<Key | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [mode, setMode] = useState<MetaMode>(DEFAULT_MODE);
  const [typed, setTyped] = useState('');
  const paths = useMemo(() => facets.data?.paths ?? [], [facets.data]);
  const current = paths.find((p) => p.path === (path ?? paths[0]?.path)) ?? null;
  // a payload without `kind` (an older server) is scalar-style
  const multi = current !== null && (current.kind === 'list' || current.kind === 'mixed');
  const shown = useMemo(() => {
    if (!current) return [];
    const needle = typed.trim().toLowerCase();
    return needle ? current.values.filter((v) => v.value.toLowerCase().includes(needle)) : current.values;
  }, [current, typed]);
  const exact = Boolean(
    current?.truncated && typed.trim() && !current.values.some((v) => v.value === typed.trim()),
  );
  const atLimit = chosen.length >= MAX_META_VALUES;
  const help = chosen.length < 2 ? MATCH_HELP.pick : MATCH_HELP[mode];

  function submit(values: string[]) {
    if (!current || values.length === 0) return;
    onAdd({ path: current.path, values: orderByFacet(values, current.values), mode });
  }

  let body;
  if (facets.isError) {
    body = (
      <ErrorState
        compact
        error={facets.error}
        title="Couldn’t load metadata keys"
        onRetry={() => void facets.refetch()}
      />
    );
  } else if (facets.isPending) {
    body = <Skeleton kind="lines" rows={4} label="Loading metadata keys" />;
  } else if (!paths.length) {
    body = (
      <EmptyState
        compact
        title="No metadata keys"
        body="Items in this version have no metadata fields to filter on."
      />
    );
  } else {
    body = (
      <>
        <Select
          label="Key"
          items={paths.map((p) => ({
            key: p.path,
            label: p.path,
            description: keyDescription(p.kind, p.value_count),
          }))}
          value={current?.path ?? null}
          onChange={(k) => {
            setPath(k);
            setChosen([]);
            setMode(DEFAULT_MODE);
            setTyped('');
          }}
          width="100%"
        />
        <div className={styles.values}>
          <div className={styles.valuesHead}>
            <Text variant="sm" weight={650} tone="muted" as="p">
              Value
            </Text>
            {multi ? (
              <Text variant="sm" tone="muted" as="span" data-testid="facet-selected-count">
                {chosen.length === 0 ? 'None selected' : `${chosen.length} selected`}
              </Text>
            ) : null}
          </div>
          {current && current.truncated ? (
            <SearchField
              label="Find a value"
              hideLabel
              placeholder="Type to search values"
              value={typed}
              onChange={setTyped}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && exact) {
                  e.preventDefault();
                  if (multi) {
                    if (!atLimit) setChosen([...chosen, typed.trim()]);
                    setTyped('');
                  } else {
                    submit([typed.trim()]);
                  }
                }
              }}
            />
          ) : null}
          <ListBox
            aria-label={`Values of ${current?.path ?? ''}`}
            selectionMode={multi ? 'multiple' : 'single'}
            selectedKeys={chosen}
            disabledKeys={
              multi && atLimit ? current.values.map((v) => v.value).filter((v) => !chosen.includes(v)) : []
            }
            onSelectionChange={(keys) => {
              if (keys === 'all') return;
              const next = [...keys].map(String);
              setChosen(multi ? next.slice(0, MAX_META_VALUES) : next.slice(-1));
            }}
            className={styles.facetList}
            data-testid="facet-values"
            data-multi={multi ? '' : undefined}
          >
            {shown.map((v) => (
              <ListBoxItem key={v.value} id={v.value} textValue={v.value} className={styles.facet}>
                {({ isSelected }) => (
                  <>
                    {multi ? (
                      <span className={styles.tick} aria-hidden="true">
                        {isSelected ? <Icon name="check" size={12} /> : null}
                      </span>
                    ) : null}
                    <span className={styles.facetValue}>{v.value}</span>
                    <span>{v.count}</span>
                  </>
                )}
              </ListBoxItem>
            ))}
            {chosen
              .filter((c) => !shown.some((v) => v.value === c))
              .map((c) => (
                <ListBoxItem key={c} id={c} textValue={c} className={styles.facet}>
                  <span className={styles.tick} aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>
                  <span className={styles.facetValue}>{c}</span>
                  <span />
                </ListBoxItem>
              ))}
          </ListBox>
          {current?.truncated ? (
            <Text variant="sm" tone="muted" as="p" data-testid="facet-truncated">
              Showing the {current.values.length} most common values of {current.value_count}. Type to search.
            </Text>
          ) : null}
          {multi && atLimit ? (
            <Text variant="sm" tone="muted" as="p" data-testid="facet-limit">
              You can choose up to 20 values.
            </Text>
          ) : null}
        </div>
        {multi ? (
          <div className={styles.match} data-testid="meta-match">
            <div className={styles.matchRow}>
              <Text variant="sm" weight={650} tone="muted" as="p">
                Match
              </Text>
              <SegmentedControl
                label="Match mode"
                options={[
                  { value: 'any', label: 'Partial' },
                  { value: 'all', label: 'Full match' },
                ]}
                value={mode}
                onChange={setMode}
                isDisabled={chosen.length < 2}
              />
            </div>
            <Text variant="sm" tone="muted" as="p" className={styles.matchHelp} data-testid="meta-match-help">
              {help}
            </Text>
          </div>
        ) : null}
        <div className={styles.foot}>
          <Button variant="ghost" size="sm" onPress={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            isDisabled={!current || chosen.length === 0}
            onPress={() => submit(chosen)}
          >
            Add filter
          </Button>
        </div>
      </>
    );
  }
  return (
    <div className={styles.panel}>
      <Text variant="md" weight={600} as="h3">
        Filter by metadata
      </Text>
      {body}
    </div>
  );
}
