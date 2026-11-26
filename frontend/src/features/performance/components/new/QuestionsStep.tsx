/** New run, step 4: the dataset the questions come from, how the kinds are mixed, and a few sample questions. */
import { useRef, useState } from 'react';
import { useDatasetItems, useDatasetVersions, type DatasetItem } from '@/api/datasets';
import type { PerformanceDataset, PerformanceMix, PerformanceTier } from '@/api/performance';
import { projectPath } from '@/app/routes';
import { formatShortDay } from '@/lib/dates';
import { textDirAttrs } from '@/lib/text';
import {
  Button,
  DatasetTag,
  ErrorState,
  Icon,
  Select,
  Skeleton,
  Slider,
  StatusMark,
  TextLink,
  UserName,
} from '@/ui';
import { KINDS, KIND_NAME, count } from '../../lib/format';
import { KindTag } from '../shared';
import { SINGLE_KIND_MIX, mixPresets, plural, sameMix, sampleCounts, shiftMix } from './model';
import { KindCount, MixBar, OptionBox, OptionGroup } from './parts';
import styles from './newRun.module.css';

/** How many questions of the chosen dataset are read for the samples. */
const SAMPLE_POOL = 200;
const SAMPLES = 5;

/** The name of a dataset's newest draft version ('v4'): the list read names published versions only. */
function useDraftName(slug: string, item: PerformanceDataset, draft: boolean): string | null {
  const versions = useDatasetVersions(slug, item.slug, draft);
  const drafts = (versions.data ?? []).filter((version) => version.status === 'draft');
  drafts.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return drafts[0]?.version ?? null;
}

/** One dataset as an option box: the dataset tag with its version, a Draft mark for a draft only, its counts. */
function DatasetOption({ slug, item }: { slug: string; item: PerformanceDataset }) {
  const version = item.latest_published_version;
  const draft = !version;
  const draftName = useDraftName(slug, item, draft);
  const tag = version?.name ?? draftName;
  const kinds = !item.single_kind && item.item_count > 0;
  return (
    <OptionBox
      // A draft cannot be chosen: its value is never the group's.
      value={version?.id ?? `draft:${item.id}`}
      isDisabled={draft}
      data-performance-dataset={version?.id ?? item.id}
    >
      <span className={`${styles.row} ${styles.between}`}>
        <span className={styles.optionTitle}>
          <DatasetTag name={item.name} version={tag} />
        </span>
        {draft ? <StatusMark tone="warning" shape="dot" label="Draft" /> : null}
      </span>
      <span className={styles.figures}>
        {plural(item.item_count, 'question')} · {plural(item.follow_ups, 'follow-up')}
      </span>
      {kinds ? (
        <>
          <MixBar mix={item.tier_counts} />
          <span className={styles.row}>
            {KINDS.map((kind) => (
              <KindCount key={kind} kind={kind} value={item.tier_counts[kind]} />
            ))}
          </span>
        </>
      ) : item.item_count > 0 ? (
        <span>No kinds: all its questions are asked as one kind.</span>
      ) : null}
      <span className={`${styles.row} ${styles.muted}`}>
        Updated {formatShortDay(item.updated_at)}
        {item.updated_by ? (
          <>
            {' '}
            by <UserName id={item.updated_by_user_id} name={item.updated_by} />
          </>
        ) : null}
      </span>
      {draft ? <span>Draft: publish it in Datasets before a run can use it.</span> : null}
    </OptionBox>
  );
}

interface Sample {
  id: string;
  kind: PerformanceTier;
  question: string;
  followUp: boolean;
}

const isKind = (value: unknown): value is PerformanceTier =>
  value === 'simple' || value === 'medium' || value === 'complex';

function toSample(item: DatasetItem, singleKind: boolean): Sample | null {
  const tier = item.metadata?.tier;
  const kind = singleKind ? 'medium' : isKind(tier) ? tier : null;
  if (!kind) return null;
  const question = typeof item.input === 'string' ? item.input : JSON.stringify(item.input);
  return { id: item.item_id, kind, question, followUp: Boolean(item.metadata?.follow_up) };
}

