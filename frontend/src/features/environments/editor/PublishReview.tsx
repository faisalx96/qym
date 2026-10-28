/** The review step of the editor, "Review and publish": Summary, Release notes, Changes and Checks. */
import { Button, Card, Text, Textarea } from '@/ui';
import { plural } from '@/features/experiments/lib/format';
import { Callout } from '@/features/experiments/launch/components/Callout';
import { useGoToSection } from '@/features/experiments/launch/components/goToSection';
import { ChangesCard, ChecksCard, ReviewKv, ReviewCard, type ChangeRow } from '@/features/experiments/launch/review/ReviewParts';
import styles from '@/features/experiments/launch/review/reviewStep.module.css';
import { datasetValue, NOTES_MAX } from '@/features/experiments/launch/model';
import { SECTION_TITLES, useLaunch } from '@/features/experiments/launch/LaunchContext';
import { useEnvTaskLists } from '@/api/launch';
import { changeText, useEditorChangeCount } from './ComparedWithCard';

export interface PublishFailure {
  kind: 'forbidden' | 'conflict' | 'invalid' | 'error';
  message: string;
}

export interface PublishReviewProps {
  notes: string;
  onNotes: (value: string) => void;
  saving: boolean;
  /** Failure of the last publish attempt. */
  failure: PublishFailure | null;
  /** Why Publish is disabled ('' when it is not). */
  blocker: string;
  onReload: () => void;
}

export function PublishReview({ notes, onNotes, saving, failure, blocker, onReload }: PublishReviewProps) {
  const { doc, editor, review, sectionSummary, selectedEnvs, readOnly, projectId } = useLaunch();
  const goTo = useGoToSection();
  const count = useEditorChangeCount();
  const lists = useEnvTaskLists(projectId, selectedEnvs);
  const current = editor?.currentVersion ?? null;
  const comparedWith = current != null ? `v${current}` : 'Blank';
  const taskId = doc.selection.task;
  const taskName = taskId
    ? (Object.values(lists)
        .flatMap((l) => l?.tasks ?? [])
        .find((t) => t.id === taskId)?.name ?? taskId)
    : 'Worker default';
  const rows: ChangeRow[] = [];
  for (const id of ['models', 'settings', 'evaluation'] as const) {
    const changes = sectionSummary(id).changes;
    if (changes) rows.push({ key: id, label: `${SECTION_TITLES[id]}: ${plural(changes, 'change')}`, onEdit: () => goTo(id) });
  }
  return (
    <div className={styles.stack} data-testid="publish-review">
      <ReviewCard title="Summary" part="review-summary" label="Summary">
        <ReviewKv
          rows={[
            { key: 'env', label: 'Environment', value: selectedEnvs.map((e) => e.name).join(', ') || '—' },
            { key: 'task', label: 'Task', value: taskName },
            { key: 'ds', label: 'Dataset', value: datasetValue(doc) || 'None', mono: Boolean(datasetValue(doc)) },
            { key: 'base', label: 'Compared with', value: doc.base.label || comparedWith },
            {
              key: 'diff',
              label: 'Changes',
              value: changeText(count, comparedWith, Boolean(editor && !editor.unchanged)),
            },
          ]}
        />
      </ReviewCard>
      <div data-part="release-notes">
        <Card as="section" aria-label="Release notes">
          <div className={styles.stack}>
            <Text variant="lg" weight={650} as="h3" className={styles.cardTitle}>
              Release notes
            </Text>
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
          </div>
        </Card>
      </div>
      <div className={styles.twoCol}>
        <ChangesCard rows={rows} base={comparedWith} />
        <ChecksCard statusTestId="publish-status" status={blocker || 'Ready to publish'}>
          {review.items.length ? (
            <Text variant="base" tone="muted" role="status" data-testid="publish-status">
              {blocker}
            </Text>
          ) : null}
        </ChecksCard>
      </div>
      {failure ? (
        <Callout tone="error" live title={failure.kind === 'conflict' ? 'The default preset changed' : 'Not published'}>
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
    </div>
  );
}
