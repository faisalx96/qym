/**
 * The rule popup: one rule in full, the way a dataset item opens from its table. The facts (status, categories,
 * group, kind, source, approval), the rule text, its structured body, and the source items its evidence names
 * (input and expected output, each with a link to the item). The footer walks the list (Prev / Next) and carries
 * the row actions: make official / take back (approve level), edit and remove (modify level).
 */
import { useFactoryRuleDetail, type FactoryDetail, type FactoryRule } from '@/api/factory';
import { datasetPath } from '@/features/datasets/lib/route';
import { formatAgo } from '@/lib/dates';
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Skeleton,
  StatusMark,
  StructuredValue,
  Tag,
  Text,
  TextLink,
  UserName,
} from '@/ui';
import styles from './ReviewDialog.module.css';

export interface RuleViewDialogProps {
  factory: FactoryDetail;
  slug: string;
  /** The rule shown; null closes the dialog. */
  rule: FactoryRule | null;
  onClose: () => void;
  /** Its place in the list the dialog walks. */
  position?: { index: number; total: number };
  onNavigate?: (delta: -1 | 1) => void;
  canModify: boolean;
  canApprove: boolean;
  /** An action on this rule is in flight. */
  busy: boolean;
  onToggleOfficial: (rule: FactoryRule) => void;
  onEdit: (rule: FactoryRule) => void;
  onRemove: (rule: FactoryRule) => void;
}

