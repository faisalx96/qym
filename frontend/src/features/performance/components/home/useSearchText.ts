/**
 * Performance lists: the text of a search box whose committed value lives in the address. Typing updates the box at
 * once and the address (and so the read) after a short pause; a change of the address from outside (× Clear n, Back)
 * replaces the text.
 */
import { useEffect, useRef, useState } from 'react';

const PAUSE_MS = 250;

export function useSearchText(committed: string, onCommit: (text: string) => void) {
  const [text, setText] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    setText(committed);
  }
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    if (text === committed) return undefined;
    const timer = window.setTimeout(() => commit.current(text), PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [text, committed]);
  return [text, setText] as const;
}
