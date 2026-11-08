import { forwardRef, useId, type AnchorHTMLAttributes, type ReactNode } from 'react';
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
  iconEnd?: ReactNode;
  /** Renders an inert aria-disabled link (focusable, no href, so nothing navigates). */
  isDisabled?: boolean;
  /** Why the link is locked: shown on hover and read with the link (A-22, the Button recipe). */
  disabledReason?: string;
  children?: ReactNode;
}

/** An anchor styled as Button (Sign in link, hrefs). */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  {
    to,
    href,
    variant = 'neutral',
    size = 'sm',
    icon,
    iconEnd,
    isDisabled,
    disabledReason,
    className,
    children,
    ...rest
  },
  ref,
) {
  const reasonId = useId();
  const cls = [buttonStyles.button, className].filter(Boolean).join(' ');
  const inner = (
    <>
      {icon ? <span className={buttonStyles.icon}>{icon}</span> : null}
      {children ? <span className={buttonStyles.label}>{children}</span> : null}
      {iconEnd ? <span className={buttonStyles.icon}>{iconEnd}</span> : null}
    </>
  );
  if (isDisabled) {
    const link = (
      <a
        ref={ref}
        role="link"
        aria-disabled="true"
        tabIndex={0}
        className={cls}
        data-variant={variant}
        data-size={size}
        data-disabled=""
        aria-describedby={disabledReason ? reasonId : undefined}
        {...rest}
      >
        {inner}
      </a>
    );
    if (!disabledReason) return link;
    return (
      <span className={buttonStyles.reasonWrap} data-reason={disabledReason} data-disabled-reason="">
        {link}
        <span id={reasonId} className={buttonStyles.srOnly}>
          {disabledReason}
        </span>
      </span>
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
