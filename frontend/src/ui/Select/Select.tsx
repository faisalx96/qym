import { useMemo, useState, type ReactNode } from 'react';
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text as AriaText,
  FieldError,
  Input,
  Autocomplete,
  SearchField as AriaSearchField,
  useFilter,
  type Key,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import { Icon } from '../Icon';
import styles from './Select.module.css';

export interface SelectItem {
  key: Key;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends SelectItem> {
  label: string;
  hideLabel?: boolean;
  items: T[];
  value: Key | null;
  onChange: (key: Key | null) => void;
  /** 'auto' = searchable when more than 8 items. */
  searchable?: boolean | 'auto';
  placement?: 'bottom' | 'top';
  placeholder?: string;
  renderItem?: (item: T) => ReactNode;
  isDisabled?: boolean;
  isRequired?: boolean;
  help?: ReactNode;
  errorMessage?: string;
  className?: string;
  width?: string | number;
  name?: string;
}

/** Single select on the 24px control, listbox popover, optional search. */
export function Select<T extends SelectItem>({
  label,
  hideLabel,
  items,
  value,
  onChange,
  searchable = 'auto',
  placement = 'bottom',
  placeholder = 'Select…',
  renderItem,
  isDisabled,
  isRequired,
  help,
  errorMessage,
  className,
  width,
  name,
}: SelectProps<T>) {
  const search = searchable === 'auto' ? items.length > 8 : Boolean(searchable);
  const { contains } = useFilter({ sensitivity: 'base' });
  const [open, setOpen] = useState(false);
  const disabledKeys = useMemo(() => items.filter((i) => i.disabled).map((i) => i.key), [items]);
  const list = (
    <ListBox
      className={styles.list}
      items={items}
      renderEmptyState={() => <div className={styles.empty}>No matches</div>}
    >
      {(item) => (
        <ListBoxItem id={item.key} textValue={item.label} className={styles.option}>
          {({ isSelected }) => (
            <>
              <span className={styles.optionText}>
                {renderItem ? renderItem(item) : item.label}
                {item.description ? <span className={styles.optionDesc}>{item.description}</span> : null}
              </span>
              {isSelected ? <Icon name="check" size={12} /> : null}
            </>
          )}
        </ListBoxItem>
      )}
    </ListBox>
  );
  return (
    <AriaSelect
      className={[fieldStyles.field, className].filter(Boolean).join(' ')}
      selectedKey={value}
      disabledKeys={disabledKeys}
      onSelectionChange={(k) => onChange(k)}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={errorMessage ? true : undefined}
      placeholder={placeholder}
      name={name}
      isOpen={open}
      onOpenChange={setOpen}
      style={{ width }}
    >
      <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
        {label}
      </Label>
      <AriaButton className={styles.trigger}>
        <SelectValue className={styles.value} />
        <Icon name="chevron-down" size={12} />
      </AriaButton>
      {help ? (
        <AriaText slot="description" className={fieldStyles.help}>
          {help}
        </AriaText>
      ) : null}
      <FieldError className={fieldStyles.error}>{errorMessage}</FieldError>
      <Popover className={styles.popover} placement={placement} offset={4}>
        {search ? (
          <Autocomplete filter={contains}>
            <AriaSearchField aria-label={`Search ${label}`} className={styles.searchWrap} autoFocus>
              <Icon name="search" size={12} />
              <Input className={styles.search} placeholder="Search…" />
            </AriaSearchField>
            {list}
          </Autocomplete>
        ) : (
          list
        )}
      </Popover>
    </AriaSelect>
  );
}
