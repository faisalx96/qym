/** A text input + button that adds a key; Enter adds too. `onAdd` returns an error message or ''. */
import { useState } from 'react';
import { Button, Icon, TextField } from '@/ui';
import styles from './settings.module.css';

export function AddRow({
  placeholder,
  buttonText,
  onAdd,
}: {
  placeholder: string;
  buttonText: string;
  onAdd: (raw: string) => string;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const message = onAdd(value);
    setError(message);
    if (!message) setValue('');
  };
  return (
    <div className={styles.addRow}>
      <TextField
        className={styles.addInput}
        label={placeholder}
        hideLabel
        mono
        maxLength={200}
        placeholder={placeholder}
        value={value}
        onChange={setValue}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
      <Button size="sm" icon={<Icon name="plus" size={12} />} onPress={add}>
        {buttonText}
      </Button>
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
