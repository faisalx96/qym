import { useId, type ReactNode } from 'react';
import { Button, Card, type CardTone, Text, TextLink } from '@/ui';
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
  /** The one save row: state text at the start, a 24px Save at the end, disabled until there are changes. It ends
   *  the card body, with no divider line above it (cv4 A4). */
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
      footer={footer}
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
                    <TextLink to={guide}>Read the guide</TextLink>
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
      {/* The save row ends the body: no divider line above it (cv4 A4). */}
      <div className={styles.cardBody}>
        {children}
        {save ? <SaveFooter {...save} /> : null}
      </div>
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
  /** The state text when nothing is unsaved. Default '' = no text: the disabled Save already says it (cv4 A4, X4).
   *  Pass a fact only when it adds something ("No changes since v3"). */
  savedText?: string;
  /** Locks Save even with changes (a required field is empty, a blocker). Pass disabledReason with it. */
  isDisabled?: boolean;
  /** Why Save is locked (default 'No changes to save'). */
  disabledReason?: string;
}

/**
 * C145: every settings card ends the same way: its state, then Save. cv4 A4, X4: the state text shows
 * only when there is something to say (unsaved changes, saving). With nothing changed the row shows only the meta and
 * the disabled Save.
 */
export function SaveFooter({
  dirty,
  saving,
  onSave,
  label = 'Save',
  meta,
  secondary,
  hideSave,
  savedText = '',
  isDisabled,
  disabledReason,
}: SaveFooterProps) {
  const hasState = Boolean(saving || dirty || savedText);
  // Read-only with nothing to say: no empty row.
  if (hideSave && !meta && !hasState) return null;
  return (
    <div className={styles.saveFooter} data-save-footer>
      <div className={styles.saveState}>
        {meta}
        {hasState ? (
          <span data-dirty={dirty ? '' : undefined} data-save-state>
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedText}
          </span>
        ) : null}
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
