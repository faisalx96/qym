/** Batch confirm dialog (spec A3-27 to A3-42): dry run first, then apply with the count it showed. */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  postItemsBatch,
  useItemsBatch,
  type BatchAction,
  type BatchFilterBody,
  type BatchResponse,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { Button, Dialog, Skeleton, Tag, Text, TextField, Textarea, useToast } from '@/ui';
import { Note } from '../components/Note';
import {
  batchButtonLabel,
  batchSentence,
  batchTitle,
  batchToast,
  needsTypedConfirm,
  sampleIds,
  typedConfirmMatches,
  type BatchCriteria,
} from '../lib/batchCopy';
import { metaFiltersToObject } from '../lib/metaFilter';
import styles from './BatchDialog.module.css';

const REASON_MAX = 500;
const CHANGED = 'The matching items changed. Review the new count and try again.';

type Phase = 'checking' | 'ready' | 'check-error' | 'applying';

export interface BatchDialogProps {
  slug: string;
  datasetRef: string;
  version: string;
  action: BatchAction;
  criteria: BatchCriteria;
  /** the picked rows' ids (selected-rows batch); filters are ignored */
  itemIds?: string[];
  /** items in the version, for "of {total}" */
  total: number;
  onClose: () => void;
  onApplied: (response: BatchResponse) => void;
}

function bodyFor(action: BatchAction, criteria: BatchCriteria, itemIds?: string[]): BatchFilterBody {
  const state = action === 'disable' ? 'active' : action === 'enable' ? 'disabled' : 'all';
  if (itemIds) return { item_ids: itemIds, state };
  return {
    search: criteria.search || undefined,
    label: criteria.label || undefined,
    meta: criteria.meta.length ? metaFiltersToObject(criteria.meta) : undefined,
    state,
  };
}

