import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import styles from './DataTable.module.css';

/**
 * The body of a fold column (`Column.foldLabel`). While the scroller has columns past its end edge, CSS shows only
 * the small handle and leaves the rest of the cell see-through; the handle opens the cell in place for this row.
 * Scrolled to the end, the handle is hidden and the cell renders as usual. Escape, the handle again or a press
 * outside the cell (menus and dialogs it opened excepted) fold it back. An empty label = nothing to act on: the
 * folded cell is see-through with no handle.
 */
export function FoldCell({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || rootRef.current?.contains(target)) return;
      if (target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    // first action of the opened cell takes focus, so the keyboard path is handle, actions, Escape
    rootRef.current?.querySelector<HTMLElement>('[data-fold-body] button, [data-fold-body] a')?.focus();
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  return (
    <div
      ref={rootRef}
      className={styles.fold}
      data-open={open ? '' : undefined}
      role="presentation"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        setOpen(false);
        handleRef.current?.focus();
      }}
    >
      <span className={styles.foldBody} data-fold-body="">
        {children}
      </span>
      {label ? (
        <button
          ref={handleRef}
          type="button"
          className={styles.foldHandle}
          data-fold-handle=""
          aria-label={label}
          aria-expanded={open}
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <Icon name={open ? 'chevron-right' : 'chevron-left'} size={12} />
        </button>
      ) : null}
    </div>
  );
}
