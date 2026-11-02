import { Fragment, type ReactNode } from 'react';

/** Positions where a key may break: after `_`, `-` and `.`, and before a capital that follows a lower-case letter or digit. */
const BREAK = /(?<=[_\-.])|(?<=[a-z0-9])(?=[A-Z])/g;

/**
 * A data key with soft break opportunities (`<wbr>`) at its word boundaries, so a key that has to wrap breaks at its words
 * (`self_consistency_` / `check_result`) and only falls back to `overflow-wrap: anywhere` for a single very long word.
 * `<wbr>` adds no character: `textContent` and the rendered text are the source key exactly (round 7, D2-15).
 */
export function keyWithBreaks(key: string): ReactNode {
  const parts = key.split(BREAK);
  if (parts.length < 2) return key;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}
