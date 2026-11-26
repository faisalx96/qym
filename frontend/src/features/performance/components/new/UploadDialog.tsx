/**
 * Upload a question file: File, Fields, Save. The file is read in the browser whatever its structure, the
 * person confirms which field is what, and the result is saved as a published dataset in the one shape a
 * run reads. The reading and the rules are in `lib/upload`; this is the dialog around them.
 */
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadDataset, type Dataset, type DatasetVersion } from '@/api/datasets';
import { performanceKeys, type PerformanceTier } from '@/api/performance';
import { ApiError } from '@/lib/http';
import { textDirAttrs } from '@/lib/text';
import { Button, Dialog, InlineNotice, SegmentedControl, Select, StatTiles, Stepper, TextField } from '@/ui';
import { KINDS, KIND_NAME } from '../../lib/format';
import {
  GROUP_FIELD,
  UPLOAD_ACCEPT,
  UPLOAD_MAX_BYTES,
  UPLOAD_ROLES,
  buildUpload,
  datasetNameFromFile,
  decodeUploadBytes,
  describeStructure,
  extraFields,
  firstValue,
  followUpAvoidField,
  guessFields,
  isUploadError,
  kindChoice,
  kindCountWords,
  kindValues,
  readQuestionFile,
  uploadFileText,
  uploadProblems,
  type KindChoice,
  type UploadData,
  type UploadMap,
  type UploadResult,
  type UploadRole,
} from '../../lib/upload';
import { KindTag } from '../shared';
import { plural } from './model';
import { Checks } from './parts';
import styles from './newRun.module.css';

type UploadStep = 'file' | 'fields' | 'save';

const STEPS: { id: UploadStep; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'fields', label: 'Fields' },
  { id: 'save', label: 'Save' },
];
const NONE = '__none__';
const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind, label: KIND_NAME[kind] }));
const CHOICE_OPTIONS: { value: KindChoice; label: string }[] = [
  ...KIND_OPTIONS,
  { value: 'leave_out', label: 'Leave out' },
];

export interface UploadDialogProps {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved dataset and its published version, and what was saved into it. */
  onSaved: (saved: { dataset: Dataset; version: DatasetVersion }, result: UploadResult) => void;
  /** A file whose text is already at hand (the gallery, a test): the dialog opens on Fields. */
  initialFile?: { name: string; text: string };
}

interface Loaded {
  name: string;
  data: UploadData;
}

async function fileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

export function UploadDialog(props: UploadDialogProps) {
  // A new body on every opening: the file of last time is gone.
  return props.open ? <UploadDialogBody {...props} /> : null;
}