export function RuleViewDialog({
  factory,
  slug,
  rule,
  onClose,
  position,
  onNavigate,
  canModify,
  canApprove,
  busy,
  onToggleOfficial,
  onEdit,
  onRemove,
}: RuleViewDialogProps) {
  const detail = useFactoryRuleDetail(factory.id, rule?.id ?? null);
  const evidence = detail.data?.evidence_items ?? [];
  const dataset = factory.dataset;
  const version = detail.data?.source_version?.version ?? factory.source_version?.version;
  const categories = rule
    ? rule.categories.length
      ? rule.categories
      : [{ id: rule.category_id, key: '', name: rule.category_name ?? '—' }]
    : [];
  return (
    <Dialog
      open={Boolean(rule)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={rule?.title ?? 'Rule'}
      description={
        rule
          ? rule.source === 'manual'
            ? 'Written by hand'
            : `Proposed by the agent${rule.evidence.length ? ` from ${rule.evidence.length} item${rule.evidence.length === 1 ? '' : 's'}` : ''}`
          : undefined
      }
      size="lg"
      data-testid="rule-view"
      footer={
        <>
          <span className={styles.footerStart}>
            {position && onNavigate ? (
              <>
                <IconButton
                  icon="prev"
                  label="Previous rule"
                  isDisabled={position.index <= 0}
                  onPress={() => onNavigate(-1)}
                  data-testid="rule-view-prev"
                />
                <span className={styles.position} aria-live="polite">
                  {position.index + 1} of {position.total}
                </span>
                <IconButton
                  icon="next"
                  label="Next rule"
                  isDisabled={position.index >= position.total - 1}
                  onPress={() => onNavigate(1)}
                  data-testid="rule-view-next"
                />
              </>
            ) : null}
          </span>
          {rule && canModify ? (
            <Button
              size="md"
              variant="danger"
              onPress={() => onRemove(rule)}
              isDisabled={busy || (rule.official && !canApprove)}
              disabledReason={
                rule.official && !canApprove ? 'An official rule is removed by someone with the approve level' : undefined
              }
              data-testid="rule-view-remove"
            >
              Remove
            </Button>
          ) : null}
          {rule && canModify ? (
            <Button size="md" variant="neutral" onPress={() => onEdit(rule)} isDisabled={busy} data-testid="rule-view-edit">
              Edit
            </Button>
          ) : null}
          {rule && canApprove ? (
            <Button
              size="md"
              variant={rule.official ? 'neutral' : 'primary'}
              onPress={() => onToggleOfficial(rule)}
              loading={busy}
              data-testid={rule.official ? 'rule-view-revoke' : 'rule-view-approve'}
            >
              {rule.official ? 'Take back' : 'Make official'}
            </Button>
          ) : null}
          <Button size="md" variant="neutral" onPress={onClose}>
            Close
          </Button>
        </>
      }
    >
      {rule ? (
        <div className={styles.view}>
          <div className={styles.facts} data-testid="rule-view-facts">
            {rule.official ? (
              <StatusMark tone="success" shape="check" label="Official" />
            ) : (
              <StatusMark tone="neutral" shape="dot" label="Proposed" />
            )}
            {categories.map((c) => (
              <Tag key={c.id} kind="config">
                {c.name}
              </Tag>
            ))}
            {rule.group_value ? (
              <Tag kind="dataset" title={factory.group_metadata_key ? `Group of ${factory.group_metadata_key}` : 'Group'}>
                {rule.group_value}
              </Tag>
            ) : (
              <Tag>Every item</Tag>
            )}
            {rule.kind === 'bridge' ? (
              <Tag tone="accent" title="A bridge extends an item into these groups">
                Bridge into {rule.bridge_to.join(', ') || '—'}
              </Tag>
            ) : null}
            {rule.official && rule.approved_by ? (
              <Text as="span" variant="sm" tone="muted">
                Official since {rule.approved_at ? formatAgo(rule.approved_at) : '—'} by{' '}
                <UserName id={rule.approved_by.id} name={rule.approved_by.display_name} email={rule.approved_by.email} />
              </Text>
            ) : null}
          </div>
          <section className={styles.section} aria-label="Rule">
            <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
              Rule
            </Text>
            {rule.description ? (
              <p className={styles.prose} dir="auto">
                {rule.description}
              </p>
            ) : (
              <p className={`${styles.prose} ${styles.muted}`}>No description: the title is the rule.</p>
            )}
          </section>
          {rule.body ? (
            <section className={styles.section} aria-label="Rule body">
              <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
                Body
              </Text>
              <StructuredValue value={rule.body} label="Rule body" toolbar={false} defaultOpen="all" />
            </section>
          ) : null}
          {rule.evidence.length ? (
            <section className={styles.section} aria-label="Evidence" data-testid="rule-view-evidence">
              <Text as="h3" variant="sm" weight={600} className={styles.sectionTitle}>
                Evidence · {rule.evidence.length} source item{rule.evidence.length === 1 ? '' : 's'}
                {version ? ` of ${version}` : ''}
              </Text>
              {detail.isPending ? (
                <Skeleton kind="lines" rows={3} label="Loading the evidence" />
              ) : detail.isError ? (
                <EmptyState compact title="Couldn’t load the evidence" />
              ) : (
                <ul className={styles.evidence}>
                  {evidence.map((item) => (
                    <li key={item.item_id} className={styles.evidenceItem} data-testid="rule-evidence-item">
                      <div className={styles.evidenceHead}>
                        <Text as="span" mono variant="sm">
                          {item.item_id}
                        </Text>
                        {!item.missing && dataset && !dataset.deleted && version ? (
                          <TextLink to={datasetPath(slug, dataset.slug, { v: version, item: item.item_id })}>
                            Open the item
                          </TextLink>
                        ) : null}
                      </div>
                      {item.missing ? (
                        <p className={`${styles.prose} ${styles.muted}`}>No longer in the source version.</p>
                      ) : (
                        <div className={styles.pair}>
                          <div className={styles.section}>
                            <Text as="span" variant="sm" tone="muted">
                              Input
                            </Text>
                            <StructuredValue value={item.input} label={`Input of ${item.item_id}`} toolbar={false} lines={8} />
                          </div>
                          <div className={styles.section}>
                            <Text as="span" variant="sm" tone="muted">
                              Expected output
                            </Text>
                            <StructuredValue
                              value={item.expected_output}
                              label={`Expected output of ${item.item_id}`}
                              toolbar={false}
                              lines={8}
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
