/**
 * Section frame state: which sections are open, the settings card's search / groups, the
 * registry of focusable fields, and "click a problem" (open the section and the group, clear the
 * search, scroll with scroll-margin, focus the field, fall back to the section heading).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ValidationItem } from '../model';
import { heldOnHome, stepOfItem, stepOfSection, type RevealStep } from '../wizard/steps';
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

const FLASH_MS = 1200;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolls the element into view (smooth unless the user prefers reduced motion), focuses it (or its
 * first control) and flashes an outline for 1.2s (`data-flash`, a static outline, not an animation).
 */
export function revealElement(el: HTMLElement): void {
  el.style.scrollMarginBlock = 'var(--space-xl)';
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? el).focus({ preventScroll: true });
  el.setAttribute('data-flash', 'true');
  setTimeout(() => el.removeAttribute('data-flash'), FLASH_MS);
}

/** `reveal` brings the step that holds a field on screen (the wizard); absent in the editor page. */
export function useSections(reveal?: RevealStep) {
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  });
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
  const openSection = useCallback(
    (id: SectionId) => {
      setOpen(id, true);
      revealRef.current?.(stepOfSection(id));
    },
    [setOpen],
  );
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
    if (fallback) revealRef.current?.(stepOfSection(fallback));
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
      revealRef.current?.(stepOfItem(item), { home: heldOnHome(item) });
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

  const revealStep = useCallback<RevealStep>((step, opts) => revealRef.current?.(step, opts), []);
  const sectionState: SectionState = { open, setOpen, toggle };
  return {
    sectionState,
    openSection,
    settingsUi,
    setSettingsUi,
    registerField,
    focusField,
    focusIssue,
    revealStep,
  };
}
