/** Rename / edit description from the hero (PATCH /v1/datasets/{ref}). */
import { usePatchDataset, type Dataset } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { FormDialog, useToast } from '@/ui';

export function InlineEditDialog({
  open,
  onOpenChange,
  slug,
  dataset,
  field,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  field: 'name' | 'description';
}) {
  const patch = usePatchDataset(slug, dataset.slug);
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={field === 'name' ? 'Rename dataset' : 'Edit description'}
      confirmLabel="Save"
      fields={
        field === 'name'
          ? [{ name: 'name', label: 'Name', value: dataset.name, required: true, autoFocus: true }]
          : [
              {
                name: 'description',
                label: 'Description',
                type: 'textarea',
                rows: 3,
                value: dataset.description ?? '',
                autoFocus: true,
              },
            ]
      }
      onSubmit={async (values) => {
        try {
          await patch.mutateAsync(
            field === 'name'
              ? { name: String(values.name).trim() }
              : { description: String(values.description ?? '').trim() },
          );
          toast.show(field === 'name' ? 'Dataset renamed' : 'Description saved', { tone: 'success' });
        } catch (e) {
          return e instanceof ApiError ? e.detail || e.message : (e as Error).message;
        }
      }}
    />
  );
}
