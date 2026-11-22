import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The strip between the topbar and the page scroller (AppShell). `undefined` means no shell is mounted (a test, the
 * gallery); `null` means the shell has not placed the strip yet.
 */
export const ShellSubbarContext = createContext<HTMLElement | null | undefined>(undefined);

/**
 * Shows its children in the shell's strip under the topbar: outside `main#shell-content`, so the line stays in view
 * while the page scrolls and never meets a page's own sticky rows. With no shell around it renders in place.
 */
export function ShellSubbar({ children }: { children: ReactNode }) {
  const slot = useContext(ShellSubbarContext);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
