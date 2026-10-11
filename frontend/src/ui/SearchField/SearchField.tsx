import { forwardRef } from 'react';
import {
  Button as AriaButton,
  Input,
  Label,
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import { Icon } from '../Icon';
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
}

/** .qym-search: control with a leading glyph and a clear action. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label, hideLabel = true, placeholder = 'Search', onClear, className, width, hint, ...rest },
  ref,
) {
  return (
    <AriaSearchField
      className={[fieldStyles.field, styles.search, className].filter(Boolean).join(' ')}
      onClear={onClear}
      {...rest}
    >
      <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
        {label}
      </Label>
      <span className={tfStyles.wrap} data-prefix="" style={{ width }}>
        <span className={tfStyles.prefix}>
          <Icon name="search" size={12} />
        </span>
        <Input ref={ref} className={tfStyles.control} placeholder={placeholder} />
        <span className={tfStyles.suffix}>
          {hint ? <kbd className={styles.hint}>{hint}</kbd> : null}
          <AriaButton className={styles.clear} aria-label="Clear search">
            <Icon name="close" size={12} />
          </AriaButton>
        </span>
      </span>
    </AriaSearchField>
  );
});
