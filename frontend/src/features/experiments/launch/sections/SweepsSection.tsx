/**
 * "Sweeps": every swept value is an axis of the run grid. Shows the run-count maths against the cap,
 * the axes with editable chips, and "Link selected" / "Unlink" (linked axes vary together, zipped).
 * The page renders it when something is swept.
 */
import { useMemo, useState } from 'react';
import { Button, Checkbox, Tag } from '@/ui';
import { plural } from '../../lib/format';
import { Callout } from '../components/Callout';
import { LaunchSection } from '../components/LaunchSection';
import { useLaunch } from '../LaunchContext';
import {
  axesOf,
  buildSpec,
  configEntry,
  endpointRefOptions,
  linkAxes,
  locate,
  matchTemplate,
  pointerToFieldName,
  runEstimate,
  unitsInfo,
  sweepLocalErrors,
  unlinkGroup,
  type Axis,
  type DescriptorEntry,
  type FoundSweep,
} from '../model';
import { SweepChips } from '../settings/SweepChips';
import { axisTarget, singleAxis, withPrunedLinks, writeAxis } from '../settings/sweepDoc';
import styles from '../settings/settings.module.css';

export function SweepsSection() {
  const { doc, setDoc, ctx, review, registerField } = useLaunch();
  const [picked, setPicked] = useState<string[]>([]);
  const [linkError, setLinkError] = useState('');

  const spec = useMemo(() => buildSpec(doc, ctx.evaluatorPanel), [doc, ctx.evaluatorPanel]);
  const model = useMemo(() => axesOf(spec), [spec]);
  const info = unitsInfo(doc, ctx.envs);
  const estimate = runEstimate(spec, doc.environmentIds.length, review.count.cap, info);
  const label = (pointer: string) => locate(pointer, ctx).label;
  const linkProblems = useMemo(
    () => sweepLocalErrors(spec, (p) => locate(p, ctx).label).filter((e) => e.pointer.startsWith('/links/')),
    [spec, ctx],
  );
  const selectable = picked.filter((p) => model.axes.some((a) => !a.linked && a.pointers[0] === p));

  const entryOf = (specPointer: string): DescriptorEntry | null => {
    const target = axisTarget(specPointer);
    if (target.kind === 'setting') {
      const template = matchTemplate(ctx.union.fields, target.pointer);
      return template ? (ctx.union.fields[template] ?? null) : null;
    }
    if (target.kind === 'evaluator') return configEntry(ctx.evaluatorPanel, target.name);
    return null;
  };

  const link = () => {
    const result = linkAxes(doc.links, selectable, model.found, label);
    if ('error' in result) {
      setLinkError(result.error);
      return;
    }
    setLinkError('');
    setPicked([]);
    setDoc((d) => ({ ...d, links: result.links }));
  };
  const unlink = (group: number) =>
    setDoc((d) => ({
      ...d,
      links: unlinkGroup(d.links, new Set(model.found.map((f) => f.pointer)), group),
    }));

  const member = (axis: Axis, pointer: string, index: number) => {
    const found = model.found.find((f) => f.pointer === pointer) as FoundSweep;
    const target = axisTarget(pointer);
    const entry = entryOf(pointer);
    const name = label(pointer);
    return (
      <div key={pointer} className={styles.axisMember}>
        <div className={styles.axisName}>
          <span>{name}</span>
          <Tag kind="count">{`× ${axis.lengths[index]}`}</Tag>
          <span className={styles.axisPointer}>{pointer}</span>
        </div>
        {entry && (target.kind === 'setting' || target.kind === 'evaluator') ? (
          <SweepChips
            entry={entry}
            label={name}
            values={found.values}
            endpointKeys={entry.widget === 'endpoint-ref' ? endpointRefOptions(doc, ctx, entry) : []}
            fieldRef={(el) => registerField(pointerToFieldName(pointer), el)}
            onChange={(values) => setDoc((d) => writeAxis(d, target, { sweep: values }))}
            onSingle={() =>
              setDoc((d) => {
                const current =
                  target.kind === 'setting'
                    ? d.values[target.pointer]
                    : target.kind === 'evaluator'
                      ? d.evaluator.config[target.name]
                      : undefined;
                return withPrunedLinks(singleAxis(d, target, current), ctx);
              })
            }
          />
        ) : (
          <p className={styles.hint}>
            {target.kind === 'model'
              ? `${plural(found.values.length, 'model')}. Edit them under Models.`
              : `${plural(found.values.length, 'value')}. Edit them in Raw JSON.`}
          </p>
        )}
      </div>
    );
  };

  return (
    <LaunchSection
      id="sweeps"
      description="Every swept value is an axis of the grid. Linked values vary together (zipped), e.g. model X with temperature 0.2 and model Y with 0.7."
      badge={
        <Tag kind="count" tone={estimate.over ? 'danger' : 'info'}>
          {plural(estimate.runs, 'run')}
        </Tag>
      }
    >
      <p className={styles.math} data-testid="sweep-math">
        {estimate.math}
        {estimate.cap != null ? <span className={styles.hint}>{` (limit ${estimate.cap})`}</span> : null}
      </p>
      {estimate.over ? (
        <Callout tone="error" live>
          {`${estimate.runs} runs is over the limit of ${estimate.cap}. Remove values, link them, or pick fewer environments.`}
        </Callout>
      ) : null}
      {linkProblems.map((p) => (
        <Callout key={p.pointer} tone="error" live>
          {p.message}
        </Callout>
      ))}
      <ul className={styles.axes} aria-label="Sweep axes">
        {model.axes.map((axis) => {
          const first = axis.pointers[0] as string;
          return (
            <li key={axis.pointers.join(' ')} className={styles.axis}>
              <div>
                {axis.linked ? (
                  <Tag kind="accent" title="Zipped: the n-th values run together">
                    linked
                  </Tag>
                ) : (
                  <Checkbox
                    hideLabel
                    isSelected={picked.includes(first)}
                    onChange={(on) => {
                      setLinkError('');
                      setPicked((p) => (on ? [...p, first] : p.filter((x) => x !== first)));
                    }}
                  >
                    {`Select ${label(first)} to link`}
                  </Checkbox>
                )}
              </div>
              <div className={styles.axisBody}>{axis.pointers.map((p, i) => member(axis, p, i))}</div>
              {axis.linked && axis.group !== null ? (
                <button
                  type="button"
                  className={styles.linkBtn}
                  aria-label={`Unlink ${axis.pointers.map(label).join(' and ')}`}
                  onClick={() => unlink(axis.group as number)}
                >
                  Unlink
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.addRow}>
        <Button size="sm" isDisabled={selectable.length < 2} onPress={link}>
          Link selected
        </Button>
        <span className={styles.hint}>
          {selectable.length < 2
            ? 'Select two or more swept values to vary them together.'
            : `${selectable.length} selected`}
        </span>
      </div>
      {linkError ? (
        <p role="alert" className={styles.error}>
          {linkError}
        </p>
      ) : null}
    </LaunchSection>
  );
}
