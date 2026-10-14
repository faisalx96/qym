import { Button } from '@/ui';
import { launchLabel, PSEUDO, pointerToFieldName } from '../model';
import { useLaunch } from '../LaunchContext';
import styles from './review.module.css';

/** Cancel / Raw JSON / Launch N runs. Raw JSON opens, scrolls to and focuses its section. */
export function LaunchActions({ onCancel, hideRaw }: { onCancel: () => void; hideRaw?: boolean }) {
  const { review, isLaunching, launch, openSection, focusField, readOnly } = useLaunch();
  return (
    <div className={styles.actions}>
      <Button size="md" variant="ghost" onPress={onCancel}>
        Cancel
      </Button>
      {hideRaw ? null : (
        <Button
          size="md"
          variant="neutral"
          onPress={() => {
            openSection('raw');
            focusField(pointerToFieldName(PSEUDO.rawJson), 'raw');
          }}
        >
          Raw JSON
        </Button>
      )}
      <Button
        size="md"
        variant="primary"
        loading={isLaunching}
        isDisabled={readOnly || !review.canLaunch || review.items.length > 0}
        onPress={() => void launch()}
      >
        {launchLabel(review.count.runs, isLaunching)}
      </Button>
    </div>
  );
}
