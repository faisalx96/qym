import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  Button as AriaButton,
  Input,
  Label,
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import { Icon } from '../Icon';
import { Kbd } from '../Kbd';
import tfStyles from '../TextField/TextField.module.css';
import styles from './SearchField.module.css';

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, 'className' | 'style' | 'children'> {
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  onClear?: () => void;
  className?: string;
  width?: string | number;
  /** Shown at the end as a keyboard hint, e.g. "/" */
  hint?: string;
  /** '/' shows the key hint and focuses this field when '/' is pressed outside an input, textarea, select or
   * contenteditable (no Ctrl, Meta or Alt). One per page. */
  shortcut?: '/';
  /** Extra attributes for the <input> (combobox role/aria-*). */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}

/** .qym-search: control with a leading glyph and a clear action. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    label,
    hideLabel = true,
    placeholder = 'Search',
    onClear,
    className,
    width,
    hint,
    shortcut,
    inputProps,
    ...rest
  },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== shortcut || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      e.preventDefault();
      inner.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);
  const keyHint = shortcut ?? hint;
  return (
    <AriaSearchField
      className={[fieldStyles.field, styles.search, className].filter(Boolean).join(' ')}
      onClear={onClear}
      {...rest}
    >
      <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
        {label}
      </Label>
      <span className={tfStyles.wrap} data-prefix="" style={{ width, maxWidth: '100%' }}>
        <span className={tfStyles.prefix}>
          <Icon name="search" size={12} />
        </span>
        <Input ref={inner} className={tfStyles.control} placeholder={placeholder} {...inputProps} />
        <span className={tfStyles.suffix}>
          {keyHint ? <Kbd className={styles.hint}>{keyHint}</Kbd> : null}
          <AriaButton className={styles.clear} aria-label="Clear search">
            <Icon name="close" size={12} />
          </AriaButton>
        </span>
      </span>
    </AriaSearchField>
  );
});
