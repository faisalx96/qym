/**
 * The derived, network-free half of the launch state, shared by the real provider and the test
 * provider: Raw JSON editor state, section frame state, the review (validation list, run count,
 * status) and per-section summaries.
 */
import { useCallback, useMemo } from 'react';
import {
  changedSlots,
  reviewState,
  stepChangeCount,
  type FormContext,
  type LaunchDocument,
  type ReviewState,
  type SecretStore,
  type ServerError,
  changedPointers,
  editorReviewItems,
  type RebindItem,
} from '../model';
import type { PreviewState, SectionId, SectionSummary } from '../types';
import { sectionOfItem } from '../types';
import { useRawJson } from './useRawJson';
import { useSections } from './useSections';

export function useLaunchView(args: {
  doc: LaunchDocument;
  setDoc: (updater: (d: LaunchDocument) => LaunchDocument) => void;
  ctx: FormContext;
  secrets: SecretStore;
  preview: PreviewState;
  launchErrors: readonly ServerError[] | null;
  launching: boolean;
  /** Default-preset editor: launch-only checks are replaced by the editor's (see model/editor.ts). */
  editor?: { rebind: readonly RebindItem[] } | null;
}) {
  const { doc, setDoc, ctx, secrets, preview, launchErrors, launching, editor } = args;
  const raw = useRawJson(doc, setDoc, ctx, secrets);
  const sections = useSections();
  const review: ReviewState = useMemo(() => {
    const base = reviewState({
      doc,
      ctx,
      preview: preview.data,
      previewLoading: preview.loading,
      previewError: preview.error,
      launchErrors,
      launching,
      rawJsonErrors: raw.state.errors,
    });
    if (!editor) return base;
    const items = editorReviewItems(base.items, doc, ctx, editor.rebind);
    return {
      ...base,
      items,
      status: items.length
        ? `${items.length} problem${items.length === 1 ? '' : 's'} to fix`
        : 'Ready to publish',
      canLaunch: doc.environmentIds.length > 0,
    };
  }, [doc, ctx, preview, launchErrors, launching, raw.state.errors, editor]);
  const changes = useMemo<Record<SectionId, number>>(
    () => ({
      models: changedSlots(doc).length,
      settings: changedPointers(doc).length,
      sweeps: 0,
      evaluation: stepChangeCount(doc, ctx, 'eval'),
      raw: 0,
    }),
    [doc, ctx],
  );
  const sectionSummary = useCallback(
    (id: SectionId): SectionSummary => ({
      changes: changes[id],
      problems: review.items.filter((item) => sectionOfItem(item) === id),
    }),
    [changes, review.items],
  );
  return { raw, review, sectionSummary, ...sections };
}
