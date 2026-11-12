/**
 * The sticky bar that opens an expanded item (round 3 P4): number, verdict, an input preview, Copy link and Collapse.
 * It owns the sticky line while the table header is held above the detail. Its position is a translate set by
 * `useStickyShift` on the bar itself (the table's scroller is an overflow container, so CSS sticky cannot work here).
 */
import { Button, CopyButton, Icon, StatusMark, type StatusShape, type StatusTone } from '@/ui';
import type { ItemVerdict } from '../../lib/itemVerdict';
import { VERDICT_MARK } from '../../lib/verdictMark';
import styles from './ItemBar.module.css';

export function ItemBar({
  number,
  itemId,
  verdict,
  preview,
  link,
  onCollapse,
}: {
  number: number;
  itemId: string;
  verdict: ItemVerdict;
  preview: string;
  link: string;
  onCollapse: () => void;
}) {
  const [tone, shape]: [StatusTone, StatusShape] =
    verdict.kind === 'aggregate'
      ? verdict.tone === 'success'
        ? ['success', 'check']
        : verdict.tone === 'danger'
          ? ['danger', 'cross']
          : ['warning', 'dot']
      : (VERDICT_MARK[verdict.kind] ?? ['neutral', 'ring']);
  return (
    <div className={styles.bar} data-item-bar="" data-item-bar-for={itemId}>
      <span className={styles.num}>#{number}</span>
      <span className={styles.verdict}>
        <StatusMark tone={tone} shape={shape} label={verdict.label} />
      </span>
      <span className={styles.preview} dir="auto">
        {preview}
      </span>
      <span className={styles.actions}>
        <CopyButton text={link} icon="link" label="Copy link" />
        <Button
          size="sm"
          variant="neutral"
          iconEnd={<Icon name="chevron-up" size={12} />}
          onPress={onCollapse}
          aria-label={`Collapse item #${number}`}
        >
          Collapse
        </Button>
      </span>
    </div>
  );
}
