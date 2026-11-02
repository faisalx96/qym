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

export interface TextareaProps extends Omit<
  AriaTextFieldProps,
  'className' | 'style' | 'children' | 'spellCheck'
> {
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
  /** Browser spell check (red underlines); off for prompts, code and identifiers. */
  spellCheck?: boolean;
  /**
   * A long-form editor (a prompt): clicking in to type brightens the border instead of drawing the green focus ring;
   * keyboard focus keeps the ring.
   */
  quietFocus?: boolean;
}

/** Roomy multi-line field (never inherits --control-height). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hideLabel,
    rows = 4,
    mono,
    placeholder,
    help,
    errorMessage,
    className,
    dir = 'auto',
    spellCheck,
    quietFocus,
    ...rest
  },
  ref,
) {
  return (
    <AriaTextField
      className={[fieldStyles.field, className].filter(Boolean).join(' ')}
      isInvalid={rest.isInvalid ?? (errorMessage ? true : undefined)}
      {...rest}
    >
      <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
        {label}
      </Label>
      <AriaTextArea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        className={styles.textarea}
        data-mono={mono ? '' : undefined}
        data-quiet-focus={quietFocus ? '' : undefined}
        spellCheck={spellCheck}
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
