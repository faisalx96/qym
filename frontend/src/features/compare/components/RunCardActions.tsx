/**
 * The review action of a compared run (K1, C034, owner note Nov 1): the run header's pattern, one neutral "Actions"
 * menu whose items carry their action tile (Submit, Resubmit, Approve, Reject, Unapprove, Unreject for the viewer's
 * role). The baseline card has none. The dialogs are the runs list's own (RunDialogs).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { compareKeys } from '@/api/compare';
import type { RunRow } from '@/api/dashboardTypes';
import { useProject } from '@/api/projects';
import { useAuth } from '@/features/shell';
import { RunDialogs, type DialogState } from '@/features/runs-list/RunDialogs';
import { runActionItems, type RunActionId } from '@/features/run-detail/lib/runActions';
import type { Run } from '@/features/run-detail/types';
import { ActionTile, Button, DropdownMenu, Icon, type MenuItemSpec } from '@/ui';

const REVIEW: ReadonlySet<RunActionId> = new Set([
  'resubmit',
  'submit',
  'approve',
  'reject',
  'unapprove',
  'unreject',
]);

export function RunCardActions({ run, name }: { run: Run; name: string }) {
  const { me, isAdmin } = useAuth();
  const slug = run.project?.slug ?? undefined;
  const project = useProject(slug, me).data;
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  if (!slug || !project) return null;
  const items = runActionItems(run.status, {
    isOwner: !!run.owner?.id && run.owner.id === me.id,
    canManage: isAdmin || project.role === 'MANAGER',
    isAdmin,
    readOnly: !project.is_active || !!run.project?.archived,
  }).filter((it) => REVIEW.has(it.id));
  if (!items.length) return null;
  const row = {
    run_id: run.run_id,
    run_name: run.run_name || run.run_id,
    external_run_id: run.external_run_id ?? null,
    owner: run.owner ?? null,
    status: run.status,
  } as unknown as RunRow;
  const menu: MenuItemSpec[] = items.map((it) => ({
    id: it.id,
    label: it.label,
    tone: it.tone,
    icon: <ActionTile icon={it.icon} tone={it.tone === 'danger' ? 'danger' : 'default'} />,
  }));
  const onAction = (id: string) => {
    const action = id as RunActionId;
    if (action === 'submit' || action === 'resubmit') setDialog({ kind: 'submit', rows: [row] });
    else if (action === 'approve' || action === 'reject' || action === 'unapprove' || action === 'unreject')
      setDialog({ kind: 'workflow', action, row });
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: compareKeys.all });
  return (
    <>
      <DropdownMenu
        label={`Actions for ${name}`}
        trigger={
          <Button
            size="sm"
            variant="neutral"
            icon={<Icon name="more" size={14} />}
            data-testid="compare-run-actions"
          >
            Actions
          </Button>
        }
        items={menu}
        onAction={onAction}
      />
      <RunDialogs
        slug={slug}
        projectId={project.id}
        state={dialog}
        onClose={() => {
          setDialog(null);
          refresh();
        }}
        onDeleted={refresh}
        onSubmitted={refresh}
      />
    </>
  );
}
