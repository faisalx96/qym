import type { HTMLAttributes, ReactNode } from 'react';
import { Tag } from './Tag';

export type StateTagTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StateTagProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * One meaning per tone (DESIGN_LANGUAGE §3.3 "State tag"): info = active now (Running, Live, Checking), success =
   * good (Healthy, OK, Pass, Configured), warning = needs a look, danger = bad (Error, Fail, Stale), neutral = unknown,
   * skipped, not yet, or no verdict.
   */
  tone: StateTagTone;
  children: ReactNode;
}

/**
 * A condition now or the result of a check: an environment's health, a connection, an item's Pass or Fail, a SQL
 * check, a review decision in a log. The tinted Tag in sans, sentence case, with no figure. A step of a process (run,
 * job, review, version) is a `StatusMark`, never a StateTag.
 */
export function StateTag({ tone, children, ...rest }: StateTagProps) {
  // The first letter upper-cased, the rest as given (so OK stays OK), as StatusMark does: a data label reads the same.
  const label =
    typeof children === 'string' && children ? children[0]!.toUpperCase() + children.slice(1) : children;
  return (
    <Tag kind="state" tone={tone === 'neutral' ? undefined : tone} {...rest}>
      {label}
    </Tag>
  );
}
