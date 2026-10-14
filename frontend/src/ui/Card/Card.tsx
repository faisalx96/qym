import { forwardRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './Card.module.css';

export type CardTone = 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'meta' | 'neutral';
export type CardBand = 1 | 2 | 3 | 4 | 5;
export type CardSeries = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CardProps {
  /** Rail colour from an information tone (status, severity, definition metadata). */
  tone?: CardTone;
  /** Rail colour from a score band (a value that is a score). */
  band?: CardBand;
  /** Rail colour from a series (a run, a model, a category group). */
  series?: CardSeries;
  /**
   * Where the meaning rail sits: 'left' (inline-start, the default when a tone, band or series is set), 'bottom'
   * (a tile that reads as a gauge: sweep stats) or 'none' (tone without a rail). 'start' is the old spelling of 'left'.
   */
  rail?: 'left' | 'bottom' | 'none' | 'start';
  /** Faint 6% tint; only danger and live states are allowed. */
  wash?: 'danger' | 'live';
  compact?: boolean;
  /** onPress, href or to make the card interactive (renders button / a). */
  onPress?: () => void;
  href?: string;
  to?: string;
  isSelected?: boolean;
  isDisabled?: boolean;
  as?: 'div' | 'section' | 'article' | 'li';
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
  children?: ReactNode;
}

/**
 * Card (DESIGN_LANGUAGE §3 "Card"): the one grouping surface. --bg-surface on a --border-subtle outline,
 * an optional 3px inline-start rail that carries the meaning, a faint wash only for danger and live, and
 * interactive hover/pressed/selected states when it acts (onPress, href or to).
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    tone,
    band,
    series,
    rail,
    wash,
    compact,
    onPress,
    href,
    to,
    isSelected,
    isDisabled,
    as = 'div',
    header,
    footer,
    className,
    children,
    ...rest
  },
  ref,
) {
  const hasTone = Boolean(tone || band || series);
  const data = {
    'data-tone': band || series ? undefined : tone,
    'data-band': band,
    'data-series': band ? undefined : series,
    'data-rail': hasTone && rail !== 'none' ? (rail === 'bottom' ? 'bottom' : 'left') : undefined,
    'data-wash': wash,
    'data-compact': compact ? '' : undefined,
    'data-selected': isSelected ? '' : undefined,
    'data-disabled': isDisabled ? '' : undefined,
  };
  const cls = [styles.card, className].filter(Boolean).join(' ');
  const inner = (
    <>
      {header ? <div className={styles.header}>{header}</div> : null}
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </>
  );
  if (to && !isDisabled) {
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        className={cls}
        data-interactive=""
        aria-current={isSelected ? 'true' : undefined}
        {...data}
        {...rest}
      >
        {inner}
      </Link>
    );
  }
  if (href && !isDisabled) {
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={cls}
        data-interactive=""
        aria-current={isSelected ? 'true' : undefined}
        {...data}
        {...rest}
      >
        {inner}
      </a>
    );
  }
  if (onPress) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!isDisabled) onPress();
      }
    };
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-pressed={isSelected === undefined ? undefined : isSelected}
        aria-disabled={isDisabled ? true : undefined}
        className={cls}
        data-interactive=""
        onClick={() => {
          if (!isDisabled) onPress();
        }}
        onKeyDown={onKeyDown}
        {...data}
        {...rest}
      >
        {inner}
      </div>
    );
  }
  const Element = as as 'div';
  return (
    <Element ref={ref as React.Ref<HTMLDivElement>} className={cls} {...data} {...rest}>
      {inner}
    </Element>
  );
});