export function BatchDialog({
  slug,
  datasetRef,
  version,
  action,
  criteria,
  itemIds,
  total,
  onClose,
  onApplied,
}: BatchDialogProps) {
  const batch = useItemsBatch(slug, datasetRef, version);
  const toast = useToast();
  const [applying, setApplying] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  // The dry run: what would change, without writing (a fresh request each time the dialog opens).
  const dry = useQuery({
    queryKey: ['dataset-batch-dry-run', slug, datasetRef, version, action, criteria, itemIds],
    queryFn: () =>
      postItemsBatch(slug, datasetRef, version, {
        filter: bodyFor(action, criteria, itemIds),
        action,
        dry_run: true,
      }),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const result = dry.data ?? null;
  const nothingToDo =
    (dry.data !== undefined && dry.data.affected === 0) ||
    (dry.error instanceof ApiError &&
      dry.error.status === 422 &&
      /No items match/i.test(dry.error.detail || ''));
  useEffect(() => {
    if (!nothingToDo) return;
    toast.show('No items to change', { tone: 'info' });
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nothingToDo]);

  const phase: Phase = applying
    ? 'applying'
    : dry.isFetching
      ? 'checking'
      : dry.isError
        ? 'check-error'
        : 'ready';
  const recheck = () => {
    setError(null);
    setChanged(false);
    void dry.refetch();
  };

  const affected = result?.affected ?? 0;
  const typedRequired = needsTypedConfirm(action, affected);
  const armed = phase === 'ready' && !changed && (!typedRequired || typedConfirmMatches(typed, affected));
  const busy = phase === 'applying';

  async function apply() {
    if (!result) return;
    if (changed) {
      recheck();
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const r = await batch.mutateAsync({
        filter: bodyFor(action, criteria, itemIds),
        action,
        reason: action === 'disable' ? reason.trim() || undefined : undefined,
        dry_run: false,
        expected_affected: result.affected,
      });
      if (r.affected === 0) toast.show('No change: the items were already in that state', { tone: 'info' });
      else toast.show(batchToast(action, r.affected), { tone: 'success' });
      onApplied(r);
      onClose();
    } catch (e) {
      setApplying(false);
      if (
        e instanceof ApiError &&
        e.status === 409 &&
        (e.detail || '').startsWith('The matching items changed')
      ) {
        setChanged(true);
        setError(CHANGED);
      } else setError(e instanceof ApiError ? e.detail || e.message : 'Couldn’t apply the change.');
    }
  }

  const title = phase === 'checking' ? 'Checking matching items…' : batchTitle(action, affected);
  const label = batchButtonLabel(action, affected);
  const ids = result ? sampleIds(result.sample_item_ids, result.affected) : { ids: [], more: 0 };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={title}
      size="lg"
      role={action === 'delete' ? 'alertdialog' : 'dialog'}
      isKeyboardDismissDisabled={busy}
      dismissOnBackdrop={!busy}
      initialFocus={action === 'delete' ? cancel : undefined}
      data-testid="da-modal"
      footer={
        <>
          <Button ref={cancel} variant="neutral" size="md" onPress={onClose} isDisabled={busy}>
            Cancel
          </Button>
          <Button
            variant={action === 'delete' ? 'danger' : 'primary'}
            size="md"
            loading={busy}
            isDisabled={changed ? false : !armed}
            onPress={() => void apply()}
            data-testid="batch-confirm"
          >
            {phase === 'checking' || phase === 'check-error'
              ? label || batchButtonLabel(action, 0)
              : changed
                ? 'Review again'
                : label}
          </Button>
        </>
      }
    >
      {phase === 'checking' ? (
        <Skeleton kind="lines" rows={4} label="Checking matching items" />
      ) : phase === 'check-error' ? (
        <div className={styles.stack}>
          <p className={styles.error} role="alert">
            Couldn’t check the matching items. Try again.
          </p>
          <div>
            <Button variant="accent" size="md" onPress={recheck}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.stack}>
          <div className={styles.bigNumber} data-testid="batch-numbers">
            <strong>{affected}</strong>
            <Text variant="base" tone="secondary" as="span">
              {batchSentence(action, criteria, affected, total)}
            </Text>
          </div>
          <div data-testid="batch-ids">
            <Text variant="sm" weight={650} tone="muted" as="p">
              First items
            </Text>
            <ul className={styles.idList}>
              {ids.ids.map((id) => (
                <li key={id}>
                  <Tag kind="data">{id}</Tag>
                </li>
              ))}
              {ids.more > 0 ? (
                <li>
                  <Text variant="sm" tone="muted" as="span">
                    and {ids.more} more
                  </Text>
                </li>
              ) : null}
            </ul>
          </div>
          {action === 'disable' ? (
            <>
              <Textarea
                label="Reason (optional)"
                rows={2}
                value={reason}
                onChange={(v) => setReason(v.slice(0, REASON_MAX))}
                maxLength={REASON_MAX}
                dir="auto"
                help={
                  <span className={styles.counter} data-testid="reason-counter">
                    {reason.length} / {REASON_MAX}
                  </span>
                }
              />
              <Text variant="base" tone="secondary" as="p">
                The items stay in this draft and are left out of runs once it is published.
              </Text>
            </>
          ) : null}
          {action === 'enable' ? (
            <Text variant="base" tone="secondary" as="p">
              The items are included in runs again once this draft is published.
            </Text>
          ) : null}
          {action === 'delete' ? (
            <Note tone="danger" title="This removes the items from this draft">
              <span>Published versions keep their copy.</span>
            </Note>
          ) : null}
          {typedRequired ? (
            <TextField
              label={`Type ${affected} to confirm`}
              value={typed}
              onChange={setTyped}
              placeholder={String(affected)}
              mono
              errorMessage={
                typed.trim() && !typedConfirmMatches(typed, affected) ? 'The text does not match.' : undefined
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (armed) void apply();
                }
              }}
            />
          ) : null}
          {error ? (
            <p className={styles.error} role="alert" data-testid={changed ? 'batch-changed' : undefined}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
