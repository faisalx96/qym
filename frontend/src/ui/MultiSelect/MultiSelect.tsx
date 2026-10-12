import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, Dialog, DialogTrigger, Popover, type Key } from 'react-aria-components';
import { Checkbox } from '../Checkbox';
import { Icon } from '../Icon';
import styles from './MultiSelect.module.css';

export interface MultiSelectItem {
  key: Key;
  label: string;
  count?: number;
  searchText?: string;
}

export interface MultiSelectProps<T extends MultiSelectItem> {
  label: string;
  items: T[];
  value: Set<Key>;
  onChange: (keys: Set<Key>) => void;
  searchable?: boolean;
  /** Per-option "Only" action (clears the others). */
  onlyAction?: boolean;
  selectAll?: boolean;
  renderItem?: (item: T) => ReactNode;
  emptyOption?: { key: Key; label: string };
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  className?: string;
  isDisabled?: boolean;
}

/**
 * .qym-dropdown: trigger → search → Select all / None → 32px checkbox rows
 * with "Only". Arrow keys move through options; Escape returns to the trigger.
 */
export function MultiSelect<T extends MultiSelectItem>({
  label,
  items,
  value,
  onChange,
  searchable = true,
  onlyAction = true,
  selectAll = true,
  renderItem,
  emptyOption,
  placeholder = 'All',
  className,
  isDisabled,
}: MultiSelectProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (emptyOption ? [emptyOption as T, ...items] : items), [items, emptyOption]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => (i.searchText ?? i.label).toLowerCase().includes(q));
  }, [all, query]);
  const selectedCount = value.size;
  const summary =
    selectedCount === 0
      ? placeholder
      : selectedCount === 1
        ? (all.find((i) => value.has(i.key))?.label ?? '1 selected')
        : `${selectedCount} selected`;

  function toggle(key: Key) {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }
  function moveFocus(delta: number) {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-option]') ?? []);
    if (!nodes.length) return;
    const idx = nodes.findIndex((n) => n === document.activeElement || n.contains(document.activeElement));
    const nextIdx =
      idx === -1 ? (delta > 0 ? 0 : nodes.length - 1) : (idx + delta + nodes.length) % nodes.length;
    nodes[nextIdx]?.focus();
  }

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton
        className={[styles.trigger, className].filter(Boolean).join(' ')}
        isDisabled={isDisabled}
        aria-haspopup="dialog"
        aria-controls={open ? listId : undefined}
        data-active={selectedCount ? '' : undefined}
      >
        <span className={styles.triggerLabel}>{label}</span>
        <span className={styles.triggerValue}>{summary}</span>
        <Icon name="chevron-down" size={12} />
      </AriaButton>
      <Popover className={styles.popover} placement="bottom start" offset={4}>
        <Dialog className={styles.dialog} aria-label={`${label} options`} id={listId}>
          {({ close }) => (
            <div
              className={styles.panel}
              role="presentation"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveFocus(1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveFocus(-1);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                }
              }}
            >
              {searchable ? (
                <div className={styles.searchWrap}>
                  <Icon name="search" size={12} />
                  <input
                    className={styles.search}
                    placeholder="Search…"
                    aria-label={`Search ${label}`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                </div>
              ) : null}
              {selectAll ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => onChange(new Set(visible.map((i) => i.key)))}
                  >
                    Select all
                  </button>
                  <button type="button" className={styles.action} onClick={() => onChange(new Set())}>
                    None
                  </button>
                </div>
              ) : null}
              <div className={styles.list} ref={listRef}>
                {visible.length === 0 ? <div className={styles.empty}>No matches</div> : null}
                {visible.map((item) => (
                  <div
                    key={String(item.key)}
                    className={styles.option}
                    data-option=""
                    tabIndex={-1}
                    role="presentation"
                  >
                    <Checkbox
                      isSelected={value.has(item.key)}
                      onChange={() => toggle(item.key)}
                      className={styles.checkbox}
                    >
                      <span className={styles.optionLabel}>{renderItem ? renderItem(item) : item.label}</span>
                      {typeof item.count === 'number' ? (
                        <span className={styles.count}>{item.count}</span>
                      ) : null}
                    </Checkbox>
                    {onlyAction ? (
                      <button
                        type="button"
                        className={styles.only}
                        aria-label={`Only ${item.label}`}
                        onClick={() => onChange(new Set([item.key]))}
                      >
                        Only
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
