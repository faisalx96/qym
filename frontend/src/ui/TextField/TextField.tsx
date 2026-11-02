import { forwardRef, type ReactNode } from 'react';
import {
  FieldError,
  Input,
  Label,
  Text as AriaText,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import styles from './TextField.module.css';

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'className' | 'style' | 'children'> {
  label?: string;
  hideLabel?: boolean;
  /** sm = the 24px control; auth = the 42px login field (not a compact control). */
  size?: 'sm' | 'auth';
  mono?: boolean;
  prefixIcon?: ReactNode;
  suffix?: ReactNode;
  placeholder?: string;
  help?: ReactNode;
  errorMessage?: string;
  className?: string;
  inputClassName?: string;
  autoComplete?: string;
  /** Width in ch or px (CSS value). */
  width?: string | number;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hideLabel,
    size = 'sm',
    mono,
    prefixIcon,
    suffix,
    placeholder,
    help,
    errorMessage,
    className,
    inputClassName,
    autoComplete,
    width,
    isRequired,
    ...rest
  },
  ref,
) {
  return (
    <AriaTextField
      className={[fieldStyles.field, className].filter(Boolean).join(' ')}
      isRequired={isRequired}
      isInvalid={rest.isInvalid ?? (errorMessage ? true : undefined)}
      {...rest}
    >
      {label ? (
        <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
          {label}
          {isRequired ? (
            <span className={fieldStyles.required} aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      <span
        className={styles.wrap}
        data-size={size}
        data-prefix={prefixIcon ? '' : undefined}
        style={{ width, maxWidth: '100%' }}
      >
        {prefixIcon ? <span className={styles.prefix}>{prefixIcon}</span> : null}
        <Input
          ref={ref}
          className={[styles.control, inputClassName].filter(Boolean).join(' ')}
          placeholder={placeholder}
          autoComplete={autoComplete}
          data-mono={mono ? '' : undefined}
        />
        {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </span>
      {help ? (
        <AriaText slot="description" className={fieldStyles.help}>
          {help}
        </AriaText>
      ) : null}
      <FieldError className={fieldStyles.error}>{errorMessage}</FieldError>
    </AriaTextField>
  );
});
