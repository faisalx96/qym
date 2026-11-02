/**
 * The debounced (600 ms), abortable, generation-guarded dry run behind the review pane. The
 * request body is built when the timer fires, from the latest document; a response only counts
 * if it answers the current `dryRunKey`, so a slow answer to an older form never shows.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/http';
import { errorMessage } from '@/api/evalCommon';
import { postExperiment } from '@/api/launch';
import {
  buildLaunchRequest,
  dryRunKey,
  parseLaunchFailure,
  type DryRunResponse,
  type EvaluatorPanel,
  type LaunchDocument,
  type SecretStore,
  type ServerError,
} from '../model';
import type { PreviewState } from '../types';

export const DRY_RUN_DEBOUNCE_MS = 600;
const FIRST_DELAY_MS = 120;

interface Settled {
  key: string;
  data: DryRunResponse | null;
  error: string;
}

/** A 422 with `detail.errors` is a dry run that found problems (sweep cap errors carry the counts). */
function fromValidation(detail: unknown, errors: ServerError[]): DryRunResponse {
  const d = (detail && typeof detail === 'object' ? detail : {}) as Partial<DryRunResponse>;
  return { ...d, dry_run: true, ok: false, errors } as DryRunResponse;
}

export function useDryRun(args: {
  projectId: string;
  doc: LaunchDocument;
  panel: EvaluatorPanel | null;
  secrets: SecretStore;
  enabled: boolean;
}): { preview: PreviewState; key: string } {
  const { projectId, doc, panel, secrets, enabled } = args;
  const key = useMemo(() => dryRunKey(doc, panel), [doc, panel]);
  const [settled, setSettled] = useState<Settled | null>(null);
  const latest = useRef({ doc, panel });
  useEffect(() => {
    latest.current = { doc, panel };
  });
  const hadResult = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        const body = buildLaunchRequest(latest.current.doc, secrets, { dryRun: true }, latest.current.panel);
        postExperiment(projectId, body, abort.signal).then(
          (data) => {
            if (abort.signal.aborted) return;
            hadResult.current = true;
            setSettled({ key, data, error: '' });
          },
          (error: unknown) => {
            if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
              return;
            hadResult.current = true;
            if (error instanceof ApiError) {
              const failure = parseLaunchFailure(error.status, error.body);
              if (failure.kind === 'validation') {
                const detail = (error.body as { detail?: unknown } | null)?.detail;
                setSettled({ key, data: fromValidation(detail, failure.errors), error: '' });
                return;
              }
            }
            setSettled({ key, data: null, error: errorMessage(error) || 'The preview failed' });
          },
        );
      },
      hadResult.current ? DRY_RUN_DEBOUNCE_MS : FIRST_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, enabled, projectId, secrets]);

  const preview: PreviewState = {
    data: settled?.data ?? null,
    loading: enabled && settled?.key !== key,
    error: settled?.key === key ? settled.error : '',
  };
  return { preview, key };
}
