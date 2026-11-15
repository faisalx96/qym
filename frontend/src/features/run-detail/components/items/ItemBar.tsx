/**
 * The sticky bar that opens an expanded item (round 3 P4): number, verdict, an input preview, Copy link and Collapse.
 * It owns the sticky line while the table header is held above the detail. Its position is a translate set by
 * `useStickyShift` on the bar itself (the table's scroller is an overflow container, so CSS sticky cannot work here).
 */
import { Button, CopyButton, Icon, StateTag, type StateTagTone } from '@/ui';
import type { ItemVerdict } from '../../lib/itemVerdict';
import { verdictTone } from '../../lib/verdictMark';
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
  // a repeat item's "n of m passed" keeps its own tone: all passed success, none danger, some warning
  const tone: StateTagTone =
    verdict.kind === 'aggregate' ? (verdict.tone ?? 'warning') : verdictTone(verdict.kind);
  return (
    <div className={styles.bar} data-item-bar="" data-item-bar-for={itemId}>
      <span className={styles.num}>#{number}</span>
      <span className={styles.verdict}>
        <StateTag tone={tone}>{verdict.label}</StateTag>
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
