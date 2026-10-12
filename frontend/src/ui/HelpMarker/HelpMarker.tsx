import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  Button as AriaButton,
} from 'react-aria-components';
import styles from './HelpMarker.module.css';

export interface HelpMarkerProps {
  /** What is explained ("Explain <label>"). */
  label: string;
  children: ReactNode;
}

/**
 * 12px "i" marker. Hover/focus opens; click/Enter/Space pins; Escape, outside
 * click, scroll and resize close. The tooltip body is also rendered inline
 * (visually hidden) and referenced by aria-describedby.
 */
export function HelpMarker({ label, children }: HelpMarkerProps) {
  const [pinned, setPinned] = useState(false);
  const [visible, setVisible] = useState(false); // hover / focus, managed by React Aria
  const [dismissed, setDismissed] = useState(false); // Escape while hovered/focused
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);

  // React Aria closes tooltips on a capture-phase document Escape listener that
  // stops propagation; registering ours at mount puts it ahead of that one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setDismissed(true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const close = () => setPinned(false);
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [pinned]);

  const open = pinned || (visible && !dismissed);
  return (
    <TooltipTrigger
      isOpen={open}
      onOpenChange={(o) => {
        setVisible(o);
        if (o) setDismissed(false);
      }}
      delay={150}
      closeDelay={100}
    >
      <AriaButton
        ref={ref}
        className={styles.marker}
        aria-label={`Explain ${label}`}
        aria-expanded={open}
        aria-describedby={id}
        data-pinned={pinned ? '' : undefined}
        onPress={() => {
          setDismissed(false);
          setPinned((p) => !p);
        }}
      >
        i
      </AriaButton>
      <span id={id} className={styles.srOnly}>
        {children}
      </span>
      <AriaTooltip className={styles.tooltip} placement="top" offset={8}>
        <OverlayArrow className={styles.arrow}>
          <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {children}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
