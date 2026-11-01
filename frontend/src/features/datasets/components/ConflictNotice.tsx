/**
 * Save conflict (C015): someone saved this item after it was opened. One inline notice above the fields says who and
 * when, shows each field I changed (mine) against the saved text (theirs), and offers 'Review their version' (drop my
 * edits) or 'Keep mine' (save over theirs).
 */
import { Button, InlineNotice } from '@/ui';
import type { ItemConflict } from '../item/useItemEditor';
import { fieldLabel, formatDate } from '../lib/itemValue';
import { FieldDiff } from './FieldDiff';
import styles from './ConflictNotice.module.css';

const FIELDS = [
  ['input', 'input'],
  ['expected_output', 'expected_output'],
  ['metadata', 'metadata'],
] as const;

export function ConflictNotice({
  conflict,
  busy,
  onReview,
  onKeep,
}: {
  conflict: ItemConflict;
  busy: boolean;
  onReview: () => void;
  onKeep: () => void;
}) {
  const who = conflict.by?.display_name || conflict.by?.email || 'Someone';
  const changed = FIELDS.filter(([key]) => key in conflict.mine);
  return (
    <section className={styles.conflict} aria-label="Save conflict" data-testid="save-conflict">
      <InlineNotice tone="warning" lead={`${who} changed this item at ${formatDate(conflict.at)}.`}>
        Your changes are not saved yet.
      </InlineNotice>
      {changed.map(([key, theirsKey]) => (
        <FieldDiff
          key={key}
          field={fieldLabel(key)}
          before={conflict.mine[key]}
          after={conflict.theirs[theirsKey]}
          beforeLabel="mine"
          afterLabel="theirs"
        />
      ))}
      <div className={styles.actions}>
        <Button variant="neutral" onPress={onReview} isDisabled={busy} data-testid="conflict-review">
          Review their version
        </Button>
        <Button variant="primary" onPress={onKeep} loading={busy} data-testid="conflict-keep">
          Keep mine
        </Button>
      </div>
    </section>
  );
}
