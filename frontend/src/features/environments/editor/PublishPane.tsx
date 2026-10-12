/** "Review and publish": release notes, status, validation and Cancel / Publish vN. */
import { KeyValueGrid, Badge, Button, Text, Textarea } from '@/ui';
import { plural } from '@/features/experiments/lib/format';
import { Callout } from '@/features/experiments/launch/components/Callout';
import { ProblemList } from '@/features/experiments/launch/components/ProblemList';
import { useGoToSection } from '@/features/experiments/launch/components/goToSection';
import panel from '@/features/experiments/launch/components/launch.module.css';
import styles from '@/features/experiments/launch/review/review.module.css';
import { datasetValue, NOTES_MAX, publishBlocker } from '@/features/experiments/launch/model';
import { SECTION_TITLES, useLaunch, type SectionId } from '@/features/experiments/launch/LaunchContext';
import { changeText, useEditorChangeCount } from './EditorEntry';

export interface PublishPaneProps {
  notes: string;
  onNotes: (value: string) => void;
  saving: boolean;
  /** Failure of the last publish attempt ('' when none). */
  failure: { kind: 'forbidden' | 'conflict' | 'invalid' | 'error'; message: string } | null;
  onPublish: () => void;
  onCancel: () => void;
  onReload: () => void;
}

export function PublishPane({
  notes,
  onNotes,
  saving,
  failure,
  onPublish,
  onCancel,
  onReload,
}: PublishPaneProps) {
  const { doc, editor, review, sectionSummary, flags, selectedEnvs, readOnly } = useLaunch();
  const goTo = useGoToSection();
  const count = useEditorChangeCount();
  const current = editor?.currentVersion ?? null;
  const comparedWith = current != null ? `v${current}` : 'Blank';
  const blocker = publishBlocker({
    loaded: Boolean(editor && editor.state === 'ready' && doc.base.loaded && !flags.envsLoading),
    problems: review.items.length,
    requireChange: current != null,
    unchanged: Boolean(editor?.unchanged),
    baseLabel: doc.base.label || comparedWith,
    notes,
  });
  const next = editor?.nextVersion ?? 1;
  const rows: Array<{ id: SectionId; label: string }> = [];
  for (const id of ['models', 'settings', 'evaluation'] as const) {
    const changes = sectionSummary(id).changes;
    if (changes) rows.push({ id, label: `${SECTION_TITLES[id]}: ${plural(changes, 'change')}` });
  }
  return (
    <aside className={`${panel.panel} ${styles.pane}`} aria-label="Review and publish">
      <div className={styles.head}>
        <Text variant="lg" as="h3">
          Review and publish
        </Text>
        {review.items.length ? (
          <Badge tone="danger">{plural(review.items.length, 'problem')}</Badge>
        ) : !blocker ? (
          <Badge tone="success">Ready</Badge>
        ) : (
          <Badge tone="neutral">Draft</Badge>
        )}
      </div>
      <KeyValueGrid
        columns={1}
        dense
        aria-label="Summary"
        items={[
          { key: 'env', label: 'Environment', value: selectedEnvs.map((e) => e.name).join(', ') || '—' },
          {
            key: 'ds',
            label: 'Dataset',
            value: datasetValue(doc) || 'None',
            mono: Boolean(datasetValue(doc)),
          },
          { key: 'base', label: 'Compared with', value: doc.base.label || comparedWith },
          {
            key: 'diff',
            label: 'Changes',
            value: changeText(count, comparedWith, Boolean(editor && !editor.unchanged)),
          },
        ]}
      />
      {rows.length ? (
        <ul className={styles.changes} aria-label="Changes by step">
          {rows.map((r) => (
            <li key={r.id} className={styles.change}>
              <span>{r.label}</span>
              <Button size="sm" variant="ghost" onPress={() => goTo(r.id)} aria-label={`Edit: ${r.label}`}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Textarea
        label="Release notes (required)"
        value={notes}
        onChange={onNotes}
        maxLength={NOTES_MAX}
        rows={4}
        placeholder="What changed and why"
        isRequired
        isDisabled={saving || readOnly}
        help={`${notes.length} / ${NOTES_MAX}`}
      />
      <section aria-labelledby="editor-validation-title" className={styles.pane}>
        <Text variant="md" weight={600} as="h4" id="editor-validation-title">
          {review.items.length ? `${plural(review.items.length, 'problem')} to fix` : 'Validation'}
        </Text>
        {review.items.length ? (
          <ProblemList items={review.items} label="Problems to fix" />
        ) : (
          <Text variant="base" className={styles.ok} role="status" data-testid="publish-status">
            {blocker || 'Ready to publish'}
          </Text>
        )}
        {review.items.length ? (
          <Text variant="base" tone="muted" role="status" data-testid="publish-status">
            {blocker}
          </Text>
        ) : null}
      </section>
      {failure ? (
        <Callout
          tone="error"
          live
          title={failure.kind === 'conflict' ? 'The default preset changed' : 'Not published'}
        >
          <div>{failure.message}</div>
          {failure.kind === 'conflict' ? (
            <div>
              <Button size="sm" variant="neutral" onPress={onReload}>
                Reload the editor
              </Button>
            </div>
          ) : null}
        </Callout>
      ) : null}
      <div className={styles.actions}>
        <Button size="md" variant="ghost" onPress={onCancel} isDisabled={saving}>
          Cancel
        </Button>
        <Button
          size="md"
          variant="primary"
          loading={saving}
          isDisabled={readOnly || Boolean(blocker) || saving}
          onPress={onPublish}
        >
          {`Publish v${next}`}
        </Button>
      </div>
    </aside>
  );
}
