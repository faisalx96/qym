import { useMemo, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import { Button, Chip, ConfirmDialog, EmptyState, FormDialog, Icon, IconButton, SearchField, useToast } from '@/ui';
import { items as seed, itemsTotal, type Item } from '../fixtures';
import styles from './shared.module.css';

export function useItemsState() {
  const toast = useToast();
  const [rows, setRows] = useState<Item[]>(seed);
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [dialog, setDialog] = useState<'delete' | 'label' | null>(null);
  const visible = useMemo(
    () =>
      rows
        .filter((r) => (label ? r.labels.includes(label) : true))
        .filter((r) => !search || JSON.stringify([r.input, r.expected_output, r.item_id]).toLowerCase().includes(search.toLowerCase())),
    [rows, label, search],
  );
  const total = rows.length === seed.length && !search && !label ? itemsTotal : visible.length;
  const save = (id: number, patch: Partial<Item>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, edit_count: r.edit_count + 1, updated_at: new Date().toISOString() } : r)));
    toast.show('Item saved', { tone: 'success' });
  };
  const deleteSelected = () => {
    const n = selected.size;
    setRows((prev) => prev.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    toast.show(`${n} item${n === 1 ? '' : 's'} deleted from the draft`, { tone: 'success' });
  };
  const addLabel = (value: string) => {
    setRows((prev) => prev.map((r) => (selected.has(r.id) && !r.labels.includes(value) ? { ...r, labels: [...r.labels, value] } : r)));
    toast.show(`Label “${value}” added to ${selected.size} items`, { tone: 'success' });
    setSelected(new Set());
  };
  return { rows, visible, total, search, setSearch, label, setLabel, selected, setSelected, dialog, setDialog, save, deleteSelected, addLabel };
}
export type ItemsState = ReturnType<typeof useItemsState>;

export function ItemsToolbar({ s, end, hint }: { s: ItemsState; end?: ReactNode; hint?: ReactNode }) {
  return (
    <div className={styles.toolbar}>
      <SearchField label="Search items" placeholder="Search items…" value={s.search} onChange={s.setSearch} width={260} />
      {s.label ? (
        <Chip isSelected onRemove={() => s.setLabel(null)} removeLabel="Clear label filter">
          label: {s.label}
        </Chip>
      ) : null}
      {s.selected.size ? (
        <div className={styles.bulkBar} role="region" aria-label="Bulk item actions">
          <span className={styles.bulkCount}>{s.selected.size} selected</span>
          <Button size="sm" variant="danger" icon={<Icon name="trash" size={12} />} onPress={() => s.setDialog('delete')}>
            Delete {s.selected.size}
          </Button>
          <Button size="sm" onPress={() => s.setDialog('label')}>
            Add label
          </Button>
          <IconButton label="Clear selection" icon="close" onPress={() => s.setSelected(new Set())} />
        </div>
      ) : (
        hint
      )}
      <span className={styles.toolbarEnd}>
        <span className={styles.count} aria-live="polite">
          {s.total} items
        </span>
        {end}
      </span>
    </div>
  );
}

export function ItemsBulkDialogs({ s }: { s: ItemsState }) {
  const n = s.selected.size;
  return (
    <>
      <ConfirmDialog
        open={s.dialog === 'delete'}
        onOpenChange={(o) => !o && s.setDialog(null)}
        title={`Delete ${n} item${n === 1 ? '' : 's'} from this draft?`}
        description="They stay in the published versions. The draft's history records the deletion."
        confirmLabel={`Delete ${n}`}
        tone="danger"
        onConfirm={() => {
          s.deleteSelected();
          s.setDialog(null);
        }}
      />
      <FormDialog
        open={s.dialog === 'label'}
        onOpenChange={(o) => !o && s.setDialog(null)}
        title={`Add a label to ${n} item${n === 1 ? '' : 's'}`}
        fields={[{ name: 'label', label: 'Label', required: true, placeholder: 'golden', autoFocus: true }]}
        confirmLabel="Add label"
        onSubmit={(v) => {
          s.addLabel(String(v.label));
          s.setDialog(null);
        }}
      />
    </>
  );
}

export function PrivateLocked() {
  return (
    <div className={styles.locked}>
      <EmptyState
        icon={<Icon name="shield" size={20} />}
        title="Private test set"
        body="Item contents are hidden for this dataset. Admins can view and edit items; runs, lineage and settings stay visible to everyone."
        action={
          <Button variant="ghost" icon={<Icon name="external" size={12} />}>
            About private test sets
          </Button>
        }
      />
    </div>
  );
}

export function AddItemFooter() {
  return (
    <div className={styles.footerAdd}>
      <Button variant="ghost" icon={<Icon name="plus" size={12} />}>
        Add new item
      </Button>
    </div>
  );
}
