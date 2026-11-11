/** Step 1 of the editor: what the draft is compared with (version, changes, undo, release notes of the base, drift). */
import { diffCount, evaluatorChangedCount } from '@/features/experiments/launch/model';
import { useLaunch } from '@/features/experiments/launch/LaunchContext';
import { Callout } from '@/features/experiments/launch/components/Callout';
import panel from '@/features/experiments/launch/components/launch.module.css';
import entry from '@/features/experiments/launch/entry/entry.module.css';
import { Button, Card, Disclosure, Tag } from '@/ui';

/** "3 changes vs v2" (the count the Publish button and the review share). */
export function useEditorChangeCount(): number {
  const { doc, ctx } = useLaunch();
  return diffCount(doc).total + evaluatorChangedCount(doc, ctx.evaluatorPanel);
}

export function changeText(count: number, comparedWith: string, differs: boolean): string {
  if (count === 0 && differs) return `Differs from ${comparedWith}`;
  return `${count} change${count === 1 ? '' : 's'} vs ${comparedWith}`;
}

function List({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function ComparedWithCard() {
  const { doc, editor, resetAll, readOnly } = useLaunch();
  const count = useEditorChangeCount();
  const base = doc.base;
  const comparedWith = editor?.currentVersion != null ? `v${editor.currentVersion}` : 'Blank';
  return (
    <div data-part="compared-with">
      <Card as="section" aria-label="Compared with">
        <div className={`${panel.cardStack}`} data-testid="editor-entry">
          <div className={entry.stack}>
            <div className={entry.legend} id="editor-compared-label">
              Compared with
            </div>
            <div
              className={entry.status}
              role="status"
              aria-live="polite"
              aria-labelledby="editor-compared-label"
            >
              <span className={entry.statusText}>
                {base.loading ? (
                  'Loading the current version…'
                ) : (
                  <>
                    <strong>{base.label || 'Blank'}</strong>
                    {editor?.draftLabel ? ` · draft from ${editor.draftLabel}` : ''}
                  </>
                )}
              </span>
              {!base.loading ? (
                <Tag kind="count" tone={count || !editor?.unchanged ? 'info' : undefined}>
                  {changeText(count, comparedWith, Boolean(editor && !editor.unchanged))}
                </Tag>
              ) : null}
              <span className={entry.statusActions}>
                <Button
                  size="sm"
                  variant="danger"
                  isDisabled={count === 0 || readOnly}
                  disabledReason={readOnly ? 'Read-only' : 'No changes to undo'}
                  onPress={resetAll}
                >
                  Undo all changes
                </Button>
              </span>
            </div>
            {editor?.draftLabel ? (
              <Callout>
                {editor.promoted
                  ? `Promoting ${editor.draftLabel}, compared with ${editor.currentVersion != null ? 'the current version' : 'Blank'}. Nothing changes until you publish.`
                  : `A draft from ${editor.draftLabel}, compared with the current version. Nothing changes until you publish.`}
              </Callout>
            ) : null}
            {base.summary ? <Callout>{base.summary}</Callout> : null}
            {base.dropped.length ? (
              <Callout
                tone="warning"
                title={`${base.dropped.length} setting${base.dropped.length === 1 ? '' : 's'} could not be carried over`}
              >
                <List items={base.dropped.map((d) => `${d.label || d.pointer}: ${d.message}`)} />
              </Callout>
            ) : null}
            {base.errors.length ? (
              <Callout tone="error" title="Problems with the current version">
                <List items={base.errors} />
              </Callout>
            ) : null}
            {editor?.warnings.length ? (
              <Callout tone="warning">
                <List items={editor.warnings} />
              </Callout>
            ) : null}
            {base.notes.length ? (
              <Callout>
                <List items={base.notes} />
              </Callout>
            ) : null}
            {base.releaseNotes ? (
              <Disclosure title={`Release notes of ${base.label}`}>
                <p className={entry.notes}>{base.releaseNotes}</p>
              </Disclosure>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
