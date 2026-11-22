/**
 * Errors grouped by message (brief 04 §3g). Round 10: each kind is a group with a tinted icon, its colour and its
 * total, then one card per message: the message and its detail, the error count large in the kind's colour, and a bar
 * of its share of the kind. The items it touched are in the card's hover text only (cv4 C2-7: no subtext). Cards wrap in a grid (no table, no sideways scroll). A card toggles
 * the page's filter for that error; the active card says so in words ("Filtering items", RD11), not only by its frame.
 * RD10 (round 2): the card is as compact as before, the title and the detail on one line each; when either is cut, a quiet
 * "Show more" text control under the card opens the full message in place (never a silent ellipsis).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CardTitle, EmptyState, Icon, type IconName, Tag } from '@/ui';
import {
  collectErrors,
  slotOfKind,
  splitErrorLabel,
  type ErrorBucket,
  type ErrorKind,
} from '../../lib/rowErrors';
import { useRunPage } from '../../RunContext';
import styles from './Panels.module.css';

const ORDER: ErrorKind[] = ['Task error', 'Metric error', 'Trace error', 'Analysis error'];
const CLASS: Record<ErrorKind, string> = {
  'Task error': 'task',
  'Metric error': 'metric',
  'Trace error': 'trace',
  'Analysis error': 'analysis',
};

const ICON: Record<ErrorKind, IconName> = {
  'Task error': 'warning',
  'Metric error': 'target',
  'Trace error': 'chain',
  'Analysis error': 'sparkles',
};

/** What an error of the kind means for the numbers above. */
const MEANING: Record<ErrorKind, string> = {
  'Task error': 'The task failed before it could be scored. These items count as 0 in score means.',
  'Metric error': 'The scorer failed on an item. The item counts as 0 for that metric.',
  'Trace error': 'A step inside the trace failed (a tool or a model call). The item may still have a score.',
  'Analysis error': 'The automatic analysis could not explain the item.',
};

/** True when a one-line ellipsis text cuts its content (its full width is wider than its box). */
const isCut = (el: Element) => el.scrollWidth > el.clientWidth + 1;

/**
 * RD10 (round 2): is the collapsed message cut? Measured on the title and the detail lines while collapsed, again when the
 * card resizes; once open, the answer stays as it was so "Show less" stays in place.
 */
function useCutText(open: boolean, text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || open) return;
    setCut(Array.from(el.children).some(isCut));
  }, [open]);
  useLayoutEffect(measure, [measure, text]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  return [ref, cut] as const;
}

export function ErrorCard({
  bucket: b,
  total,
  on,
  onToggle,
}: {
  bucket: ErrorBucket;
  total: number;
  on: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { title, detail } = splitErrorLabel(b.label);
  const [textRef, cut] = useCutText(open, b.label);
  const textId = useId();
  const share = total ? b.count / total : 0;
  const n = b.itemIds.size;
  const tally = `${b.count} ${b.count === 1 ? 'error' : 'errors'}${
    n === b.count ? '' : ` in ${n} ${n === 1 ? 'item' : 'items'}`
  }`;
  return (
    <div className={styles.errCard} data-kind={CLASS[b.kind]} data-selected={on ? '' : undefined}>
      <button
        type="button"
        className={styles.errToggle}
        data-testid="error-card"
        data-kind={CLASS[b.kind]}
        aria-pressed={on}
        data-selected={on ? '' : undefined}
        onClick={onToggle}
        title={`${tally}. ${on ? 'Showing only these items. Click to clear.' : 'Show only the items with this error.'}`}
      >
        <span ref={textRef} id={textId} className={styles.errText} data-open={open ? '' : undefined}>
          <span className={styles.errTitle}>{title}</span>
          {detail ? <span className={styles.errDetail}>{detail}</span> : null}
        </span>
        <span className={styles.errCount}>{b.count}</span>
        <span className={styles.errShare} aria-hidden="true">
          <span style={{ width: `${Math.max(3, share * 100)}%` }} />
        </span>
        {on ? (
          <span className={styles.errActive} data-testid="error-card-active">
            <Icon name="check" size={12} aria-hidden="true" />
            Filtering items
          </span>
        ) : null}
      </button>
      {/* A sibling of the toggle (a button never holds a button), so it never sets the filter. */}
      {cut || open ? (
        <button
          type="button"
          className={styles.errMore}
          aria-expanded={open}
          aria-controls={textId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Show more'}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function ErrorsTab() {
  const { items, model, api } = useRunPage();
  const repeatAggregate = model.isRepeat && !model.viewPass;
  const groups = useMemo(() => {
    const buckets = Array.from(
      collectErrors(
        items.map((i) => i.row),
        repeatAggregate,
      ).values(),
    );
    return ORDER.map((kind) => {
      const list = buckets.filter((b) => b.kind === kind).sort((a, b) => b.count - a.count);
      return { kind, buckets: list, total: list.reduce((a, b) => a + b.count, 0) };
    }).filter((g) => g.buckets.length);
  }, [items, repeatAggregate]);
  if (!groups.length) return <EmptyState compact title="No errors in this view" />;
  const active = api.view.filters.errors;
  const toggle = (b: ErrorBucket) => {
    const slot = slotOfKind(b.kind);
    const on = active[slot]?.label === b.label;
    const errors = { ...api.view.filters.errors };
    if (on) delete errors[slot];
    else errors[slot] = { kind: b.kind, label: b.label };
    api.setFilters({ errors });
  };
  return (
    <div className={styles.errGroups}>
      {groups.map((g) => (
        <section key={g.kind} aria-label={g.kind + 's'} className={styles.errGroup} data-kind={CLASS[g.kind]}>
          <header className={styles.errHead}>
            <span className={styles.errIcon} aria-hidden="true">
              <Icon name={ICON[g.kind]} size={14} />
            </span>
            <CardTitle
              as="h3"
              className={styles.errKindHead}
              title={
                <>
                  <span className={styles.errKind}>{g.kind}s</span>{' '}
                  <Tag kind="count" tone="danger">
                    {g.total}
                  </Tag>
                </>
              }
              description={MEANING[g.kind]}
            />
          </header>
          <div className={styles.errGrid} role="group" aria-label={`${g.kind}s by message`}>
            {g.buckets.map((b) => (
              <ErrorCard
                key={b.kind + b.label}
                bucket={b}
                total={g.total}
                on={active[slotOfKind(b.kind)]?.label === b.label}
                onToggle={() => toggle(b)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
