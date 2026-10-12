import { useRef, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Dialog, type DialogSize } from '../Dialog';
import { Select } from '../Select';
import { TextField } from '../TextField';
import { Textarea } from '../Textarea';
import styles from './FormDialog.module.css';

export type FormValue = string | boolean;

export interface FormFieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'checkbox' | 'password' | 'email';
  value?: FormValue;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: ReactNode;
  required?: boolean;
  rows?: number;
  mono?: boolean;
  autoFocus?: boolean;
  validate?: (value: FormValue, values: Record<string, FormValue>) => string | null | undefined;
}

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  details?: { icon?: ReactNode; title: string; body?: ReactNode }[];
  fields: FormFieldSpec[];
  size?: DialogSize;
  confirmLabel?: string;
  cancelLabel?: string;
  submittingLabel?: string;
  tone?: 'primary' | 'danger';
  /** Throw (or return a string) to keep the dialog open with an error. */
  onSubmit: (values: Record<string, FormValue>) => Promise<void | string> | void | string;
  /** Called on value changes (e.g. slug derived from name). */
  onChange?: (values: Record<string, FormValue>, changed: string) => Record<string, FormValue> | void;
}

/** Generic form dialog (shell.js openFormDialog). Enter submits from single-line inputs. */
export function FormDialog(props: FormDialogProps) {
  // Remount on every open so values/errors reset without effects.
  return <FormDialogInner key={props.open ? 'open' : 'closed'} {...props} />;
}

function FormDialogInner({
  open,
  onOpenChange,
  title,
  description,
  details,
  fields,
  size = 'md',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  submittingLabel = 'Saving…',
  tone = 'primary',
  onSubmit,
  onChange,
}: FormDialogProps) {
  const initial = () =>
    Object.fromEntries(fields.map((f) => [f.name, f.value ?? (f.type === 'checkbox' ? false : '')]));
  const [values, setValues] = useState<Record<string, FormValue>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  function set(name: string, value: FormValue) {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      const adjusted = onChange?.(next, name);
      return adjusted ?? next;
    });
    setErrors((prev) => ({ ...prev, [name]: '' }));
  }

  async function submit() {
    if (inflight.current) return;
    const nextErrors: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.name] ?? '';
      if (f.required && (typeof v === 'string' ? v.trim() === '' : v === false))
        nextErrors[f.name] = `${f.label} is required.`;
      const custom = f.validate?.(v, values);
      if (custom) nextErrors[f.name] = custom;
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    inflight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const result = await onSubmit(values);
      if (typeof result === 'string' && result) {
        setFormError(result);
        return;
      }
      onOpenChange(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="neutral" size="md" onPress={() => onOpenChange(false)} isDisabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} size="md" onPress={submit} loading={busy}>
            {busy ? submittingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {details?.length ? (
          <ul className={styles.details}>
            {details.map((d, i) => (
              <li key={i}>
                {d.icon ? <span className={styles.detailIcon}>{d.icon}</span> : null}
                <span>
                  <strong>{d.title}</strong>
                  {d.body ? <span className={styles.detailBody}>{d.body}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {fields.map((f) => {
          const err = errors[f.name] || undefined;
          const v = values[f.name];
          if (f.type === 'checkbox') {
            return (
              <Checkbox key={f.name} isSelected={Boolean(v)} onChange={(c) => set(f.name, c)}>
                {f.label}
              </Checkbox>
            );
          }
          if (f.type === 'textarea') {
            return (
              <Textarea
                key={f.name}
                label={f.label}
                value={String(v ?? '')}
                onChange={(s) => set(f.name, s)}
                rows={f.rows}
                placeholder={f.placeholder}
                help={f.help}
                errorMessage={err}
                isRequired={f.required}
                mono={f.mono}
              />
            );
          }
          if (f.type === 'select') {
            return (
              <Select
                key={f.name}
                label={f.label}
                items={(f.options ?? []).map((o) => ({ key: o.value, label: o.label }))}
                value={String(v ?? '') || null}
                onChange={(k: Key | null) => set(f.name, k === null ? '' : String(k))}
                help={f.help}
                errorMessage={err}
                isRequired={f.required}
              />
            );
          }
          return (
            <TextField
              key={f.name}
              label={f.label}
              type={f.type === 'password' ? 'password' : f.type === 'email' ? 'email' : 'text'}
              value={String(v ?? '')}
              onChange={(s) => set(f.name, s)}
              placeholder={f.placeholder}
              help={f.help}
              errorMessage={err}
              isRequired={f.required}
              mono={f.mono}
              autoFocus={f.autoFocus}
            />
          );
        })}
        {formError ? (
          <p className={styles.error} role="alert">
            {formError}
          </p>
        ) : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
