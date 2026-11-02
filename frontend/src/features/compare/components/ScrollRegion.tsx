/** A focusable, labelled horizontal scroll container (keyboard users can scroll wide tables). */
import type { ReactNode } from 'react';

export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div role="region" aria-label={label} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
