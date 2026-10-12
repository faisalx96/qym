/**
 * Keyboard triage (brief 07 §2.14): j/k (or ↑/↓ on a focused card) move the
 * current card, a approve, r reject, e edit, o/Enter toggle details, x select,
 * Shift+A bulk approve, / focus search, ? help, Esc closes/cancels. Keys are
 * ignored while typing in a field or when a dialog is open.
 */
import { useEffect, useRef } from 'react';

export interface QueueKeyHandlers {
  next: () => void;
  prev: () => void;
  approve: () => void;
  reject: () => void;
  edit: () => void;
  toggle: () => void;
  select: () => void;
  bulkApprove: () => void;
  focusSearch: () => void;
  help: () => void;
  escape: () => void;
}

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function dialogOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]'));
}

export function useQueueKeys(handlers: QueueKeyHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const h: QueueKeyHandlers = {
      next: () => ref.current.next(),
      prev: () => ref.current.prev(),
      approve: () => ref.current.approve(),
      reject: () => ref.current.reject(),
      edit: () => ref.current.edit(),
      toggle: () => ref.current.toggle(),
      select: () => ref.current.select(),
      bulkApprove: () => ref.current.bulkApprove(),
      focusSearch: () => ref.current.focusSearch(),
      help: () => ref.current.help(),
      escape: () => ref.current.escape(),
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (!dialogOpen()) h.escape();
        return;
      }
      if (inEditable(e.target) || dialogOpen()) return;
      const onCard = (e.target as HTMLElement | null)?.closest?.('[data-review-card]');
      switch (e.key) {
        case 'j':
          e.preventDefault();
          h.next();
          break;
        case 'k':
          e.preventDefault();
          h.prev();
          break;
        case 'ArrowDown':
          if (onCard) {
            e.preventDefault();
            h.next();
          }
          break;
        case 'ArrowUp':
          if (onCard) {
            e.preventDefault();
            h.prev();
          }
          break;
        case 'a':
          e.preventDefault();
          h.approve();
          break;
        case 'A':
          if (e.shiftKey) {
            e.preventDefault();
            h.bulkApprove();
          }
          break;
        case 'r':
          e.preventDefault();
          h.reject();
          break;
        case 'e':
          e.preventDefault();
          h.edit();
          break;
        case 'o':
          e.preventDefault();
          h.toggle();
          break;
        case 'Enter':
          if (onCard && (e.target as HTMLElement).hasAttribute('data-review-card')) {
            e.preventDefault();
            h.toggle();
          }
          break;
        case 'x':
          e.preventDefault();
          h.select();
          break;
        case '/':
          e.preventDefault();
          h.focusSearch();
          break;
        case '?':
          e.preventDefault();
          h.help();
          break;
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['j', 'k'], label: 'Next / previous correction' },
  { keys: ['↓', '↑'], label: 'Same, when a card is focused' },
  { keys: ['a'], label: 'Approve the current correction' },
  { keys: ['r'], label: 'Reject (with an optional comment)' },
  { keys: ['e'], label: 'Edit the human diagnosis' },
  { keys: ['o', 'Enter'], label: 'Expand / collapse details' },
  { keys: ['x'], label: 'Select / unselect for bulk actions' },
  { keys: ['Shift', 'A'], label: 'Approve the selection' },
  { keys: ['/'], label: 'Focus the search box' },
  { keys: ['?'], label: 'This help' },
  { keys: ['Esc'], label: 'Close a dialog or cancel an edit' },
];
