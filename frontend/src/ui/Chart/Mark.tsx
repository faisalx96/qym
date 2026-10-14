import { createElement, type KeyboardEvent, type ReactNode, type SVGProps } from 'react';
import { useMarkTip } from './ChartTooltip';

export type MarkElement = 'button' | 'span' | 'div' | 'li' | 'g' | 'circle' | 'rect' | 'path';

export interface MarkProps {
  as?: MarkElement;
  /** Tooltip content (markup allowed). Needs a ChartTooltipHost ancestor. */
  tip?: ReactNode;
  /** Colour encodings drive the tones.css custom properties and the cross-highlight. */
  series?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  band?: 1 | 2 | 3 | 4 | 5;
  tone?: 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'meta' | 'neutral';
  /** Makes the mark act (cursor, hover brightness, sibling dimming, press). */
  onPick?: (e?: React.SyntheticEvent) => void;
  isSelected?: boolean;
  isDisabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  role?: string;
  tabIndex?: number;
  /** SVG geometry for as='circle' | 'rect' | 'path'. */
  cx?: number;
  cy?: number;
  r?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  d?: string;
  children?: ReactNode;
  [attr: `aria-${string}`]: string | boolean | number | undefined;
  [attr: `data-${string}`]: string | boolean | number | undefined;
}

/**
 * One chart mark (bar, bin, segment, dot, matrix cell). Sets the state attributes styles/marks.css reads
 * (data-mark, data-interactive, data-selected, data-series/band/tone) and wires the ChartTooltip. A button is
 * keyboard-operable natively; an SVG element or other tag with `onPick` gets role=button, tabIndex 0 and
 * Enter/Space.
 */
export function Mark({
  as = 'span',
  tip,
  series,
  band,
  tone,
  onPick,
  isSelected,
  isDisabled,
  className,
  style,
  children,
  ...rest
}: MarkProps) {
  const { handlers, describedBy } = useMarkTip(tip);
  const native = as === 'button';
  const interactive = Boolean(onPick) && !isDisabled;
  const props: Record<string, unknown> = {
    ...rest,
    className,
    style,
    'data-mark': '',
    'data-interactive': interactive ? '' : undefined,
    'data-selected': isSelected ? '' : undefined,
    'data-disabled': isDisabled ? '' : undefined,
    ...(band ? { 'data-band': band } : series ? { 'data-series': series } : tone ? { 'data-tone': tone } : {}),
    'aria-describedby': describedBy,
    'aria-pressed': native && onPick && isSelected !== undefined ? isSelected : undefined,
    onPointerEnter: handlers.onPointerEnter,
    onPointerLeave: handlers.onPointerLeave,
    onFocus: handlers.onFocus,
    onBlur: handlers.onBlur,
  };
  if (native) {
    props.type = 'button';
    props.disabled = isDisabled || undefined;
    props.onClick = (e: React.MouseEvent) => {
      handlers.onClick?.(e);
      if (interactive) onPick?.(e);
    };
  } else if (interactive) {
    props.role = 'button';
    if (rest.tabIndex === undefined) props.tabIndex = 0;
    props['aria-pressed'] = isSelected === undefined ? undefined : isSelected;
    props.onClick = (e: React.MouseEvent) => {
      handlers.onClick?.(e);
      onPick?.(e);
    };
    props.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPick?.(e);
      }
    };
  } else if (tip !== undefined) {
    // A passive mark with a tooltip is still reachable by keyboard.
    if (rest.tabIndex === undefined) props.tabIndex = 0;
    props.onClick = handlers.onClick;
  }
  return createElement(as, props as SVGProps<SVGElement>, children);
}
