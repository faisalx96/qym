import type { CreateWorkerJob, LiveJob, LiveWorkerRead, SaveWorkerSettings } from '@/api/liveWorker';

export interface WorkerCallbacks {
  onState: (state: LiveWorkerRead['state']['desired']) => Promise<unknown>;
  onKey: (id: string | null) => Promise<unknown>;
  onSave: (body: SaveWorkerSettings) => Promise<{ version: number }>;
  onRestore: (version: number) => Promise<{ version: number }>;
  onCreateJob: (body: CreateWorkerJob) => Promise<LiveJob>;
  onCancelJob: (id: string) => Promise<unknown>;
}
export type WorkerBusy = Partial<
  Record<'state' | 'key' | 'save' | 'restore' | 'createJob' | 'cancelJob', boolean>
>;
