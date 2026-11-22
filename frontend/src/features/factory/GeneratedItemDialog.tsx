/**
 * The generated item popup: one item of a generation attempt in full (its place in the tree, the rules applied,
 * the input, the expected output and the metadata), with Prev / Next over the table and the review actions
 * (approve, reject, back to pending: approve level) in the footer, the way a rule opens from the Rules tab.
 */
import { type GeneratedItem, type ReviewState } from '@/api/factory';
import { datasetPath } from '@/features/datasets/lib/route';
import { formatAgo } from '@/lib/dates';
import { Button, Dialog, IconButton, StructuredValue, Tag, Text, TextLink, UserName } from '@/ui';
import { ReviewMark } from './tabs/reviewMark';
import styles from './ReviewDialog.module.css';

export interface GeneratedItemDialogProps {
  slug: string;
  dataset: { slug: string; deleted: boolean } | null;
  version: string | null;
  item: GeneratedItem | null;
  onClose: () => void;
  position?: { index: number; total: number };
  onNavigate?: (delta: -1 | 1) => void;
  canReview: boolean;
  busy: boolean;
  onReview: (item: GeneratedItem, review: ReviewState) => void;
}

function factoryMeta(item: GeneratedItem): { titles: string[]; bridges: string[]; note: string } {
  const meta = item.metadata.factory;
  const f = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return { titles: list(f.rule_titles), bridges: list(f.bridges), note: typeof f.note === 'string' ? f.note : '' };
}

export function GeneratedItemDialog({
  slug,
  dataset,
  version,
  item,
  onClose,
  position,
  onNavigate,
  canReview,
  busy,
  onReview,
}: GeneratedItemDialogProps) {
  const meta = item ? factoryMeta(item) : { titles: [], bridges: [], note: '' };
  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item ? item.item_id : 'Item'}
      description={
        item
          ? `Layer ${item.layer} · from ${item.parent_item_id}${item.rule ? ` · ${item.rule.title}` : ''}`
          : undefined
      }
      size="lg"
      data-testid="generated-item-view"
      footer={
        <>
          <span className={styles.footerStart}>
            {position && onNavigate ? (
              <>
                <IconButton
                  icon="prev"
                  label="Previous item"
                  isDisabled={position.index <= 0}
                  onPress={() => onNavigate(-1)}
                  data-testid="item-view-prev"
                />
                <span className={styles.position} aria-live="polite">
                  {position.index + 1} of {position.total}
                </span>
                <IconButton
                  icon="next"
                  label="Next item"
                  isDisabled={position.index >= position.total - 1}
                  onPress={() => onNavigate(1)}
                  data-testid="item-view-next"
                />
              </>
            ) : null}
          </span>
          {item && canReview && !item.missing ? (
            <>
              {item.review !== 'pending' ? (
                <Button
                  size="md"
                  variant="neutral"
                  onPress={() => onReview(item, 'pending')}
                  isDisabled={busy}
                  data-testid="item-view-reset"
                >
                  Mark as pending
                </Button>
              ) : null}
              {item.review !== 'rejected' ? (
                <Button
                  size="md"
                  variant="danger"
                  onPress={() => onReview(item, 'rejected')}
                  isDisabled={busy}
                  data-testid="item-view-reject"
                >
                  Reject
                </Button>
              ) : null}
              {item.review !== 'approved' ? (
                <Button
                  size="md"
                  variant="primary"
                  onPress={() => onReview(item, 'approved')}
                  loading={busy}
                  data-testid="item-view-approve"
                >
                  Approve
                </Button>
              ) : null}
            </>
          ) : null}
          <Button size="md" variant="neutral" onPress={onClose}>
            Close
          </Button>
        </>
      }
    >
      {item ? (
        <div className={styles.view}>
          <div className={styles.facts} data-testid="item-view-facts">
            <ReviewMark review={item.review} />
            {item.disabled && item.review !== 'rejected' ? <Tag tone="warning">Disabled in the dataset</Tag> : null}
            {meta.titles.map((title, i) => (
              <Tag key={`${title}-${i}`} kind="config" title={meta.bridges.includes(title) ? 'A bridge' : 'Rule applied'}>
                {i + 1}. {title}
              </Tag>
            ))}
            {item.reviewed_by ? (
              <Text as="span" variant="sm" tone="muted">
                {item.review === 'approved' ? 'Approved' : 'Rejected'} {item.reviewed_at ? formatAgo(item.reviewed_at) : ''} by{' '}
                <UserName id={item.reviewed_by.id} name={item.reviewed_by.display_name} email={item.reviewed_by.email} />
              </Text>
            ) : null}
            {dataset && !dataset.deleted && version && !item.missing ? (
              <TextLink to={datasetPath(slug, dataset.slug, { v: version, item: item.item_id })}>Open in the dataset</TextLink>
            ) : null}
          </div>
          {item.missing ? (
            <p className={`${styles.prose} ${styles.muted}`}>This item was removed from the output dataset.</p>
          ) : (
            <>
              {meta.note ? (
                <section className={styles.section} aria-label="What changed">
                  <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
                    What the agent changed
                  </Text>
                  <p className={styles.prose} dir="auto">
                    {meta.note}
                  </p>
                </section>
              ) : null}
              <section className={styles.section} aria-label="Input">
                <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
                  Input
                </Text>
                <StructuredValue value={item.input} label="Input" toolbar={false} lines={16} />
              </section>
              <section className={styles.section} aria-label="Expected output">
                <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
                  Expected output
                </Text>
                <StructuredValue value={item.expected_output} label="Expected output" toolbar={false} lines={16} />
              </section>
              <section className={styles.section} aria-label="Metadata">
                <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
                  Metadata
                </Text>
                <StructuredValue value={item.metadata} label="Metadata" toolbar={false} variant="keys" />
              </section>
            </>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
