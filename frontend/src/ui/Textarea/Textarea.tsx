import { forwardRef, type ReactNode } from 'react';
import {
  FieldError,
  Label,
  Text as AriaText,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import styles from './Textarea.module.css';

export interface TextareaProps extends Omit<AriaTextFieldProps, 'className' | 'style' | 'children'> {
  label: string;
  hideLabel?: boolean;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
  help?: ReactNode;
  errorMessage?: string;
  className?: string;
  /** Direction for user text; defaults to auto. */
  dir?: 'auto' | 'rtl' | 'ltr';
}

/** Roomy multi-line field (never inherits --control-height). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hideLabel, rows = 4, mono, placeholder, help, errorMessage, className, dir = 'auto', ...rest },
  ref,
) {
  return (
    <AriaTextField className={[fieldStyles.field, className].filter(Boolean).join(' ')} isInvalid={rest.isInvalid ?? (errorMessage ? true : undefined)} {...rest}>
      <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
        {label}
      </Label>
      <AriaTextArea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        className={styles.textarea}
        data-mono={mono ? '' : undefined}
        dir={dir}
      />
      {help ? (
        <AriaText slot="description" className={fieldStyles.help}>
          {help}
        </AriaText>
      ) : null}
      <FieldError className={fieldStyles.error}>{errorMessage}</FieldError>
    </AriaTextField>
  );
});
