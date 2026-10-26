/** Expanded item: input, expected output, metadata and one output card per compared run (bodies load lazily). */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, CopyButton, Tag } from '@/ui';
import { bodyText } from '@/features/run-detail/lib/itemText';
import {
  HIDDEN_METADATA_KEYS,
  ITEM_METADATA_BADGE_KEYS,
  itemMetadataBadgeValues,
  itemMetadataDisplayValue,
} from '@/features/run-detail/lib/rowMeta';
import { runColor, useCompare } from '../../CompareContext';
import { runShortName } from '../../lib/labels';
import { visibleWhenOnlyDiffering } from '../../lib/filters';
import { pillState, uniqueBestRun } from '../../lib/rowCells';
import { RunTag } from '../RunTag';
import { useDetailsStore, useEnsureBodies, useResolvedRows } from '../../hooks/useDetails';
import { Collapsible, OutputCard } from './OutputCard';
import { useItemsUi } from './ItemsUi';
import styles from './ItemDetail.module.css';

const INITIAL_CARDS = 8;

export function ItemDetail({ itemId }: { itemId: string }) {
  const { model, ctx, baseline } = useCompare();
  const ui = useItemsUi();
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const store = useDetailsStore();
  const location = useLocation();
  const resolved = useResolvedRows(model.runs, itemId);
  const ensure = useEnsureBodies(model.runs);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!openMetric) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMetric(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMetric]);
  useEffect(() => {
    void ensure([itemId]);
  }, [ensure, itemId]);

  const firstIdx = resolved.findIndex((r) => r.row);
  const first = resolved[firstIdx]?.row ?? null;
  const loadedAll = resolved.every((r) => !r.row || r.loaded);
  const failed = useMemo(
    () =>
      model.runs.filter((run) => {
        const row = run.byItem.get(itemId);
        return row && store.stateOf(run.base, row.item_id)?.status === 'error';
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.runs, itemId, resolved],
  );
  const input = bodyText(first?.input_full ?? first?.input ?? first?.input_preview);
  const expected = bodyText(first?.expected_full ?? first?.expected);
  const md = first?.item_metadata ?? {};
  const badges = ITEM_METADATA_BADGE_KEYS.flatMap((k) =>
    itemMetadataBadgeValues(k, md[k]).map((v) => ({ k, v })),
  );
  const tags = Object.entries(md).filter(
    ([k, v]) =>
      !HIDDEN_METADATA_KEYS.has(k) &&
      !ITEM_METADATA_BADGE_KEYS.includes(k) &&
      !ui.hiddenFields.has(k) &&
      v != null &&
      v !== '' &&
      typeof v !== 'object',
  );
  const link = `${window.location.origin}${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), item: itemId }).toString()}`;
  const baseIdx = baseline.runIdxs[0] ?? 0;
  const differing = useMemo(
    () =>
      visibleWhenOnlyDiffering(
        resolved.map((r) => r.row ?? null),
        baseIdx,
      ),
    [resolved, baseIdx],
  );
  const states = model.runs.map((run, i) => pillState(run, resolved[i]?.row ?? null, ctx));
  const bestIdx = uniqueBestRun(
    states.map((p) => p.score),
    states.map((p) => p.state),
    ctx.direction,
  );
  const cards = resolved.map((r, i) => ({ r, i })).filter((x) => x.r.row && !hidden.has(x.i));
  const shown = all ? cards : cards.slice(0, INITIAL_CARDS);
  return (
    <div className={styles.detail} data-testid="item-detail" data-part="item-detail" data-item-id={itemId}>
      {failed.length ? (
        <div role="alert" className={styles.alert}>
          Item details could not be loaded for {failed.map((r) => r.label).join(', ')}.{' '}
          <Button
            size="sm"
            variant="neutral"
            onPress={() => failed.forEach((r) => void store.retry(r.base, r.byItem.get(itemId)!.item_id))}
          >
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
        <div className={styles.toggleRow}>
          <span className={styles.label}>Output</span>
          <div className={styles.toggles} role="group" aria-label="Runs shown" data-part="output-toggles">
            {model.runs.map((run, i) =>
              resolved[i]?.row ? (
                <button
                  key={run.ref}
                  type="button"
                  className={styles.toggle}
                  style={{ '--run': runColor(i) } as CSSProperties}
                  aria-pressed={!hidden.has(i)}
                  data-part="output-toggle"
                  title={run.label}
                  onClick={() =>
                    setHidden((h) => {
                      const n = new Set(h);
                      // at least one run stays on
                      if (n.has(i)) n.delete(i);
                      else if (cards.filter((x) => !n.has(x.i)).length > 1) n.add(i);
                      return n;
                    })
                  }
                >
                  <RunTag index={i} name={runShortName(run)} compact bare />
                </button>
              ) : null,
            )}
          </div>
          <span className={styles.toggleAll}>
          <Button size="sm" variant="ghost" onPress={() => setHidden(new Set())}>
            All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() =>
              setHidden(new Set(differing.map((keep, i) => (keep ? -1 : i)).filter((i) => i >= 0)))
            }
          >
            Only differing
          </Button>
          </span>
        </div>
      ) : null}
      <div className={styles.scroller} data-testid="output-grid" data-part="output-grid">
        <div className={styles.grid} data-open={openMetric ? '' : undefined}>
          {shown.map(({ r, i }) => (
            <OutputCard
              key={model.runs[i]!.ref}
              run={model.runs[i]!}
              runIndex={i}
              row={r.row!}
              itemId={itemId}
              openMetric={openMetric}
              onOpenMetric={setOpenMetric}
              best={bestIdx === i}
            />
          ))}
        </div>
      </div>
      {!all && cards.length > INITIAL_CARDS ? (
        <Button size="sm" variant="neutral" onPress={() => setAll(true)}>
          Show all {cards.length} runs
        </Button>
      ) : null}
    </div>
  );
}
