import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Text, type CardTone } from '@/ui';
import styles from './settings.module.css';

export interface SettingsCardProps {
  /** Anchor for links that jump to this block. */
  id?: string;
  title: ReactNode;
  /** One line under the title: what the block is for. */
  description?: ReactNode;
  /** C182: the docs page for this block; a 'Read the guide' link follows the description. */
  guide?: string;
  /** The block's main action (Add, Create), on the title row's end side. */
  action?: ReactNode;
  /** A custom footer. A card that saves settings passes `save` instead (C145: one footer recipe). */
  footer?: ReactNode;
  /** The one settings footer: state text at the start, a 24px Save at the end, disabled until there are changes. */
  save?: SaveFooterProps;
  tone?: CardTone;
  children?: ReactNode;
  [data: `data-${string}`]: string | boolean | undefined;
}

/**
 * One settings block: a card with a title, a description line and the block's action on the right, then its
 * content. Every settings tab is built from these, so each tab opens the same way (round 10, as the old settings
 * page did): title, subtitle, then the controls.
 */
export function SettingsCard({
  id: anchor,
  title,
  description,
  guide,
  action,
  footer,
  save,
  tone,
  children,
  ...rest
}: SettingsCardProps) {
  const id = useId();
  return (
    <Card
      as="section"
      id={anchor}
      aria-labelledby={id}
      tone={tone}
      footer={save ? <SaveFooter {...save} /> : footer}
      header={
        <div className={styles.cardHeader}>
          <div>
            <Text variant="md" id={id}>
              {title}
            </Text>
            {description || guide ? (
              <Text variant="sm">
                {description}
                {guide ? (
                  <>
                    {description ? ' ' : null}
                    <Link to={guide}>Read the guide</Link>
                  </>
                ) : null}
              </Text>
            ) : null}
          </div>
          {action ? <div className={styles.cardAction}>{action}</div> : null}
        </div>
      }
      {...rest}
    >
      <div className={styles.cardBody}>{children}</div>
    </Card>
  );
}

export interface SaveFooterProps {
  /** There are unsaved changes: Save is enabled and the state text says so. */
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  /** Always 'Save'. Only the Live worker passes its version label ('Save as v4'). */
  label?: string;
  /** Extra facts before the state text (a character count, when it was last edited). */
  meta?: ReactNode;
  /** Actions before Save, such as Discard or Test (neutral or accent). */
  secondary?: ReactNode;
  /** No Save at all (read-only or no permission); the state text stays. */
  hideSave?: boolean;
  /** The state text when nothing is unsaved (default 'All changes saved'). */
  savedText?: string;
  /** Locks Save even with changes (a required field is empty, a blocker). Pass disabledReason with it. */
  isDisabled?: boolean;
  /** Why Save is locked (default 'No changes to save'). */
  disabledReason?: string;
}

/** C145: every settings card ends the same way: what state it is in, then Save. */
export function SaveFooter({
  dirty,
  saving,
  onSave,
  label = 'Save',
  meta,
  secondary,
  hideSave,
  savedText = 'All changes saved',
  isDisabled,
  disabledReason,
}: SaveFooterProps) {
  return (
    <div className={styles.saveFooter} data-save-footer>
      <div className={styles.saveState}>
        {meta}
        <span data-dirty={dirty ? '' : undefined}>
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedText}
        </span>
      </div>
      {hideSave ? null : (
        <div className={styles.cardAction}>
          {secondary}
          <Button
            variant="primary"
            isDisabled={!dirty || Boolean(isDisabled)}
            disabledReason={disabledReason ?? 'No changes to save'}
            loading={saving}
            onPress={onSave}
          >
            {label}
          </Button>
        </div>
      )}
    </div>
  );
}