function UploadDialogBody({ slug, open, onOpenChange, onSaved, initialFile }: UploadDialogProps) {
  const client = useQueryClient();
  const [first] = useState(() => {
    if (!initialFile) return null;
    const read = readQuestionFile(initialFile.name, initialFile.text);
    return isUploadError(read) ? null : { name: initialFile.name, data: read };
  });
  const [step, setStep] = useState<UploadStep>(first ? 'fields' : 'file');
  const [loaded, setLoaded] = useState<Loaded | null>(first);
  const [fileError, setFileError] = useState<{ name: string; message: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [map, setMap] = useState<UploadMap | null>(() => (first ? guessFields(first.data) : null));
  const [choices, setChoices] = useState<Record<string, KindChoice | undefined>>({});
  const [allKind, setAllKind] = useState<PerformanceTier>('medium');
  const [name, setName] = useState(() => (first ? datasetNameFromFile(first.name) : ''));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const data = loaded?.data ?? null;
  const result = useMemo(
    () => (data && map ? buildUpload(data, map, choices, allKind) : null),
    [data, map, choices, allKind],
  );
  const questions = result?.items.length ?? 0;

  function take(fileName: string, text: string) {
    const read = readQuestionFile(fileName, text);
    if (isUploadError(read)) {
      setFileError({ name: fileName, message: read.error });
      setLoaded(null);
      setMap(null);
      setStep('file');
      return;
    }
    setFileError(null);
    setLoaded({ name: fileName, data: read });
    setMap(guessFields(read));
    setChoices({});
    setAllKind('medium');
    setName(datasetNameFromFile(fileName));
    setSaveError(null);
    setStep('fields');
  }

  async function choose(file: File | null | undefined) {
    if (!file) return;
    if (file.size > UPLOAD_MAX_BYTES) {
      setFileError({
        name: file.name,
        message: 'This file is larger than 10 MB, which is too large to read here.',
      });
      return;
    }
    setReading(true);
    try {
      take(file.name, decodeUploadBytes(await fileBytes(file)));
    } catch {
      setFileError({ name: file.name, message: 'The browser could not read this file.' });
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!loaded || !result || !questions || !name.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const file = new File(
        [uploadFileText(result.items)],
        `${loaded.name.replace(/\.[^.]+$/, '') || 'questions'}.jsonl`,
        { type: 'application/x-ndjson' },
      );
      const created = await uploadDataset(slug, file, {
        name: name.trim(),
        create_only: true,
        publish: true,
        set_alias: false,
        format: 'jsonl',
      });
      void client.invalidateQueries({ queryKey: ['datasets', slug] });
      // The list of the New run page is read again before the dialog closes, so the new dataset is in it.
      await client.invalidateQueries({ queryKey: performanceKeys.datasets(slug) });
      onOpenChange(false);
      onSaved(created, result);
    } catch (error) {
      setSaveError(
        error instanceof ApiError
          ? error.detail || error.message
          : 'The platform did not answer. Check the connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void choose(event.dataTransfer.files?.[0]);
  };

  const footer = (
    <>
      <Button size="md" onPress={() => onOpenChange(false)} isDisabled={saving}>
        Cancel
      </Button>
      {step === 'fields' ? (
        <>
          <Button size="md" onPress={() => setStep('file')}>
            Another file
          </Button>
          <Button
            size="md"
            variant="primary"
            aria-label="Continue to Save"
            onPress={() => setStep('save')}
            isDisabled={!questions}
            disabledReason="No question would be saved yet"
          >
            Continue
          </Button>
        </>
      ) : null}
      {step === 'save' ? (
        <>
          <Button size="md" onPress={() => setStep('fields')} isDisabled={saving}>
            Back
          </Button>
          <Button
            size="md"
            variant="primary"
            onPress={() => void save()}
            isDisabled={!questions || !name.trim()}
            disabledReason={questions ? 'Type a name for the dataset first' : 'No question would be saved'}
            loading={saving}
          >
            Save and use for this run
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Upload questions" size="wide" footer={footer}>
      <div className={styles.form} data-performance-block={`upload-${step}`}>
        <Stepper
          aria-label="Upload steps"
          steps={STEPS}
          current={step}
          onSelect={(id) => {
            // A later step opens only once a file is read (and holds a question).
            if (id === 'file' || (loaded && (id === 'fields' || questions))) setStep(id as UploadStep);
          }}
        />
        {step === 'file' ? (
          <>
            <label
              className={styles.drop}
              data-over={over ? '' : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={drop}
            >
              <input
                ref={input}
                type="file"
                accept={UPLOAD_ACCEPT}
                className={styles.fileInput}
                aria-label="Question file"
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <span className={styles.strong}>
                {reading ? 'Reading the file…' : 'Drop a file here, or choose one'}
              </span>
              <span>
                JSON, JSON Lines, CSV, TSV or plain text. The structure can be anything: the questions are
                found and you confirm which field is what.
              </span>
              <span className={styles.note}>
                The file is read in your browser. Nothing is saved until the last step.
              </span>
            </label>
            {fileError ? (
              <InlineNotice tone="danger" lead="Not read.">
                <span className={styles.number}>{fileError.name}</span>: {fileError.message}
              </InlineNotice>
            ) : null}
            {loaded ? (
              <div className={styles.row}>
                <p className={styles.note}>
                  Read before: <span className={styles.number}>{loaded.name}</span>.
                </p>
                <Button onPress={() => setStep('fields')}>Go on with it</Button>
              </div>
            ) : null}
          </>
        ) : null}
        {step === 'fields' && loaded && data && map && result ? (
          <Fields
            loaded={loaded}
            map={map}
            result={result}
            choices={choices}
            allKind={allKind}
            onMap={(role, field) => {
              setMap({ ...map, [role]: field });
              if (role === 'kind') setChoices({});
            }}
            onChoice={(value, choice) => setChoices({ ...choices, [value]: choice })}
            onAllKind={setAllKind}
          />
        ) : null}
        {step === 'save' && loaded && data && result ? (
          <>
            <TextField
              label="Dataset name"
              isRequired
              autoFocus
              value={name}
              onChange={(value) => {
                setName(value);
                setSaveError(null);
              }}
              autoComplete="off"
              help="Saved in this project. It also appears in Datasets, where it can be edited later."
            />
            <dl className={styles.facts}>
              <dt>File</dt>
              <dd className={styles.number}>{loaded.name}</dd>
              <dt>Questions</dt>
              <dd className={styles.figures}>
                {questions}: {kindCountWords(result.tier_counts)}
              </dd>
              <dt>Follow-ups</dt>
              <dd className={styles.figures}>{result.follow_ups}</dd>
              <dt>Left out</dt>
              <dd>
                {result.left_out ? `${plural(result.left_out, 'record')} of ${data.rows.length}` : 'None'}
              </dd>
              <dt>Version</dt>
              {/* A released version shows no status mark; only a draft carries one (B25). */}
              <dd>The first</dd>
            </dl>
            <p className={styles.note}>
              It is published at once so this run can use it. A run keeps the exact version it started with,
              so editing the dataset later does not change old results.
            </p>
            {saveError ? (
              <InlineNotice tone="danger" lead="Not saved.">
                {saveError}
              </InlineNotice>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function Fields({
  loaded,
  map,
  result,
  choices,
  allKind,
  onMap,
  onChoice,
  onAllKind,
}: {
  loaded: Loaded;
  map: UploadMap;
  result: UploadResult;
  choices: Record<string, KindChoice | undefined>;
  allKind: PerformanceTier;
  onMap: (role: UploadRole, field: string) => void;
  onChoice: (value: string, choice: KindChoice) => void;
  onAllKind: (kind: PerformanceTier) => void;
}) {
  const { data } = loaded;
  const groups = data.info.groups;
  const values = kindValues(data, map);
  const extras = extraFields(data, map);
  const followAvoid = followUpAvoidField(data, map);
  const problems = uploadProblems(data, map, result, choices);
  const questions = result.items.length;
  const fieldItems = data.fields
    .filter((field) => field !== GROUP_FIELD)
    .map((field) => ({ key: field, label: field }));

  return (
    <>
      <p className={styles.text}>
        Read <span className={styles.number}>{loaded.name}</span> ({data.info.format}):{' '}
        {describeStructure(data)}.
      </p>
      <div className={styles.upload}>
        <div className={styles.stack}>
          <div className={styles.tight}>
            <span className={styles.label}>Which field is what</span>
            <span className={styles.muted}>
              Guessed from the field names. Change any of them; the result beside it follows.
            </span>
          </div>
          <div>
            {UPLOAD_ROLES.map((role) => {
              const field = map[role.key];
              const items = [
                ...(role.none ? [{ key: NONE, label: role.none }] : []),
                ...(role.key === 'kind' && groups
                  ? [{ key: GROUP_FIELD, label: 'The list it sits in' }]
                  : []),
                ...fieldItems,
              ];
              const example =
                field === GROUP_FIELD
                  ? `The list each question sits in: ${(groups ?? []).join(', ')}`
                  : firstValue(data, field);
              return (
                <div key={role.key} className={styles.role} data-performance-role={role.key}>
                  <div className={styles.tight}>
                    <span className={styles.strong}>{role.label}</span>
                    <span className={styles.muted}>{role.hint}</span>
                  </div>
                  <div className={styles.tight}>
                    <Select
                      label={role.label}
                      hideLabel
                      items={items}
                      value={field || (role.none ? NONE : null)}
                      placeholder="Choose a field"
                      onChange={(key) => onMap(role.key, key === null || key === NONE ? '' : String(key))}
                      isRequired={role.key === 'question'}
                      wrapValue
                    />
                    {example ? (
                      <span className={styles.muted} {...textDirAttrs(example)}>
                        {example}
                      </span>
                    ) : role.key === 'question' ? (
                      <span className={styles.muted}>Choose the field that holds the question text.</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`${styles.tight} ${styles.rule}`} data-performance-block="upload-kinds">
            {map.kind ? (
              <>
                <span className={styles.label}>
                  What each value of “{map.kind === GROUP_FIELD ? 'list name' : map.kind}” means
                </span>
                {values.map((item) => (
                  <div key={item.value} className={styles.kindRow}>
                    <span className={styles.figures}>
                      {item.value || '(empty)'} · {plural(item.records, 'record')}
                    </span>
                    <SegmentedControl
                      label={`Kind of ${item.value || '(empty)'}`}
                      value={kindChoice(choices, item.value)}
                      onChange={(choice) => onChoice(item.value, choice)}
                      options={CHOICE_OPTIONS}
                    />
                  </div>
                ))}
              </>
            ) : (
              <>
                <span className={styles.label}>The file has no kind</span>
                <div className={styles.kindRow}>
                  <span>All questions count as</span>
                  <SegmentedControl
                    label="Kind of all questions"
                    value={allKind}
                    onChange={onAllKind}
                    options={KIND_OPTIONS}
                  />
                </div>
                <p className={styles.note}>The mix for the run then uses only this kind.</p>
              </>
            )}
            {extras.length ? (
              <p className={styles.note}>
                Kept with each question as extra details: {extras.slice(0, 6).join(', ')}
                {extras.length > 6 ? ` and ${extras.length - 6} more` : ''}.
              </p>
            ) : null}
            {followAvoid ? (
              <p className={styles.note}>The words to avoid of a follow-up come from {followAvoid}.</p>
            ) : null}
          </div>
        </div>
        <div className={styles.stack}>
          <span className={styles.label}>What the run will get</span>
          <div className={styles.uploadTiles}>
            <StatTiles
              aria-label="What the run will get"
              items={[
                {
                  key: 'questions',
                  label: 'Questions',
                  value: questions,
                  meaning: 'Questions the dataset will hold',
                },
                ...KINDS.map((kind) => ({
                  key: kind,
                  label: KIND_NAME[kind],
                  value: result.tier_counts[kind],
                  meaning: `${KIND_NAME[kind]} questions`,
                })),
                {
                  key: 'follow-ups',
                  label: 'Follow-ups',
                  value: result.follow_ups,
                  meaning: 'Questions that have a follow-up',
                },
              ]}
            />
          </div>
          {questions ? (
            <>
              <div className={styles.samples} data-columns="2">
                {result.items.slice(0, 4).map((item) => (
                  <div key={item.item_id} className={styles.sample}>
                    <KindTag kind={item.metadata.tier} />
                    <div className={styles.tight}>
                      <p className={styles.text} {...textDirAttrs(item.input)}>
                        {item.input}
                      </p>
                      <span className={styles.muted}>
                        <span className={styles.number}>{item.item_id}</span> ·{' '}
                        {item.metadata.follow_up ? 'has a follow-up' : 'no follow-up'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className={styles.note}>
                The first {Math.min(4, questions)} of {questions}.
                {map.avoid ? ` ${result.with_avoid_words} have a list of words to avoid.` : ''}
              </p>
            </>
          ) : (
            <p className={styles.note}>No questions yet. Choose the field that holds the question text.</p>
          )}
          <Checks items={problems} />
        </div>
      </div>
    </>
  );
}
