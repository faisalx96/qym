import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Collapse.module.css';

export interface CollapseProps {
  open: boolean;
  id?: string;
  /** Keep the content mounted while closed (default: mounted only while open or closing). */
  keepMounted?: boolean;
  className?: string;
  children: ReactNode;
}

const OPEN_MS = 180;
const CLOSE_MS = 140;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animated disclosure body. The rows of a one-cell grid go 0fr -> 1fr (no px heights), the content
 * fades, and a closed body is `inert` and `visibility: hidden` (not tabbable, not read). Content is
 * mounted while open and until the close transition ends; no animation on first mount or under
 * `prefers-reduced-motion` (an instant toggle).
 */
export function Collapse({ open, id, keepMounted = false, className, children }: CollapseProps) {
  const [present, setPresent] = useState(open);
  const [settled, setSettled] = useState(open);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const instant = reducedMotion();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
      if (instant) setSettled(true);
      else timer = setTimeout(() => setSettled(true), OPEN_MS + 30);
    } else {
      setSettled(false);
      if (instant) setPresent(false);
      else timer = setTimeout(() => setPresent(false), CLOSE_MS + 30);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [open]);
  const mounted = keepMounted || open || present;
  return (
    <div
      id={id}
      className={[styles.collapse, className].filter(Boolean).join(' ')}
      data-open={open}
      data-settled={open && settled}
      {...(open ? {} : ({ inert: '' } as object))}
    >
      <div className={styles.inner}>{mounted ? children : null}</div>
    </div>
  );
}
