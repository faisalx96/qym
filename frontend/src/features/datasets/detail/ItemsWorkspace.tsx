/**
 * Items tab = table + docked editor pane (UX decision A): row activation opens the
 * pane, multi-select enables bulk delete, and a dirty editor guards Esc / row changes.
 * The full item page (?item=) stays for Runs/History and deep links.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Key } from 'react-aria-components';
import { useBlocker, useSearchParams } from 'react-router-dom';
import {
  bulkItems,
  invalidateItems,
  type Dataset,
  type DatasetItem,
  type DatasetVersion,
} from '@/api/datasets';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/http';
import { Button, ConfirmDialog, useToast } from '@/ui';
import { ItemPane } from './ItemPane';
import { ItemsTab } from './ItemsTab';
import styles from './ItemsWorkspace.module.css';

export interface ItemsWorkspaceProps {
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  readOnly: boolean;
  onAddItem: () => void;
  onImport: () => void;
}

export function ItemsWorkspace({
  slug,
  dataset,
  version,
  readOnly,
  onAddItem,
  onImport,
}: ItemsWorkspaceProps) {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const editable = version.status === 'draft' && !readOnly;
  const [paneId, setPaneId] = useState<string | null>(null);
  const [rows, setRows] = useState<DatasetItem[]>([]);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [guard, setGuard] = useState<{ proceed: () => void } | null>(null);
  const dirty = useRef<{ dirty: boolean; save: () => Promise<boolean>; reset: () => void }>({
    dirty: false,
    save: async () => true,
    reset: () => undefined,
  });

  const attempt = useCallback((proceed: () => void) => {
    if (dirty.current.dirty) setGuard({ proceed });
    else proceed();
  }, []);

  const itemQuery = new URLSearchParams(params);
  itemQuery.set('item', paneId ?? '');
  itemQuery.delete('tab');
  itemQuery.delete('page');

  // Esc closes the pane (through the discard guard) unless a dialog/popup owns it; j / k step through rows
  // (the vanilla drawer's shortcuts) when no field has focus.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });
  useEffect(() => {
    if (!paneId) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== 'Escape') return;
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="listbox"], [role="menu"]',
        )
      )
        return;
      attempt(() => setPaneId(null));
    };
    // Capture phase: the table also maps j / k to row focus; the pane stepping wins while it is open.
    const onStep = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
            t.isContentEditable ||
            t.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
        )
          return;
        const list = rowsRef.current;
        const at = list.findIndex((r) => r.item_id === paneId);
        const nextRow = list[at + (e.key === 'j' ? 1 : -1)];
        if (nextRow) {
          e.preventDefault();
          e.stopPropagation();
          attempt(() => setPaneId(nextRow.item_id));
        }
      }
    };
    document.addEventListener('keydown', onEscape);
    document.addEventListener('keydown', onStep, true);
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('keydown', onStep, true);
    };
  }, [paneId, attempt]);

  // Leaving the Items tab / version / dataset with unsaved edits asks first; sorting, paging and
  // searching keep the pane (and its edits) mounted, so they pass.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!dirty.current.dirty) return false;
    if (currentLocation.pathname !== nextLocation.pathname) return true;
    const a = new URLSearchParams(currentLocation.search);
    const b = new URLSearchParams(nextLocation.search);
    return ['tab', 'v', 'item'].some((k) => (a.get(k) ?? '') !== (b.get(k) ?? ''));
  });
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // No pane, no edits: a pane closed by a bulk delete must not leave a stale dirty flag behind.
  useEffect(() => {
    if (!paneId) dirty.current = { dirty: false, save: async () => true, reset: () => undefined };
  }, [paneId]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const index = paneId ? rows.findIndex((r) => r.item_id === paneId) : -1;
  const open = (item: DatasetItem) => {
    if (item.item_id === paneId) return;
    attempt(() => setPaneId(item.item_id));
  };
  const move = (delta: -1 | 1) => {
    const next = rows[index + delta];
    if (next) attempt(() => setPaneId(next.item_id));
  };

  async function bulkDelete() {
    const ids = [...selected].map(String);
    try {
      const r = await bulkItems(slug, dataset.slug, version.version, { deletes: ids });
      invalidateItems(qc, slug, dataset.slug);
      setSelected(new Set());
      if (paneId && ids.includes(paneId)) setPaneId(null);
      toast.show(`${r.summary.deleted} item${r.summary.deleted === 1 ? '' : 's'} deleted`, {
        tone: 'success',
      });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Delete failed', { tone: 'error' });
      throw e;
    }
  }

  return (
    <div className={styles.layout} data-has-pane={paneId ? '' : undefined}>
      <div className={styles.table}>
        <ItemsTab
          slug={slug}
          dataset={dataset}
          version={version}
          readOnly={readOnly}
          onAddItem={onAddItem}
          onImport={onImport}
          onRows={setRows}
          selection={editable ? { selected, onChange: setSelected } : undefined}
          bulkActions={
            <Button
              variant="danger"
              size="sm"
              onPress={() => setConfirmBulk(true)}
              data-testid="bulk-delete-items"
            >
              Delete {selected.size}
            </Button>
          }
          onOpenItem={open}
          onFilterChange={clearSelection}
          onDeleted={(id) => {
            if (id === paneId) setPaneId(null);
            setSelected((s) => {
              const n = new Set(s);
              n.delete(id);
              return n;
            });
          }}
        />
      </div>
      {paneId ? (
        <ItemPane
          slug={slug}
          dataset={dataset}
          version={version}
          itemId={paneId}
          editable={editable}
          position={{ index: Math.max(0, index), total: rows.length }}
          query={itemQuery.toString()}
          onClose={() => attempt(() => setPaneId(null))}
          onNavigate={move}
          onDirtyChange={(d, save, reset) => {
            dirty.current = { dirty: d, save, reset };
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`}
        description="They are removed from this draft in one step. Published versions keep their copy."
        confirmLabel={`Delete ${selected.size}`}
        tone="danger"
        onConfirm={bulkDelete}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard unsaved changes?"
        description="This item has edits that are not saved."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          dirty.current.dirty = false;
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
      <ConfirmDialog
        open={guard !== null}
        onOpenChange={(o) => !o && setGuard(null)}
        title="Unsaved changes"
        description="This item has edits that are not saved."
        cancelLabel="Keep editing"
        altLabel="Discard"
        confirmLabel="Save and continue"
        tone="accent"
        onConfirm={async () => {
          if (await dirty.current.save()) {
            const g = guard;
            setGuard(null);
            g?.proceed();
          } else throw new Error('Could not save; fix the item first.');
        }}
        onAlternative={() => {
          dirty.current.reset();
          dirty.current.dirty = false;
          const g = guard;
          setGuard(null);
          g?.proceed();
        }}
      />
    </div>
  );
}
