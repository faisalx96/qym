/**
 * Import wizard (brief 07 §2.3): Source → Map columns (CSV, JSON and JSONL, C013) → Review.
 * Modes: `new` (catalog), `new-version` (existing dataset), `add-to-draft`.
 * Files are parsed in a Web Worker; `:upload` streams byte progress;
 * add-to-draft upserts in chunks of 1000 with "batch n of m". Before its Review
 * step, add-to-draft counts the records whose item_id is already in the draft
 * (a dry run); matching items are skipped unless the user chooses Replace (C006).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BULK_CHUNK,
  bulkItems,
  invalidateItems,
  previewBulkItems,
  uploadDataset,
  type Dataset,
  type DatasetVersion,
  type ItemBody,
  type OnExisting,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  RadioGroup,
  Select,
  Tag,
  Text,
  TextField,
  Textarea,
  useToast,
  Icon,
} from '@/ui';
import { CSV_ENCODINGS, encodingLabel } from '../lib/encoding';
import {
  COLUMN_ROLES,
  autoMap,
  autoMapJson,
  columnRole,
  csvUpserts,
  ignoredColumns,
  jsonMappedUpserts,
  mappingSummary,
  recordsWithInput,
  setColumnRole,
  type ColumnMapping,
  type ColumnRole,
} from '../lib/mapping';
import { jsonErrorText, jsonMappableKeys } from '../lib/jsonRecords';
import { parseFile } from '../lib/parseClient';
import type { CsvParseResult, JsonParseResult } from '../lib/parse.worker';
import { nextVersionAfter, slugifyDatasetName } from '../lib/slugify';
import { PRODUCTION_RULE } from '../lib/versions';
import { pluralize } from '../lib/itemValue';
import {
  NO_COUNTS,
  addCounts,
  countMatches,
  importResultText,
  matchLine,
  recordIds,
  type ImportCounts,
} from '../lib/reimport';
import styles from './UploadWizard.module.css';

export type WizardMode = 'new' | 'new-version' | 'add-to-draft';

export interface UploadWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  mode: WizardMode;
  /** Catalog (for the name-clash check in `new` mode). */
  catalog?: Dataset[];
  /** Existing dataset for `new-version` / `add-to-draft`. */
  target?: Dataset | null;
  /** Draft version for `add-to-draft`. */
  draft?: DatasetVersion | null;
  /** Newest version label (for the "creates vN" sentence). */
  latestVersion?: string | null;
  canSetProduction?: boolean;
  onDone: (result: { mode: WizardMode; dataset?: Dataset; version?: DatasetVersion; added?: number }) => void;
}

const ACCEPT = '.csv,.tsv,.txt,.jsonl,.ndjson,.json';
type Parsed = CsvParseResult | JsonParseResult;
/** Add-to-draft records whose item_id is already in the draft; `error` when the dry run failed. */
type MatchCheck = { matched: number; error: null } | { matched: null; error: string };

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.detail || e.message : (e as Error).message || fallback;
}

export function UploadWizard(props: UploadWizardProps) {
  // Remount per open so state resets without effects.
  return props.open ? <WizardInner key="open" {...props} /> : null;
}

