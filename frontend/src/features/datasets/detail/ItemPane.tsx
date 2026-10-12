/** Docked (non-modal) item editor beside the items table: Text/JSON fields, sticky footer, Prev/Next. */
import { useDatasetItem, type Dataset, type DatasetItem, type DatasetVersion } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { Button, ErrorState, IconButton, LinkButton, Skeleton, Text, useToast } from '@/ui';
import { FieldEditor } from '../components/FieldEditor';
import { useItemEditor } from '../item/useItemEditor';
import { datasetPath } from '../lib/route';
import styles from './ItemPane.module.css';

export interface ItemPaneProps {
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  itemId: string;
  editable: boolean;
  position: { index: number; total: number };
  query: string;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
  /** Reports dirtiness so the workspace can guard Esc / row changes. */
  onDirtyChange: (dirty: boolean, save: () => Promise<boolean>, reset: () => void) => void;
  onTypeChangeConfirm?: (names: string[]) => Promise<boolean>;
}

export function ItemPane({ slug, dataset, version, itemId, editable, position, query, onClose, onNavigate, onDirtyChange, onTypeChangeConfirm }: ItemPaneProps) {
  const toast = useToast();
  const q = useDatasetItem(slug, dataset.slug, version.version, itemId);
  const item: DatasetItem | undefined = q.data;
  const editor = useItemEditor(slug, dataset.slug, version.version, item);

  // Publish dirtiness + imperative save/reset to the workspace on every render.
  const saveAll = async (): Promise<boolean> => {
    if (!editor.valid) return false;
    if (editor.typeChanges.length && onTypeChangeConfirm && !(await onTypeChangeConfirm(editor.typeChanges))) return false;
    try {
      const saved = await editor.save();
      if (saved) toast.show(`Item ${saved.item_id} saved`, { tone: 'success' });
      return true;
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Save failed', { tone: 'error' });
      return false;
    }
  };
  onDirtyChange(editor.dirty, saveAll, editor.reset);

  return (
    <aside className={styles.pane} aria-label={`Item ${itemId}`} data-item-pane={itemId}>
      <header className={styles.head}>
        <div className={styles.headMain}>
          <Text as="span" variant="md" weight={650} mono>
            {itemId}
          </Text>
          <span className={styles.pos}>
            {position.index + 1} / {position.total.toLocaleString()}
          </span>
        </div>
        <div className={styles.headActions}>
          <IconButton label="Previous item" icon="chevron-up" onPress={() => onNavigate(-1)} />
          <IconButton label="Next item" icon="chevron-down" onPress={() => onNavigate(1)} />
          <LinkButton to={`${datasetPath(slug, dataset.slug)}?${query}`} variant="ghost" size="sm" data-testid="pane-open-page">
            Open page
          </LinkButton>
          <IconButton label="Close editor" icon="close" onPress={onClose} data-testid="pane-close" />
        </div>
      </header>
      <div className={styles.scroll}>
        {q.isPending ? <Skeleton kind="lines" rows={5} label="Loading item" /> : null}
        {q.isError ? <ErrorState compact error={q.error} title="Couldn’t load this item" onRetry={() => void q.refetch()} /> : null}
        {item && editor.state ? (
          <div className={styles.fields}>
            <FieldEditor compact label="Input" value={item.input} editable={editable} state={editor.state.input} onChange={(s) => editor.set('input', s)} />
            <FieldEditor compact label="Expected output" value={item.expected_output} editable={editable} state={editor.state.expected} onChange={(s) => editor.set('expected', s)} />
            <FieldEditor compact label="Metadata" value={item.metadata} editable={editable} jsonOnly state={editor.state.metadata} onChange={(s) => editor.set('metadata', s)} />
          </div>
        ) : null}
      </div>
      {editable ? (
        <footer className={styles.foot}>
          <Text as="span" variant="sm" tone="muted" aria-live="polite">
            {editor.dirty ? (editor.valid ? 'Unsaved changes' : 'Fix the invalid field to save') : 'No changes'}
          </Text>
          <Button variant="primary" onPress={() => void saveAll()} isDisabled={!editor.dirty || !editor.valid} loading={editor.saving} data-testid="pane-save">
            Save changes
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}
