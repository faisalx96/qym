/** Types shared by the launch provider, its hooks and the sections (see LaunchContext.tsx for the contract). */
import type { DryRunResponse, RawJsonState, RawJsonStatus, ValidationItem, SettingsFilter } from './model';

export type LaunchMode = 'launch' | 'editor';

/** Collapsible sections of the form, in page order. */
export const SECTION_IDS = ['models', 'settings', 'sweeps', 'evaluation', 'raw'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  models: 'Models',
  settings: 'Environment configurations',
  sweeps: 'Sweeps',
  evaluation: 'Evaluation configurations',
  raw: 'Raw JSON',
};

/** DOM id of a section's heading button (the focus fallback of a problem) and of its body. */
export const sectionHeadingId = (id: SectionId) => `launch-section-${id}`;
export const sectionBodyId = (id: SectionId) => `launch-section-${id}-body`;

export interface PreviewState {
  /** Last dry-run response (kept while the next one loads). */
  data: DryRunResponse | null;
  /** The form changed since `data` was fetched (debounce + request in flight). */
  loading: boolean;
  /** Network/server failure message ('' when none). */
  error: string;
}

export interface RawApi {
  /** What the editor shows (follows the form until the user types). */
  state: RawJsonState;
  status: RawJsonStatus;
  /** Type into the editor. */
  edit: (text: string) => void;
  /** "Apply": validate everything, then update the form. Returns whether it was applied. */
  apply: (explicit?: boolean) => boolean;
  /** "Revert to form". */
  revert: () => void;
}

export interface SectionState {
  open: Record<SectionId, boolean>;
  setOpen: (id: SectionId, open: boolean) => void;
  toggle: (id: SectionId) => void;
}

/** Search / changed-only / opened groups of the Environment configurations card. */
export type SettingsUi = SettingsFilter;

export interface SectionSummary {
  /** Changed values in this section (real counts: stepChangeCount / changed slots). */
  changes: number;
  /** Review items that belong to this section. */
  problems: ValidationItem[];
}

/** Where a starting point comes from (`chooseBase`). All fields optional. */
export interface BaseRef {
  /** Environment whose presets / runs are used (default: the base environment). */
  envId?: string;
  /** A saved preset (kind 'saved'). */
  presetId?: string;
  /** A best run (kind 'best_run'); without it the base stays pending until one is picked. */
  runId?: string;
  metric?: string;
  /** Reload even if this is the current starting point. */
  force?: boolean;
}

export interface SchemaStatus {
  /** The once-per-visit schema refresh is running. */
  checking: boolean;
  /** The refresh failed (the environment may be unreachable). */
  error: string;
}

/** The section a review item belongs to; null when it lives in the entry block (or the Raw JSON editor's own state). */
export function sectionOfItem(item: ValidationItem): SectionId | null {
  switch (item.stepId) {
    case 'models':
      return 'models';
    case 'env':
      return item.pointer === '/links' || item.pointer.startsWith('/links/') ? 'sweeps' : 'settings';
    case 'eval':
      return 'evaluation';
    case 'review':
      return item.pointer === '#advanced-json' ? 'raw' : null;
    default:
      return null;
  }
}
