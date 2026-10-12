import { useMemo, useState } from "react";
import { estimateTokens, type SaveState, type useDraftRules } from "../useDraftRules";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Icon,
  Pagination,
  SearchField,
  Tag,
  Text,
  Textarea,
  TextField,
} from "@/ui";
import s from "./rules.module.css";

const PAGE = 10;

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  dirty: 'Unsaved changes…',
  saving: 'Saving draft…',
  saved: 'Draft saved',
  error: 'Save failed',
  invalid: 'Every rule needs a title and an instruction before it saves',
};

export function RuleEditor({ draft, editable }: { draft: ReturnType<typeof useDraftRules>; editable: boolean }) {
  const { rules, state, error, update, add, remove } = draft;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Rule keys waiting for delete confirmation. */
  const [deleting, setDeleting] = useState<string[] | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? rules.filter((r) => `${r.title} ${r.instruction}`.toLocaleLowerCase().includes(q)) : rules;
  }, [rules, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);
  const allChecked = filtered.length > 0 && filtered.every((r) => checked.has(r.key));

  return (
    <div className={s.editor}>
      <Text variant="sm" tone="muted" as="p" data-testid="rule-count">
        {`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} · ~${estimateTokens(rules).toLocaleString()} prompt tokens · no rule count limit`}
      </Text>
      <div className={s.ruleTools}>
        <SearchField
          label="Search rules"
          placeholder="Search rules"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          onClear={() => setQuery('')}
          width={240}
        />
        {editable ? (
          <>
            <Checkbox
              isSelected={allChecked}
              onChange={(v) => setChecked(v ? new Set(filtered.map((r) => r.key)) : new Set())}
              isDisabled={filtered.length === 0}
            >
              Select all filtered
            </Checkbox>
            <Button
              size="sm"
              variant="danger"
              isDisabled={checked.size === 0}
              onPress={() => setDeleting([...checked])}
            >
              {`Delete selected${checked.size ? ` (${checked.size})` : ''}`}
            </Button>
            <span className={s.spacer} />
            <Button
              size="sm"
              icon={<Icon name="plus" size={12} />}
              onPress={() => {
                const key = add();
                setQuery('');
                setPage(1);
                setOpen(key);
              }}
            >
              Add rule
            </Button>
          </>
        ) : null}
      </div>
      <span role="status" aria-live="polite" className={s.saveState} data-state={state}>
        {editable ? SAVE_TEXT[state] : ''}
        {state === 'error' && error ? `: ${error}` : ''}
      </span>

      {shown.length ? (
        <ul className={s.ruleList} aria-label="Rules">
          {shown.map((r) => {
            const isOpen = open === r.key;
            const invalid = editable && (!r.title.trim() || !r.instruction.trim());
            return (
              <li key={r.key} className={s.rule} data-open={isOpen ? '' : undefined}>
                <div className={s.ruleHead}>
                  {editable ? (
                    <Checkbox
                      hideLabel
                      aria-label={`Select ${r.title || 'untitled rule'}`}
                      isSelected={checked.has(r.key)}
                      onChange={(v) =>
                        setChecked((cur) => {
                          const next = new Set(cur);
                          if (v) next.add(r.key);
                          else next.delete(r.key);
                          return next;
                        })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className={s.ruleToggle}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.key)}
                  >
                    <Icon name={isOpen ? 'collapse' : 'expand'} size={12} />
                    <span dir="auto">{r.title || 'Untitled rule'}</span>
                  </button>
                  {invalid ? <Tag kind="data" tone="warning">incomplete</Tag> : null}
                  {r.inferred_from ? <Tag kind="data">{r.inferred_from}</Tag> : null}
                  {editable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete rule ${r.title || "untitled"}`}
                      onPress={() => setDeleting([r.key])}
                    >
                      <Icon name="trash" size={12} />
                    </Button>
                  ) : null}
                </div>
                {isOpen ? (
                  <div className={s.ruleBody}>
                    <TextField
                      label="Title"
                      value={r.title}
                      isReadOnly={!editable}
                      onChange={(v) => update(r.key, { title: v })}
                      errorMessage={editable && !r.title.trim() ? 'Title is required.' : undefined}
                      isInvalid={editable && !r.title.trim()}
                      autoFocus={editable && !r.title}
                    />
                    <Textarea
                      label="Instruction"
                      rows={4}
                      value={r.instruction}
                      isReadOnly={!editable}
                      onChange={(v) => update(r.key, { instruction: v })}
                      errorMessage={editable && !r.instruction.trim() ? 'Instruction is required.' : undefined}
                      isInvalid={editable && !r.instruction.trim()}
                    />
                    {r.explanation ? (
                      <Text variant="sm" tone="muted" as="p">
                        {`Why this rule helps: ${r.explanation}`}
                      </Text>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          compact
          title={rules.length ? 'No rules match' : 'No rules yet'}
          body={
            rules.length
              ? 'Try a different search.'
              : 'Generate rules after selecting reference documents or approved examples, or add one by hand.'
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting && deleting.length > 1 ? `Delete ${deleting.length} rules?` : "Delete this rule?"}
        description="The rules are removed from this draft and the draft is saved."
        cancelLabel="Keep"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (deleting) remove(deleting);
          setChecked(new Set());
          setDeleting(null);
        }}
      />
      {filtered.length > PAGE ? (
        <Pagination total={filtered.length} page={current} pageSize={PAGE} noun="rules" onPageChange={setPage} />
      ) : null}
    </div>
  );
}
