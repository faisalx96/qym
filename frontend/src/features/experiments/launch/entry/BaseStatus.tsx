import { Button, Tag } from '@/ui';
import { diffCount, diffText, driftLines } from '../model';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import styles from './entry.module.css';

function List({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** "Based on …", "N changes on top", "Undo all changes", hints, release notes, remap callouts. */
export function BaseStatus() {
  const { doc, baseState, resetAll, launch, flags, isLaunching, readOnly } = useLaunch();
  const base = doc.base;
  const total = diffCount(doc).total;
  const drift = driftLines(base.drift);
  const hasBase = Boolean(doc.environmentIds.length);
  if (!hasBase) return null;
  return (
    <div className={styles.stack}>
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.statusText}>
          {base.loading ? (
            'Loading the starting point…'
          ) : base.pending ? (
            'Pick a scope below to find the best runs.'
          ) : (
            <>
              Based on <strong>{baseState.label}</strong>
            </>
          )}
        </span>
        {!base.loading ? (
          <Tag kind="count" tone={total ? 'info' : undefined}>
            {diffText(doc)}
          </Tag>
        ) : null}
        <span className={styles.statusActions}>
          <Button size="sm" variant="ghost" isDisabled={total === 0 || readOnly} onPress={resetAll}>
            Undo all changes
          </Button>
          {flags.canLaunchAsIs ? (
            <Button
              size="sm"
              variant="accent"
              loading={isLaunching}
              isDisabled={readOnly}
              onPress={() => void launch()}
            >
              Launch as is
            </Button>
          ) : null}
        </span>
      </div>
      {baseState.note ? <Callout tone="warning">{baseState.note}</Callout> : null}
      {base.error ? (
        <Callout tone="error" live title="The starting point did not load">
          {base.error} The form starts from scratch; pick another starting point or continue.
        </Callout>
      ) : null}
      {base.summary ? <Callout>{base.summary}</Callout> : null}
      {base.dropped.length ? (
        <Callout
          tone="warning"
          title={`${base.dropped.length} setting${base.dropped.length === 1 ? '' : 's'} could not be carried over`}
        >
          <List
            items={base.dropped.map((d) => `${d.label || d.pointer}: ${d.message || d.reason || 'dropped'}`)}
          />
        </Callout>
      ) : null}
      {base.errors.length ? (
        <Callout tone="error" title="Problems with this starting point">
          <List items={base.errors} />
        </Callout>
      ) : null}
      {base.warnings.length ? (
        <Callout tone="warning">
          <List items={base.warnings} />
        </Callout>
      ) : null}
      {drift.length ? (
        <Callout tone="warning" title="The agent or knowledge base changed since this run">
          <List items={drift} />
        </Callout>
      ) : null}
      {base.notes.length ? (
        <Callout>
          <List items={base.notes} />
        </Callout>
      ) : null}
      {base.releaseNotes ? (
        <details>
          <summary>Release notes</summary>
          <p className={styles.notes}>{base.releaseNotes}</p>
        </details>
      ) : null}
    </div>
  );
}
