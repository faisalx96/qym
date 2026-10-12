/** Expanded item: input, expected output, metadata and one output card per compared run (bodies load lazily). */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Chip, CopyButton, Tag } from '@/ui';
import { bodyText } from '@/features/run-detail/lib/itemText';
import { HIDDEN_METADATA_KEYS, ITEM_METADATA_BADGE_KEYS, itemMetadataBadgeValues, itemMetadataDisplayValue } from '@/features/run-detail/lib/rowMeta';
import { letterOf, useCompare } from '../../CompareContext';
import { useDetailsStore, useEnsureBodies, useResolvedRows } from '../../hooks/useDetails';
import { Collapsible, OutputCard } from './OutputCard';
import { useItemsUi } from './ItemsUi';
import styles from './ItemDetail.module.css';

const INITIAL_CARDS = 8;

export function ItemDetail({ itemId }: { itemId: string }) {
  const { model } = useCompare();
  const ui = useItemsUi();
  const store = useDetailsStore();
  const location = useLocation();
  const resolved = useResolvedRows(model.runs, itemId);
  const ensure = useEnsureBodies(model.runs);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  useEffect(() => {
    void ensure([itemId]);
  }, [ensure, itemId]);

  const firstIdx = resolved.findIndex((r) => r.row);
  const first = resolved[firstIdx]?.row ?? null;
  const loadedAll = resolved.every((r) => !r.row || r.loaded);
  const failed = useMemo(
    () => model.runs.filter((run) => { const row = run.byItem.get(itemId); return row && store.stateOf(run.base, row.item_id)?.status === 'error'; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.runs, itemId, resolved],
  );
  const input = bodyText(first?.input_full ?? first?.input ?? first?.input_preview);
  const expected = bodyText(first?.expected_full ?? first?.expected);
  const md = first?.item_metadata ?? {};
  const badges = ITEM_METADATA_BADGE_KEYS.flatMap((k) => itemMetadataBadgeValues(k, md[k]).map((v) => ({ k, v })));
  const tags = Object.entries(md).filter(([k, v]) => !HIDDEN_METADATA_KEYS.has(k) && !ITEM_METADATA_BADGE_KEYS.includes(k) && !ui.hiddenFields.has(k) && v != null && v !== '' && typeof v !== 'object');
  const link = `${window.location.origin}${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), item: itemId }).toString()}`;
  const cards = resolved.map((r, i) => ({ r, i })).filter((x) => x.r.row && !hidden.has(x.i));
  const shown = all ? cards : cards.slice(0, INITIAL_CARDS);
  return (
    <div className={styles.detail} data-testid="item-detail" data-item-id={itemId}>
      {failed.length ? (
        <div role="alert" className={styles.alert}>
          Item details could not be loaded for {failed.map((r) => r.label).join(', ')}.{' '}
          <Button size="sm" variant="neutral" onPress={() => failed.forEach((r) => void store.retry(r.base, r.byItem.get(itemId)!.item_id))}>
            Retry
          </Button>
        </div>
      ) : !loadedAll ? (
        <p className={styles.muted} aria-busy="true">
          Loading item details…
        </p>
      ) : null}
      <div className={styles.bodies}>
        <section className={styles.block} data-kind="input">
          <header className={styles.blockHead}>
            <span className={styles.label}>Input</span>
            <span>
              <CopyButton text={link} label="Copy link to this item" icon="link" />
              <CopyButton text={input} label="Copy input" />
            </span>
          </header>
          <Collapsible text={input} lines={14} />
        </section>
        {expected ? (
          <section className={styles.block} data-kind="expected">
            <header className={styles.blockHead}>
              <span className={styles.label}>Expected output</span>
              <CopyButton text={expected} label="Copy expected output" />
            </header>
            <Collapsible text={expected} lines={14} />
          </section>
        ) : null}
      </div>
      {badges.length || tags.length ? (
        <div className={styles.tags}>
          {badges.map(({ k, v }) => (
            <Tag key={`${k}:${v}`} kind="data" title={k}>
              {v}
            </Tag>
          ))}
          {tags.map(([k, v]) => (
            <Tag key={k} kind="data">
              {k}: {itemMetadataDisplayValue(v)}
            </Tag>
          ))}
        </div>
      ) : null}
      {model.runs.length > 1 ? (
        <div className={styles.toggles} role="group" aria-label="Runs shown">
          {model.runs.map((run, i) =>
            resolved[i]?.row ? (
              <Chip
                key={run.ref}
                isSelected={!hidden.has(i)}
                onChange={(on) => setHidden((h) => { const n = new Set(h); if (on) n.delete(i); else n.add(i); return n; })}
              >
                {letterOf(i)} {run.label}
              </Chip>
            ) : null,
          )}
        </div>
      ) : null}
      <div className={styles.grid}>
        {shown.map(({ r, i }) => (
          <OutputCard key={model.runs[i]!.ref} run={model.runs[i]!} runIndex={i} row={r.row!} itemId={itemId} />
        ))}
      </div>
      {!all && cards.length > INITIAL_CARDS ? (
        <Button size="sm" variant="neutral" onPress={() => setAll(true)}>
          Show all {cards.length} runs
        </Button>
      ) : null}
    </div>
  );
}
