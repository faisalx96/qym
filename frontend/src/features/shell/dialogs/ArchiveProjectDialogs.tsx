import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchArchivePreview,
  fetchDeletionPreview,
  fetchUnarchivePreview,
  useArchiveProject,
  useDeleteProject,
  useUnarchiveProject,
} from '@/api/projects';
import type { ArchivePreview, DeletionPreview, Project, UnarchivePreview } from '@/api/types';
import { ApiError } from '@/lib/http';
import { ConfirmDialog, useToast, type ConfirmWarning } from '@/ui';
import { projectPath } from '@/app/routes';

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.detail || `HTTP ${e.status}` : e instanceof Error ? e.message : String(e);
}

/** Archive: previews running runs, then POST …/archive, toast, navigate home. */
type ProjectDialogProps = { project: Project; open: boolean; onOpenChange: (o: boolean) => void };

export function ArchiveProjectDialog(props: ProjectDialogProps) {
  // Mounted only while open so preview state resets without effects.
  return props.open ? <ArchiveProjectDialogInner {...props} /> : null;
}

function ArchiveProjectDialogInner({ project, open, onOpenChange }: ProjectDialogProps) {
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const archive = useArchiveProject();
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    fetchArchivePreview(project.id)
      .then(setPreview)
      .catch(() => setPreview({ running_count: 0, running_runs: [] }));
  }, [project.id]);
  const warning: ConfirmWarning | undefined = preview?.running_count
    ? {
        lead: `${preview.running_count} run${preview.running_count === 1 ? ' is' : 's are'} still running`,
        text: 'They will be stopped.',
        items: preview.running_runs
          .slice(0, 5)
          .map((r) => ({ title: r.run_name || r.run_id, meta: r.started_at })),
        more: Math.max(0, preview.running_count - 5),
      }
    : undefined;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive “${project.name}”?`}
      tone="danger"
      description={[
        'Members keep read access; nothing can be changed until an admin unarchives it.',
        'API keys stop working.',
      ]}
      warning={warning}
      confirmLabel="Archive project"
      onConfirm={async () => {
        try {
          await archive.mutateAsync(project);
          toast.show(`${project.name} archived`, { tone: 'info' });
          navigate('/');
        } catch (e) {
          throw new Error(errorText(e));
        }
      }}
    />
  );
}

/** Unarchive: previews active API keys; alt action jumps to the keys tab. */
export function UnarchiveProjectDialog(props: ProjectDialogProps) {
  return props.open ? <UnarchiveProjectDialogInner {...props} /> : null;
}

function UnarchiveProjectDialogInner({ project, open, onOpenChange }: ProjectDialogProps) {
  const [preview, setPreview] = useState<UnarchivePreview | null>(null);
  const unarchive = useUnarchiveProject();
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    fetchUnarchivePreview(project.id)
      .then(setPreview)
      .catch(() => setPreview({ active_api_key_count: 0, active_api_keys: [] }));
  }, [project.id]);
  const keys = preview?.active_api_key_count ?? 0;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Unarchive “${project.name}”?`}
      tone="accent"
      description="Members can change the project again."
      warning={
        keys
          ? {
              lead: `${keys} API key${keys === 1 ? '' : 's'} will work again`,
              items: preview!.active_api_keys.slice(0, 5).map((k) => ({
                title: k.name,
                meta:
                  typeof k.creator === 'string'
                    ? k.creator
                    : (k.creator?.display_name ?? k.creator?.email ?? ''),
              })),
              more: Math.max(0, keys - 5),
            }
          : undefined
      }
      confirmLabel="Unarchive"
      altLabel={keys ? 'Revoke keys first' : undefined}
      onAlternative={
        keys ? () => navigate(`${projectPath(project.slug, 'settings')}?tab=apikeys`) : undefined
      }
      onConfirm={async () => {
        try {
          await unarchive.mutateAsync(project);
          toast.show(`${project.name} is active again`, { tone: 'success' });
        } catch (e) {
          throw new Error(errorText(e));
        }
      }}
    />
  );
}

/** Delete: deletion preview; blocked → offer Archive / Deleted runs; else typed confirm. */
type DeleteDialogProps = ProjectDialogProps & { onArchiveInstead: () => void };

export function DeleteProjectDialog(props: DeleteDialogProps) {
  return props.open ? <DeleteProjectDialogInner {...props} /> : null;
}

function DeleteProjectDialogInner({ project, open, onOpenChange, onArchiveInstead }: DeleteDialogProps) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const del = useDeleteProject();
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    fetchDeletionPreview(project.id)
      .then(setPreview)
      .catch((e) =>
        setPreview({
          project_id: project.id,
          name: project.name,
          slug: project.slug,
          archived: !project.is_active,
          counts: {},
          can_delete: false,
          blocked_reason: errorText(e),
        }),
      );
  }, [project]);
  const counts = Object.entries(preview?.counts ?? {}).filter(([, n]) => n > 0);
  if (preview && !preview.can_delete) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`“${project.name}” cannot be deleted yet`}
        tone="danger"
        description={preview.blocked_reason ?? 'The project still has runs.'}
        cancelLabel="Close"
        confirmLabel={project.is_active ? 'Archive instead' : 'Open deleted runs'}
        onConfirm={() => {
          onOpenChange(false);
          if (project.is_active) onArchiveInstead();
          else navigate(`/trash?project=${encodeURIComponent(project.slug)}`);
        }}
      />
    );
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${project.name}”?`}
      tone="danger"
      description="This permanently deletes the project and everything in it. This cannot be undone."
      warning={
        counts.length
          ? {
              lead: 'This will also delete',
              items: counts.map(([k, n]) => ({ title: k.replace(/_/g, ' '), meta: String(n) })),
            }
          : undefined
      }
      requireText={project.name}
      inputLabel={`Type “${project.name}” to confirm`}
      confirmLabel="Delete project"
      onConfirm={async () => {
        try {
          await del.mutateAsync({ project, confirm: project.name });
          toast.show(`${project.name} deleted`, { tone: 'info' });
          navigate('/');
        } catch (e) {
          throw new Error(errorText(e));
        }
      }}
    />
  );
}
