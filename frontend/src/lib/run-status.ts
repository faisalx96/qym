/**
 * Run-status event bus. Admin force-stop / cancelled jobs must reach every
 * open runs page, in this tab and others. Channel name and message shape are
 * shared with the legacy dashboard during the staged rollout (brief 01 §8.6).
 */
import { useEffect } from 'react';

export const RUN_STATUS_CHANNEL = 'qym-run-status';
export const RUN_STATUS_EVENT = 'qym:run-status';

export type RunStatusValue = 'STOPPED' | 'STOPPING' | 'COMPLETED' | 'FAILED' | 'RUNNING' | string;

export interface RunStatusMessage {
  runIds: string[];
  status: RunStatusValue;
}

type Listener = (message: RunStatusMessage) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(RUN_STATUS_CHANNEL);
  channel.onmessage = (event: MessageEvent<RunStatusMessage>) => {
    const data = event.data;
    if (data && Array.isArray(data.runIds)) dispatchLocal(data);
  };
  return channel;
}

function dispatchLocal(message: RunStatusMessage): void {
  listeners.forEach((l) => l(message));
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(RUN_STATUS_EVENT, { detail: message }));
  }
}

/** Open the cross-tab channel at app boot so events reach every open shell tab. */
export function initRunStatusBus(): void {
  ensureChannel();
}

/** Announce a status change to this tab and every other open tab. */
export function announceRunStatus(runIds: string[], status: RunStatusValue): void {
  const message: RunStatusMessage = { runIds: [...runIds], status };
  dispatchLocal(message);
  ensureChannel()?.postMessage(message);
}

export function subscribeRunStatus(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunStatus(listener: Listener): void {
  useEffect(() => subscribeRunStatus(listener), [listener]);
}
