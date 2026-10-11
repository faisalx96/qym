import { forwardRef, type ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Group,
  Input,
  Label,
  NumberField as AriaNumberField,
  Text as AriaText,
  type NumberFieldProps as AriaNumberFieldProps,
} from 'react-aria-components';
import { fieldStyles } from '../Field';
import { Icon } from '../Icon';
import tfStyles from '../TextField/TextField.module.css';
import styles from './NumberField.module.css';

export interface NumberFieldProps extends Omit<AriaNumberFieldProps, 'className' | 'style' | 'children'> {
  label: string;
  hideLabel?: boolean;
  help?: ReactNode;
  errorMessage?: string;
  steppers?: boolean;
  className?: string;
  width?: string | number;
  placeholder?: string;
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { label, hideLabel, help, errorMessage, steppers = true, className, width, placeholder, ...rest },
  ref,
) {
  return (
    <AriaNumberField className={[fieldStyles.field, className].filter(Boolean).join(' ')} {...rest}>
      <Label className={fieldStyles.label} data-hidden={hideLabel ? '' : undefined}>
        {label}
      </Label>
      <Group className={styles.group} style={{ width }}>
        <Input ref={ref} className={[tfStyles.control, styles.input].join(' ')} placeholder={placeholder} />
        {steppers ? (
          <span className={styles.steppers}>
            <AriaButton slot="increment" className={styles.step} aria-label="Increase">
              <Icon name="chevron-up" size={12} />
            </AriaButton>
            <AriaButton slot="decrement" className={styles.step} aria-label="Decrease">
              <Icon name="chevron-down" size={12} />
            </AriaButton>
          </span>
        ) : null}
      </Group>
      {help ? (
        <AriaText slot="description" className={fieldStyles.help}>
          {help}
        </AriaText>
      ) : null}
      <FieldError className={fieldStyles.error}>{errorMessage}</FieldError>
    </AriaNumberField>
  );
});
