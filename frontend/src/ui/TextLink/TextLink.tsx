import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import styles from './TextLink.module.css';

export interface TextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** In-app route (React Router) … */
  to?: string;
  /** … or a plain href (full navigation: docs, downloads, external). */
  href?: string;
  /** The end chevron that says "goes to another page" (default true). */
  arrow?: boolean;
  children: ReactNode;
}

/**
 * The one text link to another page (cv4 F13): accent text with an end chevron ("Read the guide ›"), never
 * underlined, brighter on hover. A link that must look like a button is a LinkButton instead.
 */
export const TextLink = forwardRef<HTMLAnchorElement, TextLinkProps>(function TextLink(
  { to, href, arrow = true, className, children, ...rest },
  ref,
) {
  const cls = [styles.link, className].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className={styles.label}>{children}</span>
      {arrow ? <Icon name="chevron-right" size={12} className={styles.arrow} /> : null}
    </>
  );
  if (to) {
    return (
      <Link ref={ref} to={to} className={cls} data-link="block" {...rest}>
        {inner}
      </Link>
    );
  }
  return (
    <a ref={ref} href={href} className={cls} data-link="block" {...rest}>
      {inner}
    </a>
  );
});
