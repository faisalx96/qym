import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { SearchField } from '../SearchField';
import { headerText } from './model';
import type { Column } from './types';
import type { DataTableModel } from './useDataTableModel';
import styles from './DataTable.module.css';

/** Marks the freeze line inside the draft list. */
const LINE = '\u0000line';

/** Moves `id` so it ends at `to` in `list` (the list keeps the freeze line as an item). */
export function moveItem(list: string[], id: string, to: number): string[] {
  const from = list.indexOf(id);
  if (from < 0) return list;
  const next = list.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

/**
 * Columns popover: search, All / None, Reset. With `reorderable` the list is in display order, each row has a
 * drag handle (pointer, touch and keyboard: Space lifts, arrows move, Space drops, Esc cancels), a visibility
 * checkbox and a freeze toggle; the line between frozen and scrolling columns can be dragged across.
 */
export function ColumnsMenu<R>({
  columns,
  model,
  label = 'Columns',
  reorderable = false,
  suspended = [],
}: {
  columns: Column<R>[];
  model: DataTableModel;
  label?: string;
  reorderable?: boolean;
  /** Frozen columns that scroll at this width (frozen block over the cap). */
  suspended?: string[];
}) {
  const [q, setQ] = useState('');
  const hideable = columns.filter((c) => c.hideable !== false && !c.id.startsWith('__'));
  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, Column<R>[]>();
    for (const c of hideable) {
      if (needle && !headerText(c).toLowerCase().includes(needle)) continue;
      const key = c.group ?? '';
      out.set(key, [...(out.get(key) ?? []), c]);
    }
    return [...out];
  }, [hideable, q]);
  const shown = hideable.filter((c) => !model.hidden.has(c.id)).length;
  const changed = reorderable && model.layoutChanged;
  return (
    <Popover
      label={label}
      trigger={
        <Button
          icon={<Icon name="list" size={12} />}
          aria-label={`${label} (${shown} of ${hideable.length} shown)`}
        >
          {label}
          {changed ? <span className={styles.colDot} aria-hidden="true" /> : null}
        </Button>
      }
    >
      {reorderable ? (
        <ReorderBody columns={columns} model={model} q={q} setQ={setQ} suspended={suspended} />
      ) : (
        <div className={styles.colMenu}>
          <SearchField label="Search columns" value={q} onChange={setQ} placeholder="Search columns" />
          <div className={styles.colMenuBulk}>
            <Button variant="ghost" onPress={() => model.setAllHidden(false)}>
              All
            </Button>
            <Button variant="ghost" onPress={() => model.setAllHidden(true)}>
              None
            </Button>
            <Button variant="ghost" onPress={model.resetColumns}>
              Reset
            </Button>
          </div>
          <div className={styles.colMenuList}>
            {sections.length === 0 ? <p className={styles.colMenuEmpty}>No matching columns</p> : null}
            {sections.map(([group, list]) => (
              <fieldset key={group || '_'} className={styles.colMenuGroup}>
                {group ? <legend className={styles.colMenuLegend}>{group}</legend> : null}
                {list.map((c) => (
                  <Checkbox
                    key={c.id}
                    isSelected={!model.hidden.has(c.id)}
                    onChange={(on) => model.setHidden(c.id, !on)}
                  >
                    {headerText(c)}
                  </Checkbox>
                ))}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

function ReorderBody<R>({
  columns,
  model,
  q,
  setQ,
  suspended,
}: {
  columns: Column<R>[];
  model: DataTableModel;
  q: string;
  setQ: (q: string) => void;
  suspended: string[];
}) {
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c as Column<R>])), [columns]);
  const listed = model.ordered.filter((c) => !c.lockOrder && !c.id.startsWith('__'));
  const pinnedNow = (c: Column<R>) => (c.id in model.pins ? model.pins[c.id] : (c.pin ?? null));
  const base = useMemo(() => {
    const frozen = listed.filter((c) => pinnedNow(c) === 'start').map((c) => c.id);
    const rest = listed.filter((c) => pinnedNow(c) !== 'start').map((c) => c.id);
    return [...frozen, LINE, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from the model's ordered list and pins
  }, [model.ordered, model.pins]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const focusId = useRef<string | null>(null);
  const items = draft ?? base;
  const line = items.indexOf(LINE);
  const searching = q.trim().length > 0;
  const needle = q.trim().toLowerCase();
  const labelOf = (id: string) => (byId.has(id) ? headerText(byId.get(id)!) : id);

  useLayoutEffect(() => {
    if (!focusId.current) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-col-handle="${CSS.escape(focusId.current)}"]`)
      ?.focus();
  });

  const commit = (list: string[]) => {
    const k = list.indexOf(LINE);
    const pins: Record<string, 'start' | 'end' | null> = {};
    list.forEach((id, i) => {
      if (id === LINE) return;
      const c = byId.get(id);
      if (!c) return;
      const now = pinnedNow(c);
      if (i < k && now !== 'start') pins[id] = 'start';
      else if (i > k && now === 'start') pins[id] = null;
    });
    model.applyLayout({ order: list.filter((x) => x !== LINE), pins });
  };
  const describe = (list: string[], id: string) => {
    const k = list.indexOf(LINE);
    const i = list.indexOf(id);
    const real = list.filter((x) => x !== LINE);
    return `${labelOf(id)} moved to position ${real.indexOf(id) + 1} of ${real.length}${i < k ? ', frozen' : ''}`;
  };

  const rowAt = (clientY: number): number => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-col-item]') ?? [])];
    let best = 0;
    rows.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top) best = i;
    });
    return best;
  };
  const onHandleDown = (id: string, e: PointerEvent<HTMLButtonElement>) => {
    if (searching) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let current = base;
    setLifted(id);
    setDraft(base);
    const move = (ev: globalThis.PointerEvent) => {
      const to = rowAt(ev.clientY);
      if (current.indexOf(id) === to) return;
      current = moveItem(current, id, to);
      setDraft(current);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      commit(current);
      setMessage(describe(current, id));
      setDraft(null);
      setLifted(null);
    };
    const cancel = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      setDraft(null);
      setLifted(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };
  const onHandleKey = (id: string, e: KeyboardEvent<HTMLButtonElement>) => {
    if (searching) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (lifted === id && draft) {
        commit(draft);
        setMessage(describe(draft, id));
        setDraft(null);
        setLifted(null);
        focusId.current = null;
      } else {
        setLifted(id);
        setDraft(base);
        focusId.current = id;
        setMessage(`${labelOf(id)} lifted. Use the arrow keys to move it, Space to drop, Escape to cancel.`);
      }
    } else if (lifted === id && draft && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const i = draft.indexOf(id);
      const to = Math.max(0, Math.min(draft.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
      if (to === i) return;
      const next = moveItem(draft, id, to);
      focusId.current = id;
      setDraft(next);
      setMessage(describe(next, id));
    } else if (lifted === id && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      setLifted(null);
      setMessage(`${labelOf(id)} move cancelled`);
    }
  };
  const toggleFreeze = (id: string) => {
    const c = byId.get(id);
    if (!c) return;
    const frozen = pinnedNow(c) === 'start';
    const k = base.indexOf(LINE);
    const without = base.filter((x) => x !== id);
    const kk = without.indexOf(LINE);
    // Freezing lands at the end of the frozen block, unfreezing at the start of the scrolling columns.
    const next = [...without];
    next.splice(frozen ? kk + 1 : kk, 0, id);
    void k;
    commit(next);
    setMessage(`${labelOf(id)} ${frozen ? 'unfrozen' : 'frozen'}`);
  };

  const frozenCount = line;
  const visibleItems = items.filter((id) => {
    if (id === LINE) return !searching;
    return !needle || labelOf(id).toLowerCase().includes(needle);
  });
  const suspendedNames = suspended.map(labelOf);
  return (
    <div className={styles.colMenu} data-columns-reorder="">
      <SearchField label="Search columns" value={q} onChange={setQ} placeholder="Search columns" />
      <div className={styles.colMenuBulk}>
        <Button variant="ghost" onPress={() => model.setAllHidden(false)}>
          All
        </Button>
        <Button variant="ghost" onPress={() => model.setAllHidden(true)}>
          None
        </Button>
        <Button variant="ghost" onPress={model.resetColumns} className={styles.colMenuReset}>
          Reset layout
        </Button>
      </div>
      <div className={styles.colMenuList} ref={listRef} role="list" aria-label="Column order">
        {visibleItems.length === 0 ? <p className={styles.colMenuEmpty}>No matching columns</p> : null}
        {visibleItems.map((id) => {
          if (id === LINE)
            return (
              <div key={LINE} className={styles.colLine} role="listitem" data-col-item="" data-col-line="">
                <span>Frozen ({frozenCount})</span>
                {suspendedNames.length ? (
                  <span className={styles.colLineNote}>
                    Not frozen at this width: {suspendedNames.join(', ')}
                  </span>
                ) : null}
                <span className={styles.colLineRule}>Scrolling columns below</span>
              </div>
            );
          const c = byId.get(id);
          if (!c) return null;
          const frozen = items.indexOf(id) < line;
          const name = headerText(c);
          return (
            <div
              key={id}
              className={styles.colRow}
              role="listitem"
              data-col-item=""
              data-col-row={id}
              data-lifted={lifted === id ? '' : undefined}
              data-frozen={frozen ? '' : undefined}
            >
              <button
                type="button"
                className={styles.colHandle}
                data-col-handle={id}
                aria-label={`Reorder ${name}`}
                aria-pressed={lifted === id}
                aria-roledescription="drag handle"
                disabled={searching}
                onPointerDown={(e) => onHandleDown(id, e)}
                onKeyDown={(e) => onHandleKey(id, e)}
              >
                <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
                  <circle cx="3" cy="3" r="1.2" />
                  <circle cx="7" cy="3" r="1.2" />
                  <circle cx="3" cy="7" r="1.2" />
                  <circle cx="7" cy="7" r="1.2" />
                  <circle cx="3" cy="11" r="1.2" />
                  <circle cx="7" cy="11" r="1.2" />
                </svg>
              </button>
              <Checkbox
                isSelected={!model.hidden.has(id)}
                isDisabled={c.hideable === false}
                onChange={(on) => model.setHidden(id, !on)}
                className={styles.colCheck}
              >
                {name}
              </Checkbox>
              {c.group ? <span className={styles.colGroup}>{c.group}</span> : null}
              <button
                type="button"
                className={styles.colPin}
                aria-pressed={frozen}
                aria-label={`Freeze ${name}`}
                title={frozen ? `Unfreeze ${name}` : `Freeze ${name}`}
                onClick={() => toggleFreeze(id)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 17v5M8 3h8l-1 7 3 4H6l3-4z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
