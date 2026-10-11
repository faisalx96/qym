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
}) {
  const { doc, setDoc, ctx, secrets, preview, launchErrors, launching } = args;
  const raw = useRawJson(doc, setDoc, ctx, secrets);
  const sections = useSections();
  const review: ReviewState = useMemo(
    () =>
      reviewState({
        doc,
        ctx,
        preview: preview.data,
        previewLoading: preview.loading,
        previewError: preview.error,
        launchErrors,
        launching,
        rawJsonErrors: raw.state.errors,
      }),
    [doc, ctx, preview, launchErrors, launching, raw.state.errors],
  );
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
