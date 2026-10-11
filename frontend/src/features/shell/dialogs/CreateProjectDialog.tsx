import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateProject } from '@/api/projects';
import { ApiError } from '@/lib/http';
import { FormDialog, useToast } from '@/ui';
import { projectPath } from '@/app/routes';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Name + slug (slug derived from the name until edited); navigates to the new project. */
export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const create = useCreateProject();
  const navigate = useNavigate();
  const toast = useToast();
  const slugEdited = useRef(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create project"
      description="Projects group runs, datasets and members. The slug becomes part of every URL."
      confirmLabel="Create project"
      submittingLabel="Creating…"
      fields={[
        { name: 'name', label: 'Name', required: true, autoFocus: true, placeholder: 'Customer support bot' },
        { name: 'slug', label: 'Slug', mono: true, placeholder: 'customer-support-bot', help: 'Lowercase letters, digits and dashes.' },
      ]}
      onChange={(values, changed) => {
        if (changed === 'slug') slugEdited.current = true;
        if (changed === 'name' && !slugEdited.current) return { ...values, slug: slugify(String(values.name)) };
        return undefined;
      }}
      onSubmit={async (values) => {
        try {
          const project = await create.mutateAsync({ name: String(values.name).trim(), slug: String(values.slug).trim() || undefined });
          toast.show(`Created ${project.name}`, { tone: 'success' });
          navigate(projectPath(project.slug));
        } catch (e) {
          if (e instanceof ApiError) return e.detail || 'Could not create the project.';
          throw e;
        }
      }}
    />
  );
}