/** Five questions of the dataset in the proportions of the mix; "Show others" turns to the next ones. */
function Samples({
  slug,
  dataset,
  mix,
}: {
  slug: string;
  dataset: PerformanceDataset | null;
  mix: PerformanceMix;
}) {
  const [turn, setTurn] = useState(0);
  const version = dataset?.latest_published_version ?? null;
  const items = useDatasetItems(
    slug,
    dataset?.slug ?? '',
    version?.name ?? '',
    { limit: SAMPLE_POOL, offset: 0 },
    Boolean(dataset && version),
  );
  const pool: Record<PerformanceTier, Sample[]> = { simple: [], medium: [], complex: [] };
  if (dataset && version && items.data)
    for (const item of items.data.items) {
      const sample = toSample(item, dataset.single_kind);
      if (sample) pool[sample.kind].push(sample);
    }
  const counts = sampleCounts(
    mix,
    { simple: pool.simple.length, medium: pool.medium.length, complex: pool.complex.length },
    SAMPLES,
  );
  const shown: Sample[] = [];
  KINDS.forEach((kind, index) => {
    const list = pool[kind];
    const n = Math.min(counts[index] ?? 0, list.length);
    for (let j = 0; j < n; j += 1) shown.push(list[(turn * n + j) % list.length]!);
  });
  const ready = Boolean(dataset && version && items.data);
  return (
    <div className={`${styles.stack} ${styles.rule}`} data-performance-block="samples">
      <div className={`${styles.row} ${styles.between}`}>
        <span className={styles.label}>Sample questions for this mix</span>
        <span className={styles.row}>
          {ready && shown.length && dataset ? (
            <span className={styles.muted}>
              {shown.length} of the {count(dataset.item_count)} in this dataset
            </span>
          ) : null}
          <Button
            onPress={() => setTurn((value) => value + 1)}
            isDisabled={!shown.length}
            disabledReason="There are no sample questions to change"
          >
            Show others
          </Button>
        </span>
      </div>
      {!dataset || !version ? (
        <p className={styles.note}>Choose a dataset to see some of its questions.</p>
      ) : items.isError ? (
        <ErrorState
          compact
          error={items.error}
          title="Couldn’t load the sample questions"
          message="The run can still use this dataset."
          onRetry={() => void items.refetch()}
        />
      ) : !items.data ? (
        <Skeleton kind="rows" rows={SAMPLES} rowHeight={38} label="Reading sample questions" />
      ) : shown.length ? (
        <div className={styles.samples}>
          {shown.map((question) => (
            <div key={question.id} className={styles.sample}>
              <KindTag kind={question.kind} />
              <p className={styles.text} {...textDirAttrs(question.question)}>
                {question.question}
              </p>
              <span className={styles.muted}>{question.followUp ? 'Has a follow-up' : 'No follow-up'}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.note}>
          This dataset has no questions of the kinds the mix asks for. Change the mix or the dataset.
        </p>
      )}
    </div>
  );
}

export interface QuestionsStepProps {
  slug: string;
  /** The project's datasets; undefined while they load. */
  datasets: PerformanceDataset[] | undefined;
  /** Why the datasets could not be read, while they could not; else null. */
  datasetsError: unknown;
  onRetryDatasets: () => void;
  dataset: PerformanceDataset | null;
  onChoose: (versionId: string) => void;
  mix: PerformanceMix;
  /** The usual mix of the chosen test. */
  usualMix: PerformanceMix;
  onMix: (mix: PerformanceMix) => void;
  onUpload: () => void;
}

export function QuestionsStep({
  slug,
  datasets,
  datasetsError,
  onRetryDatasets,
  dataset,
  onChoose,
  mix,
  usualMix,
  onMix,
  onUpload,
}: QuestionsStepProps) {
  // While one slider is dragged the other two keep the proportion they had when the drag began.
  const drag = useRef<{ kind: PerformanceTier; base: PerformanceMix } | null>(null);
  const single = Boolean(dataset?.single_kind);
  const shownMix = single ? SINGLE_KIND_MIX : mix;
  const presets = mixPresets(usualMix, dataset);
  const preset = single
    ? null
    : (presets.find((item) => !item.disabled && sameMix(item.mix, mix))?.key ?? null);

  const move = (kind: PerformanceTier, value: number) => {
    if (drag.current?.kind !== kind) drag.current = { kind, base: mix };
    onMix(shiftMix(drag.current.base, kind, value));
  };

  return (
    <div className={styles.stack}>
      <div className={styles.stack} data-performance-block="datasets">
        <div className={`${styles.row} ${styles.between}`}>
          <span className={styles.label}>Dataset</span>
          <span className={styles.row}>
            <TextLink to={projectPath(slug, 'datasets')}>Open in Datasets</TextLink>
            <Button icon={<Icon name="upload" size={12} />} onPress={onUpload}>
              Upload a file
            </Button>
          </span>
        </div>
        {datasetsError ? (
          <ErrorState
            compact
            error={datasetsError}
            title="Couldn’t load the datasets"
            onRetry={onRetryDatasets}
          />
        ) : !datasets ? (
          <Skeleton kind="cards" count={2} label="Reading the datasets" />
        ) : datasets.length ? (
          <OptionGroup
            label="Dataset"
            columns={2}
            value={dataset?.latest_published_version?.id ?? null}
            onChange={onChoose}
          >
            {datasets.map((item) => (
              <DatasetOption key={item.id} slug={slug} item={item} />
            ))}
          </OptionGroup>
        ) : (
          <p className={styles.note}>
            This project has no dataset a run could use yet. Upload a file of questions, or make a dataset in
            Datasets.
          </p>
        )}
      </div>
      <div className={`${styles.stack} ${styles.rule}`} data-performance-block="mix">
        <div className={`${styles.row} ${styles.between}`}>
          <span className={styles.label}>Mix for this run</span>
          <span className={styles.muted}>
            {single
              ? 'This dataset has no kinds: all its questions are asked as one kind, and the mix is not used.'
              : 'How often each kind of question is asked. Always adds up to 100%.'}
          </span>
        </div>
        <div>
          <Select
            label="Ready-made mix"
            triggerVariant="bar"
            showValue="always"
            value={preset}
            isDisabled={single}
            onChange={(key) => {
              const chosen = presets.find((item) => item.key === key);
              if (!chosen || chosen.disabled) return;
              drag.current = null;
              onMix({ ...chosen.mix });
            }}
            items={presets.map(({ key, label, disabled }) => ({ key, label, disabled }))}
          />
        </div>
        <MixBar mix={shownMix} unit="%" />
        <div className={styles.sliders}>
          {KINDS.map((kind) => (
            <Slider
              key={kind}
              label={KIND_NAME[kind]}
              unit="%"
              value={shownMix[kind]}
              minValue={0}
              maxValue={100}
              isDisabled={single}
              onChange={(value) => move(kind, value)}
              onChangeEnd={() => {
                drag.current = null;
              }}
            />
          ))}
        </div>
      </div>
      <Samples slug={slug} dataset={dataset} mix={shownMix} />
    </div>
  );
}