function WizardInner({
  open,
  onOpenChange,
  slug,
  mode: initialMode,
  catalog = [],
  target = null,
  draft = null,
  latestVersion = null,
  canSetProduction = true,
  onDone,
}: UploadWizardProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<WizardMode>(initialMode);
  const [clashTarget, setClashTarget] = useState<Dataset | null>(target);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parsing, setParsing] = useState(false);
  const [encoding, setEncoding] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ input: [], expected: [], metadata: [], id: '' });
  const [versionName, setVersionName] = useState('');
  const [publish, setPublish] = useState(initialMode === 'new');
  const [setAlias, setSetAlias] = useState(initialMode === 'new' && canSetProduction);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [matchCheck, setMatchCheck] = useState<MatchCheck | null>(null);
  const [onExisting, setOnExisting] = useState<OnExisting>('skip');
  const [progress, setProgress] = useState<{ label: string; fraction: number | null } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** JSONL: leave the invalid lines out and import the rest (off by default, C120). */
  const [skipBad, setSkipBad] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const parseTicket = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null!);

  const effectiveTarget = mode === 'new' ? null : (clashTarget ?? target);
  const slugPreview = useMemo(() => slugifyDatasetName(name), [name]);
  const clash = useMemo(() => {
    if (mode !== 'new' || !name.trim()) return null;
    const lower = name.trim().toLowerCase();
    return catalog.find((d) => d.name.toLowerCase() === lower || d.slug === slugPreview) ?? null;
  }, [catalog, mode, name, slugPreview]);

  const loadFile = useCallback(async (f: File, enc?: string) => {
    const ticket = ++parseTicket.current;
    setParsing(true);
    setErrors({});
    let result: Awaited<ReturnType<typeof parseFile>>;
    try {
      result = await parseFile(f, enc);
    } catch {
      if (ticket !== parseTicket.current) return;
      setParsed(null);
      setErrors({ file: 'Couldn’t read the file.' });
      setParsing(false);
      return;
    }
    if (ticket !== parseTicket.current) return; // a newer file / encoding superseded this read
    setParsed(result);
    setSkipBad(false);
    if (result.kind === 'csv') {
      setEncoding(result.encoding);
      if (!enc || result.headers.length) setMapping(autoMap(result.headers));
    } else setMapping(autoMapJson(jsonMappableKeys(result.rows)));
    setParsing(false);
  }, []);

  function chooseFile(f: File | null) {
    if (!f) parseTicket.current++;
    setFile(f);
    setParsing(false);
    setParsed(null);
    setEncoding(null);
    if (f) {
      if (mode === 'new' && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
      void loadFile(f);
    }
  }

  function onEncodingChange(value: string) {
    setEncoding(value);
    if (file) void loadFile(file, value);
  }

  const isCsv = parsed?.kind === 'csv';
  // the keys or columns the Map columns step places (every format has the step, C013)
  const mapKeys = useMemo(
    () => (parsed?.kind === 'csv' ? parsed.headers : parsed ? jsonMappableKeys(parsed.rows) : []),
    [parsed],
  );
  const jsonErrors = parsed?.kind === 'json' ? parsed.errors : [];
  // A JSONL file can leave its invalid lines out; a JSON array cannot.
  const canSkip =
    parsed?.kind === 'json' && parsed.format === 'jsonl' && jsonErrors.length > 0 && parsed.rows.length > 0;
  const sourceErrors = useMemo(() => {
    const list: string[] = [];
    if (parsed?.error) list.push(parsed.error);
    if (parsed?.kind === 'csv' && !parsed.error && !parsed.rows.length)
      list.push('The CSV file has no data rows.');
    return list;
  }, [parsed]);

  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (mode === 'new' && !name.trim()) e.name = 'Name is required.';
    if (!file) e.file = 'Choose a file.';
    else if (parsing) e.file = 'Still reading the file…';
    else if (!parsed || sourceErrors.length) e.source = sourceErrors[0] ?? 'Choose a valid file.';
    // shown once, under the file (not in the drop zone): only a skip lets the rest through
    else if (jsonErrors.length && !(canSkip && skipBad)) e.source = jsonErrorText(jsonErrors[0]!);
    if (clash && mode === 'new') e.name = `A dataset named "${clash.name}" already exists.`;
    setErrors(e);
    return !Object.keys(e).length;
  }

  function validateStep2(): boolean {
    if (!mapping.input.length) {
      setErrors({ mapping: 'Choose at least one Input column.' });
      return false;
    }
    setErrors({});
    return true;
  }

  function next() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      void toReview();
    } else void submit();
  }

  function draftUpserts(): ItemBody[] {
    if (!parsed) return [];
    return parsed.kind === 'csv'
      ? csvUpserts(parsed.headers, parsed.rows, mapping)
      : jsonMappedUpserts(parsed.rows, mapping);
  }

  /** Add-to-draft counts the records that match draft items first, so Review opens with the count. */
  async function toReview() {
    const ids = mode === 'add-to-draft' && effectiveTarget && draft ? recordIds(draftUpserts()) : [];
    if (!ids.length || !effectiveTarget || !draft) {
      setMatchCheck(null);
      setStep(3);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setChecking(true);
    let check: MatchCheck;
    try {
      const matched = await countMatches(ids, (upserts) =>
        previewBulkItems(
          slug,
          effectiveTarget.slug,
          draft.version,
          { upserts, on_existing: 'skip' },
          controller.signal,
        ),
      );
      check = { matched, error: null };
    } catch (e) {
      if (controller.signal.aborted) return;
      check = { matched: null, error: errorText(e, 'The check failed') };
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setChecking(false);
    }
    setMatchCheck(check.error || check.matched ? check : null);
    setStep(3);
  }

  function back() {
    setErrors({});
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  }

  function useAsNewVersion() {
    if (!clash) return;
    setMode('new-version');
    setClashTarget(clash);
    setName(clash.name);
    setPublish(false);
    setSetAlias(false);
    setErrors({});
  }

  async function submit() {
    if (!file || !parsed) return;
    setSubmitting(true);
    setErrors({});
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (mode === 'add-to-draft') {
        if (!effectiveTarget || !draft) throw new Error('No draft selected.');
        const upserts = draftUpserts();
        const batches = Math.max(1, Math.ceil(upserts.length / BULK_CHUNK));
        let counts: ImportCounts = NO_COUNTS;
        try {
          for (let i = 0; i < batches; i++) {
            if (controller.signal.aborted)
              throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
            setProgress({ label: `Importing batch ${i + 1} of ${batches}…`, fraction: i / batches });
            const resp = await bulkItems(slug, effectiveTarget.slug, draft.version, {
              upserts: upserts.slice(i * BULK_CHUNK, (i + 1) * BULK_CHUNK),
              on_existing: onExisting,
            });
            counts = addCounts(counts, resp.summary);
          }
        } catch (e) {
          // Earlier batches are already saved: say so and refresh the list.
          if (counts.created + counts.updated > 0) {
            invalidateItems(qc, slug, effectiveTarget.slug);
            if ((e as Error).name === 'AbortError') throw e;
            throw new Error(
              `${errorText(e, 'Import failed')} Saved before the failure: ${importResultText(counts)}.`,
            );
          }
          throw e;
        }
        invalidateItems(qc, slug, effectiveTarget.slug);
        toast.show(importResultText(counts), { tone: 'success' });
        onOpenChange(false);
        onDone({ mode, added: counts.created, dataset: effectiveTarget, version: draft });
        return;
      }
      setProgress({ label: 'Uploading…', fraction: 0 });
      // JSON and JSONL go up as the mapped records (keys renamed, invalid lines left out when skipped), one per line.
      const body =
        parsed.kind === 'json'
          ? new File(
              [
                draftUpserts()
                  .map((u) => JSON.stringify(u))
                  .join('\n'),
              ],
              file.name.replace(/\.[^.]+$/, '') + '.jsonl',
              { type: 'application/x-ndjson' },
            )
          : file;
      const created = await uploadDataset(
        slug,
        body,
        {
          name: mode === 'new' ? name.trim() : (effectiveTarget?.name ?? name.trim()),
          create_only: mode === 'new',
          dataset_ref: mode === 'new-version' ? effectiveTarget?.id : undefined,
          description: mode === 'new' && description ? description : undefined,
          version_name: versionName || undefined,
          publish,
          set_alias: publish && setAlias && canSetProduction,
          format: parsed.kind === 'csv' ? 'csv' : 'jsonl',
          encoding: parsed.kind === 'csv' ? (encoding ?? undefined) : undefined,
          input_cols: mapping.input,
          expected_cols: mapping.expected,
          id_col: mapping.id || undefined,
          metadata_cols: mapping.metadata,
        },
        (fraction) =>
          setProgress({ label: fraction >= 1 ? 'Processing on the server…' : 'Uploading…', fraction }),
        controller.signal,
      );
      void qc.invalidateQueries({ queryKey: ['datasets', slug] });
      void qc.invalidateQueries({ queryKey: ['dataset', slug] });
      void qc.invalidateQueries({ queryKey: ['dataset-versions', slug] });
      const count = created.version?.item_count ?? 0;
      toast.show(
        mode === 'new'
          ? `Dataset "${created.dataset.name}" created · ${pluralize(count, 'item')}`
          : `Version ${created.version.version} of "${created.dataset.name}" created · ${pluralize(count, 'item')}`,
        { tone: 'success' },
      );
      onOpenChange(false);
      onDone({ mode, dataset: created.dataset, version: created.version });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const message = errorText(e, 'Upload failed');
      setErrors({ submit: message });
      toast.show(message, { tone: 'error' });
    } finally {
      setSubmitting(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  function requestClose() {
    if (submitting) return;
    if (file) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const title =
    mode === 'add-to-draft'
      ? `Import into ${draft?.version ?? 'draft'}`
      : mode === 'new-version'
        ? 'Upload a new version'
        : 'Upload dataset';
  const submitLabel =
    mode === 'new' ? 'Create dataset' : mode === 'new-version' ? 'Create version' : 'Add items';
  const steps = ['Source', 'Map columns', 'Review'];
  const noun = isCsv ? 'row' : 'record';
  const visualStep = step;
  // The Review step refuses a file whose records would all import with no input (C013).
  const withInput = useMemo(
    () => (step === 3 && parsed ? recordsWithInput(draftUpserts()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, parsed, mapping],
  );
  const noInput = withInput === 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}
        title={title}
        description="Upload a CSV, TSV, JSON, or JSONL file."
        size="data"
        dismissOnBackdrop={false}
        isKeyboardDismissDisabled={submitting}
        footer={
          <div className={styles.footer}>
            <Button variant="ghost" onPress={requestClose} isDisabled={submitting}>
              Cancel
            </Button>
            <div className={styles.footerEnd}>
              {step > 1 ? (
                <Button
                  variant="neutral"
                  icon={<Icon name="chevron-left" size={12} />}
                  onPress={back}
                  isDisabled={submitting || checking}
                >
                  Back
                </Button>
              ) : null}
              <Button
                variant="primary"
                onPress={next}
                loading={submitting || checking}
                isDisabled={step === 3 && noInput}
                data-testid="wizard-next"
              >
                {step === 3 ? submitLabel : 'Continue'}
              </Button>
            </div>
          </div>
        }
      >
        <ol className={styles.steps} aria-label="Steps">
          {steps.map((label, i) => (
            <li
              key={label}
              className={styles.step}
              aria-current={i + 1 === visualStep ? 'step' : undefined}
              data-done={i + 1 < visualStep ? '' : undefined}
            >
              <span className={styles.stepNum} aria-hidden="true">
                {i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className={styles.body}>
            {mode === 'new' ? (
              <TextField
                label="Name"
                value={name}
                onChange={setName}
                isRequired
                autoFocus
                errorMessage={errors.name}
                isInvalid={Boolean(errors.name)}
                help={
                  clash ? (
                    <span role="alert">
                      A dataset named <strong>{clash.name}</strong> already exists.{' '}
                      <button type="button" className={styles.linkButton} onClick={useAsNewVersion}>
                        Upload as a new version of {clash.name}
                      </button>
                    </span>
                  ) : slugPreview ? (
                    <>
                      Slug: <code>{slugPreview}</code>
                    </>
                  ) : undefined
                }
              />
            ) : (
              <div className={styles.targetLine}>
                <Text variant="sm" tone="muted">
                  {mode === 'new-version' ? 'New version of' : 'Adding items to'}
                </Text>
                <Text variant="md" weight={600}>
                  {effectiveTarget?.name}
                  {mode === 'add-to-draft' && draft ? ` · ${draft.version}` : ''}
                </Text>
              </div>
            )}
            {mode === 'new' ? (
              <Textarea
                label="Description"
                value={description}
                onChange={setDescription}
                rows={2}
                placeholder="Optional"
              />
            ) : null}
            <FileDrop
              inputRef={fileInput}
              file={file}
              onFile={chooseFile}
              error={errors.file}
              parsing={parsing}
              disabled={submitting}
            />
            {parsed ? (
              <div className={styles.fileStatus}>
                <Text variant="sm" tone="muted">
                  Detected format:{' '}
                  <strong>{parsed.kind === 'csv' ? 'CSV' : parsed.format.toUpperCase()}</strong>
                  {parsed.kind === 'csv' && !parsed.error ? (
                    <>
                      {' '}
                      · {pluralize(parsed.rows.length, 'row')} · {pluralize(parsed.headers.length, 'column')}
                    </>
                  ) : null}
                  {parsed.kind === 'json' && !parsed.error ? (
                    <> · {pluralize(parsed.rows.length, 'record')}</>
                  ) : null}
                </Text>
                {parsed.kind === 'csv' ? (
                  <Select
                    label="Encoding"
                    items={CSV_ENCODINGS.map((e) => ({
                      key: e.value,
                      label: e.value === parsed.detectedEncoding ? `${e.label} · detected` : e.label,
                    }))}
                    value={encoding ?? parsed.encoding}
                    onChange={(k) => k && onEncodingChange(String(k))}
                    searchable={false}
                    width={260}
                  />
                ) : null}
                {parsed.kind === 'csv' &&
                parsed.detectedEncoding !== 'utf-8' &&
                (encoding ?? parsed.encoding) === parsed.detectedEncoding ? (
                  <Text variant="sm" tone="muted" data-testid="encoding-note">
                    This file is not UTF-8, so it was read as {encodingLabel(parsed.detectedEncoding)}. Pick
                    another encoding if the text looks wrong.
                  </Text>
                ) : null}
                {parsed.kind === 'csv' && parsed.warnings.length ? (
                  <Text variant="sm" tone="warning" role="status">
                    {parsed.warnings.join(' ')}
                  </Text>
                ) : null}
              </div>
            ) : null}
            {sourceErrors.length && (errors.source || parsed?.error) ? (
              <ul className={styles.errorList} role="alert">
                {sourceErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {jsonErrors.length ? (
              <div className={styles.parseError} role="alert" data-testid="wizard-parse-error">
                <Text variant="sm" tone="danger" as="p">
                  {jsonErrorText(jsonErrors[0]!)}
                  {jsonErrors.length > 1 ? ` (and ${pluralize(jsonErrors.length - 1, 'more line')})` : ''}
                </Text>
                {jsonErrors[0]!.snippet ? (
                  <code className={styles.parseSnippet}>{jsonErrors[0]!.snippet}</code>
                ) : null}
                {canSkip && parsed?.kind === 'json' ? (
                  <Checkbox isSelected={skipBad} onChange={setSkipBad} data-testid="wizard-skip-invalid">
                    {`Skip ${pluralize(jsonErrors.length, 'invalid line')} and import ${pluralize(parsed.rows.length, 'record')}`}
                  </Checkbox>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 && parsed ? (
          <div className={styles.body}>
            <Text variant="base" tone="muted">
              {isCsv
                ? 'Choose what each column becomes. Columns you do not recognise default to Metadata so they are kept; choose Ignore to leave a column out. Several Input (or Expected) columns are combined into one JSON object keyed by column name.'
                : 'Choose what each key of the records becomes. Keys you do not recognise default to Metadata so they are kept; choose Ignore to leave a key out. A record’s own metadata object and labels are kept as they are.'}
            </Text>
            <div className={styles.mapHeader}>
              <Text variant="lg" as="h3">
                Column mapping
              </Text>
              <Button
                variant="neutral"
                onPress={() => setMapping(isCsv ? autoMap(mapKeys) : autoMapJson(mapKeys))}
              >
                Auto-detect columns
              </Button>
            </div>
            <table className={styles.mapTable}>
              <thead>
                <tr>
                  <th scope="col">{isCsv ? 'Column' : 'Key'}</th>
                  <th scope="col">Sample value</th>
                  <th scope="col">Import as</th>
                </tr>
              </thead>
              <tbody>
                {mapKeys.map((col, i) => (
                  <tr key={`${col}-${i}`}>
                    <td className={styles.mono}>{col || <em>(blank)</em>}</td>
                    <td className={styles.sample} dir="auto">
                      {parsed.kind === 'csv' ? (parsed.rows[0]?.[i] ?? '') : sampleValue(parsed.rows, col)}
                    </td>
                    <td>
                      <Select
                        label={`Role for column ${col || i + 1}`}
                        hideLabel
                        items={COLUMN_ROLES.map((r) => ({ key: r.value, label: r.label }))}
                        value={columnRole(mapping, col)}
                        onChange={(k) =>
                          k && setMapping((m) => setColumnRole(m, col, String(k) as ColumnRole))
                        }
                        searchable={false}
                        width={200}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Text variant="sm" tone="muted" aria-live="polite" as="div">
              {mappingSummary(mapping)}
            </Text>
            {errors.mapping ? (
              <Text variant="sm" tone="danger" role="alert">
                {errors.mapping}
              </Text>
            ) : null}
          </div>
        ) : null}

        {step === 3 && parsed ? (
          <div className={styles.body}>
            {mode !== 'add-to-draft' ? (
              <>
                <TextField
                  label="Version name"
                  value={versionName}
                  onChange={setVersionName}
                  placeholder="Optional, e.g. “Q3 refresh”"
                />
                <Text variant="base" tone="muted">
                  {mode === 'new'
                    ? `Creates a new dataset "${name.trim()}" (slug ${slugPreview || 'generated'}) with this file as version v1.`
                    : `Creates version ${nextVersionAfter(latestVersion ?? effectiveTarget?.latest_version?.version) ?? 'v1'} of "${effectiveTarget?.name}" from this file.`}
                </Text>
                <Checkbox isSelected={publish} onChange={setPublish}>
                  Publish immediately
                </Checkbox>
                {publish ? (
                  canSetProduction ? (
                    <Checkbox isSelected={setAlias} onChange={setSetAlias}>
                      Set as production alias
                    </Checkbox>
                  ) : (
                    <div className={styles.tipWrap}>
                      <Checkbox isSelected={false} isDisabled aria-describedby="wizard-production-rule">
                        Set as production alias
                      </Checkbox>
                      <Text variant="sm" tone="muted" id="wizard-production-rule">
                        {PRODUCTION_RULE}
                      </Text>
                    </div>
                  )
                ) : null}
                {publish && setAlias && canSetProduction && effectiveTarget?.production_version ? (
                  <Text variant="sm" tone="warning" role="status">
                    Production moves from {effectiveTarget.production_version.version} to the new version.
                    Runs that target the alias will use it immediately.
                  </Text>
                ) : null}
              </>
            ) : null}
            <Text variant="base" tone="muted">
              {file?.name} ·{' '}
              {parsed.kind === 'csv'
                ? `CSV · ${encodingLabel(encoding ?? parsed.encoding)}`
                : parsed.format.toUpperCase()}
              {' · '}
              {pluralize(parsed.rows.length, parsed.kind === 'csv' ? 'row' : 'record')} · preview shows first{' '}
              {Math.min(10, parsed.rows.length)}
            </Text>
            {mode === 'add-to-draft' && matchCheck ? (
              <div className={styles.matches} data-testid="wizard-matches">
                <Text variant="base" tone="warning" role="status">
                  {matchCheck.matched === null
                    ? `Couldn’t check which ${noun}s match items already in ${draft?.version ?? 'the draft'} (${matchCheck.error}). Matching items are skipped unless you choose Replace.`
                    : matchLine(matchCheck.matched, parsed.rows.length, noun, draft?.version ?? 'the draft')}
                </Text>
                <RadioGroup<OnExisting>
                  label="Matching items"
                  value={onExisting}
                  onChange={setOnExisting}
                  isDisabled={submitting}
                  options={[
                    {
                      value: 'skip',
                      title: 'Skip matching items',
                      help: `Items already in the draft keep their content. Only the new ${noun}s are added.`,
                      testId: 'wizard-skip-matching',
                    },
                    {
                      value: 'replace',
                      title: 'Replace matching items',
                      help: 'The file overwrites their input, expected output, metadata and labels. Each item keeps the old content in its History.',
                      testId: 'wizard-replace-matching',
                    },
                  ]}
                />
              </div>
            ) : null}
            {noInput ? (
              <Text variant="sm" tone="danger" role="alert" data-testid="wizard-no-input">
                {isCsv
                  ? 'No row has an input. Map a column to Input.'
                  : 'No record has an input. Map a key to Input.'}
              </Text>
            ) : null}
            <NotImported keys={mapKeys} mapping={mapping} />
            <PreviewTable parsed={parsed} />
            {progress ? (
              <div className={styles.progress} role="status" aria-live="polite">
                <Text variant="sm" tone="muted">
                  {progress.label}
                </Text>
                <div
                  className={styles.bar}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.fraction === null ? undefined : Math.round(progress.fraction * 100)}
                >
                  <div
                    className={styles.barFill}
                    style={{ width: `${Math.round((progress.fraction ?? 0) * 100)}%` }}
                    data-indeterminate={progress.fraction === null ? '' : undefined}
                  />
                </div>
                <Button variant="ghost" size="sm" onPress={() => abortRef.current?.abort()}>
                  Cancel upload
                </Button>
              </div>
            ) : null}
            {errors.submit ? (
              <Text variant="sm" tone="danger" role="alert" id="wizard-submit-error">
                {errors.submit}
              </Text>
            ) : null}
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this upload?"
        description={`"${file?.name ?? 'The file'}" and your column choices will be lost.`}
        cancelLabel="Keep editing"
        confirmLabel="Discard upload"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

function FileDrop({
  inputRef,
  file,
  onFile,
  error,
  parsing,
  disabled,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  file: File | null;
  onFile: (f: File | null) => void;
  error?: string;
  parsing: boolean;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className={styles.fieldGroup}>
      <span className={styles.fieldLabel} id="wizard-file-label">
        File (CSV, TSV, JSON, or JSONL) *
      </span>
      <div
        className={styles.drop}
        data-over={over ? '' : undefined}
        data-invalid={error ? '' : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
      >
        <input
          ref={inputRef}
          id="wizard-file"
          type="file"
          accept={ACCEPT}
          className={styles.fileInput}
          aria-labelledby="wizard-file-label"
          aria-describedby={error ? 'wizard-file-error' : undefined}
          disabled={disabled}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <label htmlFor="wizard-file" className={styles.dropLabel}>
          {file ? (
            <>
              <Tag kind="data">{file.name}</Tag>
              <span>{parsing ? 'Reading…' : 'Choose another file'}</span>
            </>
          ) : (
            <span>Drag &amp; drop or choose a file</span>
          )}
        </label>
      </div>
      {error ? (
        <Text variant="sm" tone="danger" role="alert" id="wizard-file-error">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

function NotImported({ keys, mapping }: { keys: string[]; mapping: ColumnMapping }) {
  const ignored = ignoredColumns(keys, mapping);
  if (!ignored.length) return null;
  return (
    <Text variant="sm" tone="warning" role="status" as="div">
      Not imported: {ignored.join(', ')}
    </Text>
  );
}

/** The first value a key has in the records, as text, for the Map columns step. */
function sampleValue(rows: Record<string, unknown>[], key: string): string {
  const v = rows.find((r) => r[key] !== undefined)?.[key];
  return v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
}

function PreviewTable({ parsed }: { parsed: Parsed }) {
  let headers: string[];
  let rows: ReactNode[][];
  if (parsed.kind === 'csv') {
    headers = parsed.headers;
    rows = parsed.rows.slice(0, 10);
  } else {
    const keys = new Set<string>();
    for (const r of parsed.rows.slice(0, 10)) for (const k of Object.keys(r)) keys.add(k);
    headers = [...keys];
    rows = parsed.rows
      .slice(0, 10)
      .map((r) =>
        headers.map((k) => (typeof r[k] === 'string' ? (r[k] as string) : JSON.stringify(r[k] ?? ''))),
      );
  }
  return (
    <div className={styles.previewWrap}>
      <table className={styles.preview}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} dir="auto">
                  {String(c ?? '').slice(0, 120)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
