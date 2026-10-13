import { useEffect, useRef } from 'react';
import { Button } from '@/ui';
import { launchLabel, PSEUDO, pointerToFieldName } from '../model';
import { plural } from '../../lib/format';
import { useLaunch } from '../LaunchContext';
import styles from './review.module.css';

/** Below 1200px the review pane is the last block; this sticky bar keeps the essentials in reach. */
export function MobileLaunchBar({ onCancel }: { onCancel: () => void }) {
  const { review, isLaunching, launch, focusIssue, openSection, focusField, readOnly } = useLaunch();
  const first = review.items[0];
  const ref = useRef<HTMLDivElement>(null);
  // Publish the bar's height so the sticky step navigation can sit just above it.
  useEffect(() => {
    const bar = ref.current;
    const host = bar?.parentElement;
    if (!bar || !host) return undefined;
    const set = () => host.style.setProperty('--launch-bar-height', `${bar.offsetHeight + 8}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      host.style.removeProperty('--launch-bar-height');
    };
  }, []);
  return (
    <div ref={ref} className={styles.bar} role="region" aria-label="Launch">
      <div className={styles.barText}>
        <span className={styles.barTitle} aria-live="polite">
          {plural(review.count.runs, 'run')} to launch
        </span>
        {first ? (
          <button type="button" className={styles.problemLink} onClick={() => focusIssue(first)}>
            Fix {plural(review.items.length, 'problem')} first: {first.label}
          </button>
        ) : (
          <span className={styles.ok}>{review.status || 'Review below'}</span>
        )}
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="neutral"
          onPress={() => {
            openSection('raw');
            focusField(pointerToFieldName(PSEUDO.rawJson), 'raw');
          }}
        >
          Raw JSON
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={isLaunching}
          isDisabled={readOnly || !review.canLaunch || review.items.length > 0}
          onPress={() => void launch()}
        >
          {launchLabel(review.count.runs, isLaunching)}
        </Button>
      </div>
    </div>
  );
}
