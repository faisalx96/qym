/** Modals of the runs list: review decision, submit, delete, transfer ownership, error details (brief 03 J4/J5). */
import {
  useDeletePasses,
  useDeleteRuns,
  useProjectMembers,
  useRunWorkflow,
  useSubmitRuns,
  useTransferOwner,
} from '@/api/dashboard';
import type { RunRow } from '@/api/dashboardTypes';
import { announceRunStatus } from '@/lib/run-status';
import { ApiError } from '@/lib/http';
import { ConfirmDialog, Dialog, FormDialog, KeyValueGrid, Text, Button, useToast } from '@/ui';
import { passNumber, passRefBase } from './selection';

export type DialogState =
  | { kind: 'workflow'; action: 'approve' | 'reject' | 'unapprove' | 'unreject'; row: RunRow }
  | { kind: 'submit'; rows: RunRow[] }
  | { kind: 'delete'; refs: string[]; names: string[] }
  | { kind: 'transfer'; row: RunRow }
  | { kind: 'errors'; row: RunRow }
  | null;

const WORKFLOW_COPY = {
  approve: {
    title: 'Approve run',
    confirm: 'Approve',
    tone: 'primary' as const,
    done: 'approved',
    help: 'Approved runs are locked and count as reference results.',
  },
  reject: {
    title: 'Reject run',
    confirm: 'Reject',
    tone: 'danger' as const,
    done: 'rejected',
    help: 'The owner is told why; the run can be unrejected later.',
  },
  unapprove: {
    title: 'Withdraw approval',
    confirm: 'Unapprove',
    tone: 'primary' as const,
    done: 'unapproved',
    help: 'The run returns to its execution result (Completed or Failed).',
  },
  unreject: {
    title: 'Withdraw rejection',
    confirm: 'Unreject',
    tone: 'primary' as const,
    done: 'unrejected',
    help: 'The run returns to its execution result (Completed or Failed).',
  },
};

function message(e: unknown): string {
  if (e instanceof ApiError) return e.detail || e.message;
  return e instanceof Error ? e.message : String(e);
}

