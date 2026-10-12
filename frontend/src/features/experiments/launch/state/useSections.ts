/**
 * Section frame state: which sections are open, the settings card's search / groups, the
 * registry of focusable fields, and "click a problem" (open the section and the group, clear the
 * search, scroll with scroll-margin, focus the field, fall back to the section heading).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ValidationItem } from '../model';
import {
  sectionHeadingId,
  sectionOfItem,
  type SectionId,
  type SectionState,
  type SettingsUi,
} from '../types';

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  models: true,
  settings: true,
  sweeps: true,
  evaluation: false,
  raw: false,
};

const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';
const RETRY_MS = 30;
const MAX_TRIES = 12;

/** Scrolls the element into view and focuses it (or its first control). */
export function revealElement(el: HTMLElement): void {
  el.style.scrollMarginBlock = 'var(--space-xl)';
  el.scrollIntoView({ block: 'center' });
  const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? el).focus({ preventScroll: true });
}

export function useSections() {
  const [open, setOpenMap] = useState<Record<SectionId, boolean>>(DEFAULT_OPEN);
  const [settingsUi, setSettingsUiState] = useState<SettingsUi>({
    search: '',
    changedOnly: false,
    groupOpen: {},
  });
  const fields = useRef(new Map<string, HTMLElement>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const setOpen = useCallback(
    (id: SectionId, value: boolean) => setOpenMap((p) => (p[id] === value ? p : { ...p, [id]: value })),
    [],
  );
  const toggle = useCallback((id: SectionId) => setOpenMap((p) => ({ ...p, [id]: !p[id] })), []);
  const openSection = useCallback((id: SectionId) => setOpen(id, true), [setOpen]);
  const setSettingsUi = useCallback(
    (updater: (ui: SettingsUi) => SettingsUi) => setSettingsUiState(updater),
    [],
  );

  const registerField = useCallback((name: string, el: HTMLElement | null) => {
    if (el) fields.current.set(name, el);
    else fields.current.delete(name);
  }, []);

  /** Focus a registered field, retrying while its section renders; falls back to a section heading. */
  const focusField = useCallback((name: string, fallback: SectionId | null = null) => {
    let tries = 0;
    const attempt = () => {
      const el = fields.current.get(name);
      if (el && el.isConnected) {
        revealElement(el);
        return;
      }
      tries += 1;
      if (tries < MAX_TRIES) {
        const t = setTimeout(attempt, RETRY_MS);
        timers.current.add(t);
        return;
      }
      const heading = fallback ? document.getElementById(sectionHeadingId(fallback)) : null;
      if (heading) revealElement(heading);
    };
    const t = setTimeout(attempt, 0);
    timers.current.add(t);
  }, []);

  const focusIssue = useCallback(
    (item: ValidationItem) => {
      const section = sectionOfItem(item);
      if (section) {
        setOpen(section, true);
        if (section === 'settings') {
          setSettingsUiState((ui) => ({
            search: '',
            changedOnly: false,
            groupOpen: item.groupId ? { ...ui.groupOpen, [item.groupId]: true } : ui.groupOpen,
          }));
        }
      }
      focusField(item.fieldName, section);
    },
    [focusField, setOpen],
  );

  const sectionState: SectionState = { open, setOpen, toggle };
  return { sectionState, openSection, settingsUi, setSettingsUi, registerField, focusField, focusIssue };
}
