import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ButtonSize, ButtonVariant } from '../Button';
import buttonStyles from '../Button/Button.module.css';

export interface LinkButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** In-app route (React Router) … */
  to?: string;
  /** … or a plain href (full navigation: login, downloads, external). */
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Renders an inert aria-disabled link (no href, so nothing navigates). */
  isDisabled?: boolean;
  children?: ReactNode;
}

/** An anchor styled as Button (Sign in link, hrefs). */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { to, href, variant = 'neutral', size = 'sm', icon, isDisabled, className, children, ...rest },
  ref,
) {
  const cls = [buttonStyles.button, className].filter(Boolean).join(' ');
  const inner = (
    <>
      {icon ? <span className={buttonStyles.icon}>{icon}</span> : null}
      {children ? <span className={buttonStyles.label}>{children}</span> : null}
    </>
  );
  if (isDisabled) {
    return (
      <a
        ref={ref}
        role="link"
        aria-disabled="true"
        className={cls}
        data-variant={variant}
        data-size={size}
        data-disabled=""
        {...rest}
      >
        {inner}
      </a>
    );
  }
  if (to) {
    return (
      <Link ref={ref} to={to} className={cls} data-variant={variant} data-size={size} {...rest}>
        {inner}
      </Link>
    );
  }
  return (
    <a ref={ref} href={href} className={cls} data-variant={variant} data-size={size} {...rest}>
      {inner}
    </a>
  );
});