export function RunDialogs({
  slug,
  projectId,
  state,
  onClose,
  onDeleted,
  onSubmitted,
}: {
  slug: string;
  projectId: string;
  state: DialogState;
  onClose: () => void;
  onDeleted: () => void;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const workflow = useRunWorkflow(slug);
  const submit = useSubmitRuns(slug);
  const del = useDeleteRuns(slug);
  const delPasses = useDeletePasses(slug);
  const transfer = useTransferOwner(slug);
  const members = useProjectMembers(state?.kind === 'transfer' ? projectId : undefined);
  const close = (o: boolean) => !o && onClose();
  const name = (r: RunRow) => r.external_run_id || r.run_name;

  const wf = state?.kind === 'workflow' ? state : null;
  const sub = state?.kind === 'submit' ? state : null;
  const rm = state?.kind === 'delete' ? state : null;
  const tr = state?.kind === 'transfer' ? state : null;
  const er = state?.kind === 'errors' ? state : null;
  const copy = wf ? WORKFLOW_COPY[wf.action] : WORKFLOW_COPY.approve;

  return (
    <>
      <FormDialog
        open={Boolean(wf)}
        onOpenChange={close}
        title={wf ? `${copy.title}: ${name(wf.row)}` : copy.title}
        description={copy.help}
        confirmLabel={copy.confirm}
        submittingLabel="Saving…"
        tone={copy.tone}
        fields={[
          {
            name: 'comment',
            label: 'Comment',
            type: 'textarea',
            rows: 3,
            placeholder: 'Optional note for the history',
            required: wf?.action === 'reject',
          },
        ]}
        onSubmit={async (v) => {
          if (!wf) return;
          try {
            const res = await workflow.mutateAsync({
              runId: wf.row.run_id,
              action: wf.action,
              comment: String(v.comment ?? ''),
            });
            toast.show(`${name(wf.row)} ${copy.done}`, { tone: 'success' });
            announceRunStatus([wf.row.run_id], res.status);
          } catch (e) {
            return message(e);
          }
        }}
      />
      <FormDialog
        open={Boolean(sub)}
        onOpenChange={close}
        title={
          sub && sub.rows.length === 1
            ? `Submit ${name(sub.rows[0]!)} for review`
            : `Submit ${sub?.rows.length ?? 0} runs for review`
        }
        description="Reviewers are asked to approve or reject. Runs stay read-only while submitted."
        confirmLabel="Submit"
        fields={[
          {
            name: 'comment',
            label: 'Comment',
            type: 'textarea',
            rows: 3,
            placeholder: 'Optional note for the reviewer',
          },
        ]}
        onSubmit={async (v) => {
          if (!sub) return;
          try {
            await submit.mutateAsync({
              runIds: sub.rows.map((r) => r.run_id),
              comment: String(v.comment ?? ''),
            });
            toast.show(
              sub.rows.length === 1 ? 'Submitted for review' : `${sub.rows.length} runs submitted for review`,
              { tone: 'success' },
            );
            onSubmitted();
          } catch (e) {
            return message(e);
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(rm)}
        onOpenChange={close}
        title={
          rm && rm.refs.length === 1 ? `Delete ${rm.names[0]}?` : `Delete ${rm?.refs.length ?? 0} selections?`
        }
        description="Whole runs move to Deleted Runs and can be restored by an admin within the retention window. Deleting a single pass is permanent."
        warning={
          rm
            ? {
                lead: 'This will delete:',
                items: rm.names.slice(0, 8).map((n) => ({ title: n })),
                more: Math.max(0, rm.names.length - 8),
              }
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!rm) return;
          const runIds = rm.refs.filter((r) => passNumber(r) === null);
          const passRefs = rm.refs.filter((r) => passNumber(r) !== null && !runIds.includes(passRefBase(r)));
          let failed = 0;
          if (runIds.length) {
            const res = await del.mutateAsync({ runIds });
            failed += res.failures.length;
          }
          const byRun = new Map<string, number[]>();
          for (const ref of passRefs)
            byRun.set(passRefBase(ref), [...(byRun.get(passRefBase(ref)) ?? []), passNumber(ref)!]);
          for (const [runId, passes] of byRun) {
            try {
              await delPasses.mutateAsync({ runId, passes });
            } catch {
              failed += passes.length;
            }
          }
          if (failed) toast.show(`${failed} could not be deleted`, { tone: 'error' });
          else toast.show('Deleted', { tone: 'success' });
          onDeleted();
        }}
      />
      <FormDialog
        open={Boolean(tr)}
        onOpenChange={close}
        title={tr ? `Transfer ${name(tr.row)}` : 'Transfer ownership'}
        description="The new owner can submit and delete this run."
        confirmLabel="Transfer"
        fields={[
          {
            name: 'user',
            label: 'New owner',
            type: 'select',
            required: true,
            options: (members.data?.members ?? [])
              .filter((m) => m.is_active && m.user_id !== tr?.row.owner?.id)
              .map((m) => ({ value: m.user_id, label: `${m.display_name || m.email} (${m.email})` })),
          },
        ]}
        onSubmit={async (v) => {
          if (!tr) return;
          try {
            await transfer.mutateAsync({ runId: tr.row.run_id, userId: String(v.user) });
            toast.show('Ownership transferred', { tone: 'success' });
          } catch (e) {
            return message(e);
          }
        }}
      />
      <Dialog
        open={Boolean(er)}
        onOpenChange={close}
        title={er ? `Errors in ${name(er.row)}` : 'Errors'}
        size="sm"
        footer={
          <Button variant="neutral" onPress={onClose}>
            Close
          </Button>
        }
      >
        {er ? <ErrorDetails row={er.row} /> : null}
      </Dialog>
    </>
  );
}

function ErrorDetails({ row }: { row: RunRow }) {
  const scope = row.samples > 1 ? 'across all passes' : 'across all items';
  const perMetric = Object.entries(row.metric_error_counts ?? {}).filter(([, n]) => n > 0);
  return (
    <>
      <KeyValueGrid
        columns={1}
        dense
        aria-label="Error counts"
        items={[
          {
            key: 'task',
            label: `Task errors ${scope}`,
            value: String(row.task_error_count ?? row.execution_error_count ?? 0),
            mono: true,
          },
          {
            key: 'metric',
            label: `Metric errors ${scope}`,
            value: String(row.metric_error_count ?? 0),
            mono: true,
          },
          ...perMetric.map(([m, n]) => ({ key: `m-${m}`, label: `  ${m}`, value: String(n), mono: true })),
          { key: 'retries', label: 'Total retries', value: String(row.total_retries ?? 0), mono: true },
        ]}
      />
      <Text variant="sm" tone="muted" as="p">
        Open the run to see each failing item with its message.
      </Text>
    </>
  );
}
