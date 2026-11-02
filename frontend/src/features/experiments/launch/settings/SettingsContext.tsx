/**
 * What the leaf controls of the settings tree need, kept in one stable object so a doc edit does not
 * re-render every field: only fields whose own node changed (see `leafEqual`) update.
 */
import { createContext, useContext } from 'react';
import type { DescriptorEntry, FormContext } from '../model';
import type { SetDoc } from '../LaunchContext';

export interface SettingsActions {
  ctx: FormContext;
  setDoc: SetDoc;
  registerField: (name: string, el: HTMLElement | null) => void;
  /** Endpoint names an endpoint-ref field may point at, by `ref_collection`. */
  endpoints: Record<string, string[]>;
  /** Sweeps are available (launch mode); the editor mode of the default preset has none. */
  sweeps: boolean;
}

export const SettingsActionsCtx = createContext<SettingsActions | null>(null);

export function useSettingsActions(): SettingsActions {
  const value = useContext(SettingsActionsCtx);
  if (!value) throw new Error('Settings controls must be rendered inside <SettingsSection>');
  return value;
}

export function endpointNames(actions: Pick<SettingsActions, 'endpoints'>, entry: DescriptorEntry): string[] {
  return (entry.ref_collection ? actions.endpoints[entry.ref_collection] : undefined) ?? [];
}
