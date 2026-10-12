/**
 * Import wizard (brief 07 §2.3): Source → Map columns (CSV only) → Review.
 * Modes: `new` (catalog), `new-version` (existing dataset), `add-to-draft`.
 * Files are parsed in a Web Worker; `:upload` streams byte progress;
 * add-to-draft upserts in chunks of 1000 with "batch n of m".
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BULK_CHUNK,
  bulkItems,
  invalidateItems,
  uploadDataset,
  type Dataset,
  type DatasetVersion,
  type ItemBody,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Select,
  Tag,
  Text,
  TextField,
  Textarea,
  useToast,
} from '@/ui';
import { CSV_ENCODINGS, encodingLabel } from '../lib/encoding';
import {
  COLUMN_ROLES,
  autoMap,
  columnRole,
  csvUpserts,
  ignoredColumns,
  jsonUpserts,
  mappingSummary,
  setColumnRole,
  type ColumnMapping,
  type ColumnRole,
} from '../lib/mapping';
import { parseFile } from '../lib/parseClient';
import type { CsvParseResult, JsonParseResult } from '../lib/parse.worker';
import { nextVersionAfter, slugifyDatasetName } from '../lib/slugify';
import { PRODUCTION_RULE } from '../lib/versions';
import { pluralize } from '../lib/itemValue';
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
  const [progress, setProgress] = useState<{ label: string; fraction: number | null } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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
      setErrors({ file: 'Could not read the file.' });
      setParsing(false);
      return;
    }
    if (ticket !== parseTicket.current) return; // a newer file / encoding superseded this read
    setParsed(result);
    if (result.kind === 'csv') {
      setEncoding(result.encoding);
      if (!enc || result.headers.length) setMapping(autoMap(result.headers));
    }
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
  const sourceErrors = useMemo(() => {
    const list: string[] = [];
    if (parsed?.error) list.push(parsed.error);
    if (parsed?.kind === 'json' && parsed.errors.length) {
      for (const e of parsed.errors.slice(0, 8)) list.push(`${e.where} ${e.message}.`);
      if (parsed.errors.length > 8) list.push(`…and ${parsed.errors.length - 8} more.`);
    }
    if (parsed?.kind === 'csv' && !parsed.error && !parsed.rows.length)
      list.push('The CSV file has no data rows.');
    return list;
  }, [parsed]);

  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (mode === 'new' && !name.trim()) e.name = 'Name is required.';
    if (!file) e.file = 'Choose a file.';
    else if (parsing) e.file = 'Still reading the file…';
    else if (!parsed || sourceErrors.length) e.file = sourceErrors[0] ?? 'Choose a valid file.';
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
      setStep(isCsv ? 2 : 3);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    } else void submit();
  }

  function back() {
    setErrors({});
    if (step === 3) setStep(isCsv ? 2 : 1);
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
        const upserts: ItemBody[] =
          parsed.kind === 'csv' ? csvUpserts(parsed.headers, parsed.rows, mapping) : jsonUpserts(parsed.rows);
        const batches = Math.max(1, Math.ceil(upserts.length / BULK_CHUNK));
        let added = 0;
        try {
          for (let i = 0; i < batches; i++) {
            if (controller.signal.aborted)
              throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
            setProgress({ label: `Importing batch ${i + 1} of ${batches}…`, fraction: i / batches });
            const resp = await bulkItems(slug, effectiveTarget.slug, draft.version, {
              upserts: upserts.slice(i * BULK_CHUNK, (i + 1) * BULK_CHUNK),
            });
            added += resp.summary.created + resp.summary.updated;
          }
        } catch (e) {
          // Earlier batches are already saved: say so and refresh the list.
          if (added > 0) {
            invalidateItems(qc, slug, effectiveTarget.slug);
            const why =
              e instanceof ApiError ? e.detail || e.message : (e as Error).message || 'Import failed';
            if ((e as Error).name === 'AbortError') throw e;
            throw new Error(`${why} ${pluralize(added, 'item')} were already added before the failure.`);
          }
          throw e;
        }
        invalidateItems(qc, slug, effectiveTarget.slug);
        toast.show(`${pluralize(added, 'item')} added`, { tone: 'success' });
        onOpenChange(false);
        onDone({ mode, added, dataset: effectiveTarget, version: draft });
        return;
      }
      setProgress({ label: 'Uploading…', fraction: 0 });
      const created = await uploadDataset(
        slug,
        file,
        {
          name: mode === 'new' ? name.trim() : (effectiveTarget?.name ?? name.trim()),
          create_only: mode === 'new',
          dataset_ref: mode === 'new-version' ? effectiveTarget?.id : undefined,
          description: mode === 'new' && description ? description : undefined,
          version_name: versionName || undefined,
          publish,
          set_alias: publish && setAlias && canSetProduction,
          format: parsed.kind === 'csv' ? 'csv' : parsed.format,
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
      const message = e instanceof ApiError ? e.detail || e.message : (e as Error).message || 'Upload failed';
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
  const steps = isCsv || !parsed ? ['Source', 'Map columns', 'Review'] : ['Source', 'Review'];
  const visualStep = step === 3 && !isCsv ? 2 : step;

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
                <Button variant="neutral" onPress={back} isDisabled={submitting}>
                  ← Back
                </Button>
              ) : null}
              <Button variant="primary" onPress={next} loading={submitting} data-testid="wizard-next">
                {step === 3 ? submitLabel : 'Continue →'}
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
            {sourceErrors.length && (errors.file || parsed?.kind === 'json' || parsed?.error) ? (
              <ul className={styles.errorList} role="alert">
                {sourceErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {step === 2 && parsed?.kind === 'csv' ? (
          <div className={styles.body}>
            <Text variant="base" tone="muted">
              Choose what each column becomes. Columns you do not recognise default to Metadata so they are
              kept; choose Ignore to leave a column out. Several Input (or Expected) columns are combined into
              one JSON object keyed by column name.
            </Text>
            <div className={styles.mapHeader}>
              <Text variant="lg" as="h3">
                Column mapping
              </Text>
              <Button variant="neutral" onPress={() => setMapping(autoMap(parsed.headers))}>
                Auto-detect columns
              </Button>
            </div>
            <table className={styles.mapTable}>
              <thead>
                <tr>
                  <th scope="col">Column</th>
                  <th scope="col">Sample value</th>
                  <th scope="col">Import as</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((col, i) => (
                  <tr key={`${col}-${i}`}>
                    <td className={styles.mono}>{col || <em>(blank)</em>}</td>
                    <td className={styles.sample} dir="auto">
                      {parsed.rows[0]?.[i] ?? ''}
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
                    : `Creates version ${nextVersionAfter(latestVersion ?? effectiveTarget?.latest_version?.version) ?? 'vN'} of "${effectiveTarget?.name}" from this file.`}
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
            <NotImported parsed={parsed} mapping={mapping} />
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

function NotImported({ parsed, mapping }: { parsed: Parsed; mapping: ColumnMapping }) {
  const ignored = parsed.kind === 'csv' ? ignoredColumns(parsed.headers, mapping) : parsed.unknownKeys;
  if (!ignored.length) return null;
  return (
    <Text variant="sm" tone="warning" role="status" as="div">
      Not imported: {ignored.join(', ')}
      {parsed.kind === 'json'
        ? ' (unknown keys; only item_id/id, input, expected_output/expected, metadata, labels are read)'
        : ''}
    </Text>
  );
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
