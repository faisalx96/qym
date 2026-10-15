/**
 * The Output region of an expanded item (round 3 P5): heading with Sections | Raw and Expand all / Collapse all, a pass
 * rail for repeat items, up to three pass columns of collapsed key rows. A pass has no colour: its number is text and
 * the verdict tag carries the only tone.
 */
import { useMemo, useState } from 'react';
import { isItemTaskError } from '@/lib/metrics';
import {
  Button,
  CopyButton,
  Icon,
  KeyTree,
  LinkButton,
  SegmentedControl,
  Tag,
  TextBlock,
  allPaths,
  parseStructured,
  useJsonView,
} from '@/ui';
import { bodyText } from '../../lib/itemText';
import { latencyLabel, rowStatus } from '../../lib/rowDisplay';
import { shownPasses } from '../../lib/passSelection';
import { useRunPage } from '../../RunContext';
import { useItemsUi } from './ItemsUi';
import type { MatrixPass } from './MetricMatrix';
import { PassRail } from './PassRail';
import styles from './OutputRegion.module.css';

/** What a pass shows: its parsed output, or the failure as an `error` key that opens by default. */
function outputOf(scoped: MatrixPass['scoped']): { value: unknown; error: boolean } {
  if (isItemTaskError(scoped)) {
    return { value: { error: scoped.error || scoped.__execution_error || 'The task failed' }, error: true };
  }
  return { value: scoped.output_full ?? scoped.output, error: false };
}

export function OutputRegion({
  row,
  passes,
  multi,
  selected,
  onToggle,
  langfuseUrl,
}: {
  row: MatrixPass['scoped'];
  passes: MatrixPass[];
  multi: boolean;
  selected: number[];
  onToggle: (pass: number) => void;
  langfuseUrl: string | null | undefined;
}) {
  const { model, api } = useRunPage();
  const ui = useItemsUi();
  const [view, setView] = useJsonView();
  const shown = multi ? shownPasses(selected) : [passes[0]!.pass];
  const cols = shown.map((p) => passes.find((x) => x.pass === p)!).filter(Boolean);
  const outputs = useMemo(() => new Map(passes.map((p) => [p.pass, outputOf(p.scoped)])), [passes]);
  const prefix = (p: number) => `p${p}`;
  const defaultOpen = useMemo(() => {
    const set = new Set<string>();
    passes.forEach((p) => {
      if (outputs.get(p.pass)?.error) set.add(`${prefix(p.pass)}/error`);
    });
    return set;
  }, [passes, outputs]);
  const [open, setOpen] = useState<Set<string>>(defaultOpen);
  const structured = (p: number) => parseStructured(outputs.get(p)!.value);
  const expandAll = () => {
    const next = new Set<string>();
    cols.forEach((c) => {
      const s = structured(c.pass);
      if (s.structured) allPaths(s.data, prefix(c.pass)).forEach((x) => next.add(x));
    });
    setOpen(next);
  };
  const anyStructured = cols.some((c) => structured(c.pass).structured);
  const keyCount = (p: number) => {
    const s = structured(p);
    return s.structured ? Object.keys(s.data).length : 0;
  };
  const single = passes[0]!.scoped;
  const metric = api.selectedMetric;
  const railPasses = passes.map((p) => ({ pass: p.pass, kind: rowStatus(api.ctx, p.scoped, metric).kind }));
  void row;
  return (
    <section className={styles.region} aria-label="Output" data-kind="output">
      <div className={styles.head}>
        <h3 className={styles.title}>Output</h3>
        <span className={styles.meta}>
          {multi
            ? `${cols.length} of ${passes.length} passes shown`
            : [
                single.latency_ms != null ? latencyLabel(single.latency_ms) : null,
                keyCount(passes[0]!.pass) ? `${keyCount(passes[0]!.pass)} keys` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
        <span className={styles.headActions}>
          {!multi && single.trace_id ? (
            <Button
              size="sm"
              variant="neutral"
              icon={<Icon name="list" size={12} />}
              onPress={() => ui.openTrace(single.item_id, model.viewPass)}
            >
              Trace
            </Button>
          ) : null}
          {!multi && langfuseUrl ? (
            <LinkButton
              size="sm"
              variant="neutral"
              href={langfuseUrl}
              target="_blank"
              rel="noopener noreferrer"
              icon={<Icon name="external" size={12} />}
            >
              Open in Langfuse
            </LinkButton>
          ) : null}
          {!multi ? (
            <CopyButton text={bodyText(outputs.get(passes[0]!.pass)!.value)} label="Copy output" />
          ) : null}
          <SegmentedControl
            label="Output view"
            value={view}
            onChange={setView}
            options={[
              { value: 'sections', label: 'Sections' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label="Expand all output keys"
            isDisabled={view === 'raw' || !anyStructured}
            onPress={expandAll}
          >
            Expand all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Collapse all output keys"
            isDisabled={view === 'raw' || !anyStructured}
            onPress={() => setOpen(new Set(defaultOpen))}
          >
            Collapse all
          </Button>
        </span>
      </div>
      {multi ? <PassRail passes={railPasses} selected={selected} onToggle={onToggle} /> : null}
      {row.output_received === false ? (
        <p className={styles.note} role="note">
          Output not received: this item’s outcome event never reached the platform. The item is left out of
          Execution success and of the means.
        </p>
      ) : (
        <div className={styles.grid} data-n={cols.length} data-single={multi ? undefined : ''}>
          {cols.map((c) => {
            const status = rowStatus(api.ctx, c.scoped, metric);
            const out = outputs.get(c.pass)!;
            const s = structured(c.pass);
            const tone =
              status.kind === 'pass'
                ? 'success'
                : status.kind === 'fail' || status.kind === 'error'
                  ? 'danger'
                  : undefined;
            return (
              <div
                key={c.pass}
                className={styles.col}
                data-pass={multi ? c.pass : undefined}
                data-rail={
                  !multi
                    ? tone === 'success'
                      ? 'success'
                      : tone === 'danger'
                        ? 'danger'
                        : undefined
                    : undefined
                }
              >
                {multi ? (
                  <div className={styles.colHead}>
                    <Tag kind="count">Pass {c.pass}</Tag>
                    <Tag tone={tone} title={status.title || undefined}>
                      {status.kind === 'pass' ? 'Pass' : status.kind === 'fail' ? 'Fail' : status.label}
                    </Tag>
                    {c.scoped.latency_ms != null ? (
                      <span className={styles.latency}>{latencyLabel(c.scoped.latency_ms)}</span>
                    ) : null}
                    <span className={styles.colActions}>
                      {c.scoped.trace_id ? (
                        <Button
                          size="sm"
                          variant="neutral"
                          icon={<Icon name="list" size={12} />}
                          aria-label={`Open trace of pass ${c.pass}`}
                          onPress={() => ui.openTrace(c.scoped.item_id, c.pass)}
                        >
                          Trace
                        </Button>
                      ) : null}
                      <CopyButton text={bodyText(out.value)} label={`Copy pass ${c.pass} output`} />
                    </span>
                  </div>
                ) : null}
                {view === 'raw' ? (
                  <pre className={styles.raw}>{s.structured ? JSON.stringify(s.data, null, 2) : s.text}</pre>
                ) : s.structured ? (
                  <KeyTree
                    value={s.data}
                    idPrefix={prefix(c.pass)}
                    open={open}
                    onOpenChange={setOpen}
                    textMode={ui.textMode}
                  />
                ) : s.text ? (
                  <div className={styles.text}>
                    <TextBlock text={s.text} mode={ui.textMode} />
                  </div>
                ) : (
                  <p className={styles.empty}>No output was recorded.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
