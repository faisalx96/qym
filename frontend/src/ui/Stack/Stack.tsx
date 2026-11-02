import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import styles from './Stack.module.css';

export type Gap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface StackProps extends HTMLAttributes<HTMLElement> {
  gap?: Gap;
  direction?: 'row' | 'column';
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

export function Stack({
  gap = 'md',
  direction = 'column',
  align,
  justify,
  wrap,
  as,
  className,
  style,
  children,
  ...rest
}: StackProps) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag
      className={[styles.stack, className].filter(Boolean).join(' ')}
      data-gap={gap}
      data-direction={direction}
      data-wrap={wrap ? '' : undefined}
      style={{ alignItems: align, justifyContent: justify, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Convenience: `<Stack direction="row" align="center">`. */
export function Row(props: StackProps) {
  return <Stack direction="row" align="center" {...props} />;
}
