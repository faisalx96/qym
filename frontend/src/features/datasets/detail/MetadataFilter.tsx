/** Metadata filter button and popover (spec A3-1 to A3-14): key from the facets, then a value. */
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
  Select,
  Skeleton,
  Text,
  Tooltip,
} from '@/ui';
import { META_LIMIT_HINT, canAddMetaFilter, type MetaFilter } from '../lib/metaFilter';
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
  const canAdd = canAddMetaFilter(filters);
  const button = (
    <Button
      variant="neutral"
      size="sm"
      icon={<Icon name="plus" size={12} />}
      isDisabled={!canAdd}
      data-testid="metadata-filter"
    >
      Metadata
    </Button>
  );
  if (!canAdd) {
    return <Tooltip content={META_LIMIT_HINT}>{button}</Tooltip>;
  }
  return (
    <Popover label="Filter by metadata" isOpen={open} onOpenChange={setOpen} trigger={button}>
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
  const [value, setValue] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const paths = useMemo(() => facets.data?.paths ?? [], [facets.data]);
  const current = paths.find((p) => p.path === (path ?? paths[0]?.path)) ?? null;
  const shown = useMemo(() => {
    if (!current) return [];
    const needle = typed.trim().toLowerCase();
    return needle ? current.values.filter((v) => v.value.toLowerCase().includes(needle)) : current.values;
  }, [current, typed]);
  const exact = current?.truncated && typed.trim() && !current.values.some((v) => v.value === typed.trim());
  const chosen = value ?? (exact ? typed.trim() : null);

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
            description: `${p.value_count} ${p.value_count === 1 ? 'value' : 'values'}`,
          }))}
          value={current?.path ?? null}
          onChange={(k) => {
            setPath(k);
            setValue(null);
            setTyped('');
          }}
          width="100%"
        />
        <div className={styles.values}>
          <Text variant="sm" weight={650} tone="muted" as="p">
            Value
          </Text>
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
                  setValue(typed.trim());
                  onAdd({ path: current.path, value: typed.trim() });
                }
              }}
            />
          ) : null}
          <ListBox
            aria-label={`Values of ${current?.path ?? ''}`}
            selectionMode="single"
            selectedKeys={value !== null ? [value] : []}
            onSelectionChange={(keys) => {
              const first = [...keys][0];
              setValue(first === undefined ? null : String(first));
            }}
            className={styles.facetList}
            data-testid="facet-values"
          >
            {shown.map((v) => (
              <ListBoxItem key={v.value} id={v.value} textValue={v.value} className={styles.facet}>
                <span>{v.value}</span>
                <span>{v.count}</span>
              </ListBoxItem>
            ))}
          </ListBox>
          {current?.truncated ? (
            <Text variant="sm" tone="muted" as="p" data-testid="facet-truncated">
              Showing the {current.values.length} most common values of {current.value_count}. Type to search.
            </Text>
          ) : null}
        </div>
        <div className={styles.foot}>
          <Button variant="ghost" size="sm" onPress={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            isDisabled={!current || chosen === null}
            onPress={() => current && chosen !== null && onAdd({ path: current.path, value: chosen })}
          >
            Add filter
          </Button>
        </div>
      </>
    );
  }
  return (
    <div className={styles.panel} data-testid="meta-popover">
      <Text variant="md" weight={600} as="h3">
        Filter by metadata
      </Text>
      {body}
    </div>
  );
}
