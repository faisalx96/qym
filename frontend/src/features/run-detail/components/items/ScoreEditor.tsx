/** Inline score edit / reset with the pass-version lock (brief 04 J8 / §3l). */
import { useEffect, useRef, useState } from 'react';
import { useUpdateMetric } from '@/api/runs';
import { ApiError } from '@/lib/http';
import { parseMetricScoreInput, type MetricSpec } from '@/lib/metrics';
import { Button, TextField } from '@/ui';
import type { Row } from '../../types';
import styles from './MetricStrip.module.css';

export interface ScoreEditorProps {
  runId: string;
  filePath: string;
  row: Row;
  metric: string;
  spec: MetricSpec | undefined;
  /** Current value shown in the box. */
  initial: string;
  passNumber: number | null;
  passVersion: number;
  reduced?: boolean;
  edited: boolean;
  onDone: () => void;
}

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Scores are locked for this run (submitted or approved).';
    if (error.status === 409)
      return error.detail || 'The scores changed elsewhere. Reload the page and try again.';
    return error.detail || error.message;
  }
  return error instanceof Error ? error.message : 'Could not save the score.';
}

/**
 * Give focus back to the control that opened an inline editor when the editor goes away
 * (save, cancel, Escape); otherwise it unmounts with focus and keyboard users land on <body>.
 */
export function useRestoreFocus(): void {
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const el = opener.current;
    return () => {
      const active = document.activeElement;
      if (el instanceof HTMLElement && el.isConnected && (!active || active === document.body)) el.focus();
    };
  }, []);
}

export function ScoreEditor({
  runId,
  filePath,
  row,
  metric,
  spec,
  initial,
  passNumber,
  passVersion,
  reduced,
  edited,
  onDone,
}: ScoreEditorProps) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState('');
  const mutation = useUpdateMetric(runId);
  useRestoreFocus();
  // `isPending` only flips after the next render; two clicks in one frame would both pass it.
  const inFlight = useRef(false);
  const base = {
    file_path: filePath,
    row_index: row.index,
    metric_name: metric,
    ...(passNumber ? { pass_number: passNumber, expected_pass_version: passVersion } : {}),
  };
  const save = () => {
    if (inFlight.current) return; // a double click / double Enter must not post twice
    // Saving the number that is already there would only mark the score as edited.
    if (value.trim() === initial.trim() && value.trim() !== '') {
      onDone();
      return;
    }
    const parsed = parseMetricScoreInput(value, spec, { reduced });
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }
    setMessage('');
    inFlight.current = true;
    mutation.mutate(
      { ...base, new_score: parsed.value },
      {
        onSuccess: onDone,
        onError: (e) => setMessage(messageFor(e)),
        onSettled: () => (inFlight.current = false),
      },
    );
  };
  const reset = () => {
    if (inFlight.current) return;
    setMessage('');
    inFlight.current = true;
    mutation.mutate(
      { ...base, reset: true },
      {
        onSuccess: onDone,
        onError: (e) => setMessage(messageFor(e)),
        onSettled: () => (inFlight.current = false),
      },
    );
  };
  return (
    <form
      className={styles.editor}
      aria-label={`Edit ${metric} score`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <TextField
        label={`New ${metric} score`}
        hideLabel
        value={value}
        onChange={setValue}
        autoFocus
        mono
        width="10ch"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <Button size="sm" variant="accent" type="submit" loading={mutation.isPending}>
        Save
      </Button>
      <Button size="sm" variant="neutral" onPress={onDone}>
        Cancel
      </Button>
      {edited ? (
        <Button size="sm" variant="ghost" onPress={reset} isDisabled={mutation.isPending}>
          Reset to scorer value
        </Button>
      ) : null}
      {message ? (
        <span className={styles.error} role="alert">
          {message}
        </span>
      ) : null}
    </form>
  );
}
