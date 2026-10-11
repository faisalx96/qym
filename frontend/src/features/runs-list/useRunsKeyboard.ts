/**
 * Runs-table keyboard shortcuts (brief 03 §2 "Keyboard"): j/↓ k/↑ move the
 * focused row (across pages), g/G first/last, Enter opens, x toggles select,
 * c compares (or opens the cohort), / focuses search, ? opens help, 1–4 set
 * the time range, Esc leaves select mode / clears selection / blurs. Single-
 * key shortcuts can be turned off (WCAG 2.1.4, localStorage
 * `qym:single-key-shortcuts=off`); arrows, Enter and Escape always work.
 * Never fires with modifiers, inside inputs, dialogs or open popovers.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { KEYS, readLocal, writeLocal } from '@/lib/storage';

export interface RunsKeyboardHandlers {
  moveFocus: (delta: 1 | -1) => void;
  focusFirst: () => void;
  focusLast: () => void;
  openFocused: () => void;
  toggleFocused: () => void;
  compare: () => void;
  focusSearch: () => void;
  openHelp: () => void;
  setRange: (range: 'all' | 'today' | 'week' | 'month') => void;
  escape: () => void;
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function singleKeyShortcutsEnabled(): boolean {
  return readLocal(KEYS.singleKeyShortcuts) !== 'off';
}
export function setSingleKeyShortcuts(enabled: boolean): void {
  writeLocal(KEYS.singleKeyShortcuts, enabled ? null : 'off');
  emit();
}
export function useSingleKeyShortcuts(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    singleKeyShortcutsEnabled,
    () => true,
  );
  return [enabled, setSingleKeyShortcuts];
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-popover]')) return true;
  return false;
}

function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'));
}

export const RANGE_KEYS: Record<string, 'all' | 'today' | 'week' | 'month'> = {
  '1': 'all',
  '2': 'today',
  '3': 'week',
  '4': 'month',
};

export function useRunsKeyboard(handlers: RunsKeyboardHandlers, enabled = true): void {
  const [singleKeys] = useSingleKeyShortcuts();
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = isTypingTarget(e.target);
      if (e.key === 'Escape') {
        if (typing) {
          (e.target as HTMLElement).blur?.();
          return;
        }
        if (overlayOpen()) return;
        e.preventDefault();
        handlers.escape();
        return;
      }
      if (typing || overlayOpen()) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlers.moveFocus(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Enter') {
        handlers.openFocused();
        return;
      }
      if (!singleKeys) return;
      switch (e.key) {
        case 'j':
          e.preventDefault();
          handlers.moveFocus(1);
          break;
        case 'k':
          e.preventDefault();
          handlers.moveFocus(-1);
          break;
        case 'g':
          e.preventDefault();
          handlers.focusFirst();
          break;
        case 'G':
          e.preventDefault();
          handlers.focusLast();
          break;
        case 'x':
          e.preventDefault();
          handlers.toggleFocused();
          break;
        case 'c':
          e.preventDefault();
          handlers.compare();
          break;
        case '/':
          e.preventDefault();
          handlers.focusSearch();
          break;
        case '?':
          e.preventDefault();
          handlers.openHelp();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          e.preventDefault();
          handlers.setRange(RANGE_KEYS[e.key]!);
          break;
        default:
          break;
      }
    },
    [enabled, handlers, singleKeys],
  );
  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);
}

export const SHORTCUT_HELP: { keys: string[]; label: string; single?: boolean }[] = [
  { keys: ['j', '↓'], label: 'Next run', single: true },
  { keys: ['k', '↑'], label: 'Previous run', single: true },
  { keys: ['g'], label: 'First run', single: true },
  { keys: ['G'], label: 'Last run', single: true },
  { keys: ['Enter'], label: 'Open the focused run' },
  { keys: ['x'], label: 'Select / deselect the focused run', single: true },
  { keys: ['c'], label: 'Compare the selected runs', single: true },
  { keys: ['/'], label: 'Search runs', single: true },
  { keys: ['1', '2', '3', '4'], label: 'Time range: all, today, 7d, 30d', single: true },
  { keys: ['Esc'], label: 'Leave select mode, clear the selection, or leave a field' },
  { keys: ['?'], label: 'This help', single: true },
];
