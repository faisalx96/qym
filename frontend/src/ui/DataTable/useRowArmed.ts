import { useEffect, useRef, useState } from 'react';

/**
 * Lean rows (C020, owner option A): a row's React Aria controls mount the first time the pointer is over the row or
 * focus enters it. Until then the cell draws a plain element with the same look, so a 50-row table runs no menu or
 * tooltip hooks per row. `ref` goes on an element inside the row; `arm` mounts at once (a press on the plain element).
 * With `skipSelf`, the pointer or focus on the element itself does not arm it, so the element is not swapped under the
 * pointer in the middle of a press: its own press handler arms it.
 */
export function useRowArmed<T extends HTMLElement>({ skipSelf = false }: { skipSelf?: boolean } = {}) {
  const ref = useRef<T>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (armed) return undefined;
    const row = ref.current?.closest('tr, [role="row"]') ?? ref.current;
    if (!row) return undefined;
    const arm = (e: Event) => {
      if (skipSelf && e.target instanceof Node && ref.current?.contains(e.target)) return;
      setArmed(true);
    };
    row.addEventListener('pointerover', arm);
    row.addEventListener('focusin', arm);
    return () => {
      row.removeEventListener('pointerover', arm);
      row.removeEventListener('focusin', arm);
    };
  }, [armed, skipSelf]);
  return { armed, ref, arm: () => setArmed(true) };
}
