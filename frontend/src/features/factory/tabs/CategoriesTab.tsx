/**
 * Factory → Categories: the kinds of rules the agent extracts, one card each (name, key, description for the
 * agent, the optional JSON schema of the rule body, rule count), with Add, Edit and Remove (modify level). The
 * last category cannot be removed: the agent needs one.
 */
import { useState } from 'react';
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type FactoryCategory,
  type FactoryDetail,
} from '@/api/factory';
import { actionErrorMessage } from '@/lib/http';
import { Button, Card, ConfirmDialog, Icon, IconButton, JsonTree, Tag, Text, useToast } from '@/ui';
import { CategoryDialog } from '../dialogs';
import styles from '../FactoryDetailPage.module.css';

export function CategoriesTab({ factory, canModify }: { factory: FactoryDetail; canModify: boolean }) {
  const toast = useToast();
  const create = useCreateCategory(factory.id);
  const update = useUpdateCategory(factory.id);
  const remove = useDeleteCategory(factory.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FactoryCategory | null>(null);
  const [removing, setRemoving] = useState<FactoryCategory | null>(null);
  const last = factory.categories.length <= 1;

  return (
    <div className={styles.tab} data-testid="categories-tab">
      <div className={styles.toolbar}>
        <Text as="p" variant="base" tone="muted">
          The agent looks for every category in every group. A description tells it what counts; a JSON schema
          makes each rule carry a structured body.
        </Text>
        {canModify ? (
          <span className={styles.toolbarEnd}>
            <Button
              variant="neutral"
              icon={<Icon name="plus" size={12} />}
              onPress={() => setAdding(true)}
              data-testid="add-category"
            >
              Add category
            </Button>
          </span>
        ) : null}
      </div>
      <ul className={styles.cards} aria-label="Rule categories">
        {factory.categories.map((c) => (
          <Card as="li" key={c.id} className={styles.entry} data-testid="category-card">
            <div className={styles.entryHead}>
              <span className={styles.entryTitle}>
                <Text variant="md" weight={600} as="h3" className={styles.entryName}>
                  {c.name}
                </Text>
                <Tag kind="config">{c.key}</Tag>
                <Tag kind="count">
                  {c.rule_count} rule{c.rule_count === 1 ? '' : 's'}
                </Tag>
              </span>
              {canModify ? (
                <span className={styles.rowActions}>
                  <IconButton
                    tile
                    icon="edit"
                    label={`Edit ${c.name}`}
                    onPress={() => setEditing(c)}
                    data-testid="category-edit"
                  />
                  <IconButton
                    tile
                    tone="danger"
                    icon="trash"
                    label={`Remove ${c.name}`}
                    isDisabled={last}
                    disabledReason="A factory keeps at least one category"
                    onPress={() => setRemoving(c)}
                    data-testid="category-delete"
                  />
                </span>
              ) : null}
            </div>
            <p className={styles.description} dir="auto">
              {c.description || <span className={styles.muted}>No description</span>}
            </p>
            {c.json_schema ? (
              <div className={styles.schema}>
                <JsonTree data={c.json_schema} label="Rule body schema" expandDepth={2} toolbar={false} />
              </div>
            ) : (
              <Text as="p" variant="sm" tone="muted">
                No body schema: rules are a title and a sentence.
              </Text>
            )}
          </Card>
        ))}
      </ul>
      <CategoryDialog
        open={adding || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        existing={editing}
        onSave={async (values) => {
          if (editing) {
            await update.mutateAsync({ categoryId: editing.id, body: values });
            toast.show('Category saved', { tone: 'success' });
          } else {
            await create.mutateAsync(values);
            toast.show('Category added', { tone: 'success' });
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove the category “${removing?.name ?? ''}”?`}
        description={
          removing?.rule_count
            ? `Its ${removing.rule_count} rule${removing.rule_count === 1 ? ' goes' : 's go'} with it.`
            : 'It has no rules.'
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.id);
            toast.show('Category removed', { tone: 'info' });
            setRemoving(null);
          } catch (e) {
            toast.show(actionErrorMessage('remove the category', e), { tone: 'error' });
          }
        }}
      />
    </div>
  );
}
