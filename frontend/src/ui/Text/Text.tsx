import type { AllHTMLAttributes, ElementType, ReactNode } from 'react';
import styles from './Text.module.css';

/** Type-scale roles (DESIGN_LANGUAGE §1). `xs` is badge chrome only and not offered here. */
export type TextRole = 'title' | 'stat' | 'xl' | 'lg' | 'md' | 'base' | 'sm';
export type TextTone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'success' | 'warning';

export interface TextProps extends Omit<AllHTMLAttributes<HTMLElement>, 'as'> {
  /** Type-scale role (DESIGN_LANGUAGE §1). `role` stays the ARIA attribute. */
  variant?: TextRole;
  tone?: TextTone;
  mono?: boolean;
  weight?: 400 | 500 | 600 | 650 | 700;
  as?: ElementType;
  truncate?: boolean;
  children?: ReactNode;
}

const DEFAULT_TAG: Record<TextRole, ElementType> = {
  title: 'h1',
  stat: 'div',
  xl: 'h2',
  lg: 'h3',
  md: 'div',
  base: 'p',
  sm: 'span',
};

export function Text({
  variant = 'base',
  tone,
  mono,
  weight,
  as,
  truncate,
  className,
  children,
  ...rest
}: TextProps) {
  const Tag = (as ?? DEFAULT_TAG[variant]) as ElementType;
  return (
    <Tag
      className={[styles.text, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-tone={tone}
      data-mono={mono ? '' : undefined}
      data-weight={weight}
      data-truncate={truncate ? '' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
