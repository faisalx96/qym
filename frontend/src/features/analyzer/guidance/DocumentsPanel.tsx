import { useCallback, useRef, useState } from 'react';
import {
  errorDetail,
  useAnalysisDocuments,
  useDeleteDocument,
  useToggleDocument,
  useUploadDocument,
  type AnalysisScope,
  type AnalysisDocument,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  SectionHeader,
  Skeleton,
  Switch,
  Text,
  useToast,
} from '@/ui';
import s from './guidance.module.css';

interface Confirm {
  file: File;
  characters: number;
  resolve: (full: boolean) => void;
}

const ACCEPT = '.pdf,.docx,.txt,.text,.log,.rst,.md,.markdown,.html,.htm,.csv,.json,.yaml,.yml';

export function DocumentsPanel({
  scope,
  canManage,
  uploadLimitBytes,
}: {
  scope: AnalysisScope;
  canManage: boolean;
  uploadLimitBytes?: number | null;
}) {
  const docs = useAnalysisDocuments(scope);
  const showSkeleton = useDelayedPending(docs.isPending);
  const upload = useUploadDocument(scope);
  const toggle = useToggleDocument(scope);
  const remove = useDeleteDocument(scope);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [deleting, setDeleting] = useState<AnalysisDocument | null>(null);

  const uploadOne = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        await upload.mutateAsync({ file });
        return true;
      } catch (e) {
        const detail = errorDetail(e);
        if (e instanceof ApiError && e.status === 409 && detail?.code === 'DOCUMENT_CONTENT_CONFIRMATION') {
          const full = await new Promise<boolean>((resolve) =>
            setConfirm({ file, characters: Number(detail.source_characters ?? 0), resolve }),
          );
          if (!full) return false;
          try {
            await upload.mutateAsync({ file, full: true });
            return true;
          } catch (again) {
            toast.show(`${file.name}: ${again instanceof ApiError ? again.detail : 'upload failed'}`, {
              tone: 'error',
            });
            return false;
          }
        }
        const reason =
          e instanceof ApiError
            ? e.status === 413
              ? 'larger than the upload limit'
              : e.status === 415
                ? 'unsupported file type'
                : e.detail || 'upload failed'
            : 'upload failed';
        toast.show(`${file.name}: ${reason}`, { tone: 'error' });
        return false;
      }
    },
    [upload, toast],
  );

  const onFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (!list.length || !canManage) return;
      setUploading(true);
      let added = 0;
      for (const [index, file] of list.entries()) {
        setStatus(`Uploading ${file.name} (${index + 1} of ${list.length})`);
        if (await uploadOne(file)) added += 1; // sequential on purpose: server-side size/limit checks
      }
      setUploading(false);
      setStatus(
        added
          ? `Added ${added} of ${list.length} ${list.length === 1 ? 'document' : 'documents'}.`
          : 'No documents were added.',
      );
      if (input.current) input.current.value = '';
    },
    [canManage, uploadOne],
  );

  const documents = docs.data?.documents ?? [];
  const enabled = documents.filter((d) => d.selected);
  const characters = enabled.reduce((n, d) => n + (d.characters ?? 0), 0);
  const limitMb = uploadLimitBytes ? Math.round(uploadLimitBytes / (1024 * 1024)) : 10;

  return (
    <div className={s.docs}>
      <SectionHeader
        title="Reference documents"
        description="Documents the analyzer can use as context, and the rule writer as a source."
        aside={
          documents.length ? (
            <Badge tone="info">{`${enabled.length} of ${documents.length} enabled`}</Badge>
          ) : null
        }
      />
      {canManage ? (
        <div
          className={s.dropzone}
          data-dragging={dragging ? '' : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onFiles(e.dataTransfer.files);
          }}
        >
          <Icon name="plus" size={16} />
          <Text variant="md" weight={600}>
            Choose documents or drop them here
          </Text>
          <Text variant="sm" tone="muted">
            {`PDF, DOCX, TXT, Markdown, HTML, CSV, JSON or YAML · up to ${limitMb} MB each · text above 40,000 characters asks before it is sent in full`}
          </Text>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            aria-label="Upload documents"
            data-testid="document-input"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Button size="sm" loading={uploading} onPress={() => input.current?.click()}>
            Choose files
          </Button>
        </div>
      ) : (
        <Text variant="sm" tone="muted" as="p" role="note">
          Only project managers can add, remove or exclude documents.
        </Text>
      )}
      <Text variant="sm" tone="muted" as="p" role="status" aria-live="polite">
        {status ?? ''}
      </Text>

      {docs.isError ? (
        <ErrorState
          error={docs.error}
          title="Couldn’t load documents"
          onRetry={() => docs.refetch()}
          compact
        />
      ) : docs.isPending ? (
        showSkeleton ? (
          <Skeleton kind="lines" rows={3} label="Loading documents" />
        ) : null
      ) : documents.length === 0 ? (
        <EmptyState
          compact
          title="No project documents yet"
          body="Add a document and it becomes available to every analysis in this project."
        />
      ) : (
        <>
          <ul className={s.docList} aria-label="Document library">
            {documents.map((d) => (
              <li key={d.id} className={s.doc}>
                <Icon name="book" size={14} />
                <div className={s.docMain}>
                  <Text variant="md" weight={600} truncate>
                    {d.name}
                  </Text>
                  <Text variant="sm" tone="muted">
                    {`${(d.characters ?? 0).toLocaleString()} characters`}
                    {d.content_over_limit ? ' · over the provider limit' : ''}
                  </Text>
                </div>
                <Switch
                  isSelected={d.selected}
                  isDisabled={!canManage}
                  aria-label={`${d.name}: ${d.selected ? 'included' : 'excluded'}`}
                  onChange={(selected) =>
                    toggle.mutate(
                      { id: d.id, selected },
                      { onError: () => toast.show(`Could not update ${d.name}`, { tone: 'error' }) },
                    )
                  }
                >
                  {d.selected ? 'Included' : 'Excluded'}
                </Switch>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${d.name}`}
                    onPress={() => setDeleting(d)}
                  >
                    <Icon name="trash" size={12} />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <Text variant="sm" tone="muted" as="p">
            {`Selected document content: ${characters.toLocaleString()} characters across ${enabled.length} ${enabled.length === 1 ? 'document' : 'documents'}. The analyzer sends all retained content without shortening.`}
          </Text>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && confirm) {
            confirm.resolve(false);
            setConfirm(null);
          }
        }}
        title="Send the full document?"
        description={
          confirm
            ? [
                `${confirm.file.name} has ${confirm.characters.toLocaleString()} characters.`,
                'Large documents make every analysis prompt longer. If the selected provider cannot accept the whole prompt it reports context_limit_exceeded.',
              ]
            : undefined
        }
        cancelLabel="Skip this document"
        confirmLabel="Upload in full"
        onConfirm={() => {
          confirm?.resolve(true);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete document?"
        description={
          deleting
            ? `${deleting.name} will be removed from this project and from future analyses.`
            : undefined
        }
        tone="danger"
        confirmLabel="Delete document"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.show('Document deleted', { tone: 'success' });
          } catch (e) {
            toast.show(
              e instanceof ApiError
                ? e.detail || 'Could not delete the document'
                : 'Could not delete the document',
              {
                tone: 'error',
              },
            );
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
