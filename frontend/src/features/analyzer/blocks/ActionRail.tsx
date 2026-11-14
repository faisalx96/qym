import type { ReactNode } from 'react';
import { projectPath } from '@/app/routes';
import type { AnalysisConfig } from '@/api/analysis';
import { ActionTile, Button, CountTile, DropdownMenu, Icon, LinkButton, Select, Text, TextLink } from '@/ui';
import type { PhaseView } from '../useAnalysisPhase';
import type { RunnerState } from '../useAnalysisRunner';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { ProgressBar, shortOutcome, summarize, viewRunTo } from './JobStatus';
import s from './blocks.module.css';
import { APP_LOCALE } from '@/lib/dates';

/** Why Test / Analyze are unavailable, in words, next to the disabled buttons. */
function notice(config: AnalysisConfig, ws: RunWorkspace): string | null {
  if (!config.can_operate_analyzer)
    return 'View only: project managers and the run’s owner can run analysis.';
  if (!config.llm_configured || config.llm_connections.length === 0)
    return 'No LLM connection: add one in project settings to test or analyze.';
  if (!ws.llmReady) return 'Choose a connection with an API key to test or analyze.';
  return null;
}

/**
 * The analyzer model's options (cv5 K5): the model name first, the connection under it. The default connection is
 * the first option, so the trigger takes the "changed" tint only when the person picks another one.
 */
function modelItems(config: AnalysisConfig) {
  const conns = [...config.llm_connections].sort(
    (a, b) => Number(b.id === config.default_connection_id) - Number(a.id === config.default_connection_id),
  );
  const models = conns.map((c) => c.llm_model);
  return conns.map((c) => ({
    key: c.id,
    // Two connections with one model: the connection name tells them apart in the closed control too.
    label: models.filter((m) => m === c.llm_model).length > 1 ? `${c.llm_model} (${c.name})` : c.llm_model,
    description: c.llm_api_key_set ? c.name : `${c.name} · key missing`,
    disabled: !c.llm_api_key_set,
  }));
}

/**
 * Sticky action rail (cv5 K5): one calm row. The analyzer model (labelled, the one dropdown look), the prompt preview
 * button only when there is no prompt pane, the status, then the actions at the end: Test (neutral) and exactly one
 * primary action per phase (Analyze N / Cancel analysis / View run). Always mounted with a fixed height; every phase
 * renders into the same three slots.
 */
export function ActionRail({
  ws,
  config,
  phase,
  slug,
  runId,
  onPreview,
}: {
  ws: RunWorkspace;
  config: AnalysisConfig;
  phase: PhaseView;
  slug: string;
  runId: string;
  /** Opens the preview drawer; absent while the prompt pane shows the preview (no button then). */
  onPreview?: () => void;
}) {
  const { runner, test, preview } = ws;
  const job = runner.job;
  const noTargets = ws.targetCount === 0;
  const locked = phase.live || test.testing;
  // C213: with nothing ticked the test takes the first target, and the label says so
  const testLabel: ReactNode = ws.testKeys.length ? (
    <>
      Test selected<CountTile>{ws.testKeys.length}</CountTile>
    </>
  ) : (
    'Test the first target'
  );
  const sum = job && phase.finished ? summarize(job) : null;
  const blocked = notice(config, ws);

  let status: string;
  let tone: 'muted' | 'danger' | 'warning' = 'muted';
  if (phase.phase === 'starting') status = 'Starting the analysis…';
  else if (phase.phase === 'running' || phase.phase === 'cancelling') {
    status = phase.retryNote ?? (phase.reconnecting ? 'Reconnecting…' : '');
    if (phase.retryNote || phase.reconnecting) tone = 'warning';
  } else if (sum) {
    status =
      phase.phase === 'done'
        ? shortOutcome(sum)
        : phase.phase === 'cancelled'
          ? `Stopped at ${phase.completed} / ${phase.total}`
          : (job?.error ?? 'The analysis failed');
    if (phase.phase === 'failed' || sum.allFailed) tone = 'danger';
    else if (sum.failed) tone = 'warning';
  } else if (test.testing) status = 'Testing…';
  else if (blocked) {
    status = blocked;
    tone = 'warning';
  } else if (ws.sessionAnalyzed.size)
    status = `${ws.sessionAnalyzed.size} ${ws.sessionAnalyzed.size === 1 ? 'target' : 'targets'} analyzed this session`;
  else status = '';

  const testButton = test.testing ? (
    <Button size="sm" onPress={test.cancel} className={s.railSecondary}>
      Cancel test
    </Button>
  ) : (
    <Button
      size="sm"
      onPress={() => void test.run()}
      isDisabled={locked || !ws.llmReady || noTargets}
      className={s.railSecondary}
    >
      {testLabel}
    </Button>
  );

  const analyzeLabel = `Analyze ${ws.targetCount} ${ws.targetCount === 1 ? 'item' : 'items'}`;
  // cv5 Y1: the one main action of each state is the solid primary button; the other start action is neutral.
  let primary;
  if (phase.phase === 'running' || phase.phase === 'cancelling') {
    primary = (
      <Button
        size="sm"
        variant="danger"
        onPress={runner.cancel}
        isDisabled={phase.phase === 'cancelling'}
        className={s.railPrimary}
      >
        {phase.phase === 'cancelling' ? 'Cancelling…' : 'Cancel analysis'}
      </Button>
    );
  } else if (phase.phase === 'done' || phase.phase === 'cancelled') {
    primary = (
      <>
        <Button size="sm" onPress={runner.dismiss} className={s.railSecondary}>
          Analyze again
        </Button>
        <LinkButton
          size="sm"
          variant="primary"
          to={viewRunTo(slug, runId, job?.pass_number)}
          className={s.railPrimary}
        >
          View run
        </LinkButton>
      </>
    );
  } else if (phase.phase === 'failed') {
    primary = (
      <>
        <LinkButton size="sm" to={viewRunTo(slug, runId, job?.pass_number)} className={s.railSecondary}>
          View run
        </LinkButton>
        <Button size="sm" variant="primary" onPress={runner.dismiss} className={s.railPrimary}>
          Analyze again
        </Button>
      </>
    );
  } else {
    primary = (
      <>
        <span className={s.railTest}>{testButton}</span>
        <Button
          size="sm"
          variant="primary"
          onPress={() => void ws.analyze()}
          isDisabled={locked || !ws.llmReady || noTargets}
          loading={phase.phase === 'starting'}
          className={s.railPrimary}
        >
          {analyzeLabel}
        </Button>
      </>
    );
  }

  const idleLike = !phase.live && !phase.finished;
  return (
    <section className={s.rail} aria-label="Analysis actions" data-phase={phase.phase}>
      <div className={s.railLead}>
        <Select
          label="Analyzer model"
          triggerVariant="bar"
          showValue="always"
          placement="top"
          items={modelItems(config)}
          value={ws.connectionId}
          onChange={(k) => k != null && ws.setConnectionId(String(k))}
          isDisabled={locked || config.llm_connections.length === 0}
          className={s.railSelect}
          searchable={false}
        />
        {onPreview ? (
          <Button size="sm" onPress={onPreview} isDisabled={!preview.hasTarget} className={s.railPreview}>
            {preview.characters != null
              ? `Prompt preview · ${preview.characters.toLocaleString(APP_LOCALE)} chars`
              : 'Prompt preview'}
          </Button>
        ) : null}
      </div>
      <div className={s.railStatus}>
        {phase.live && phase.phase !== 'starting' ? (
          <>
            <Text variant="base" tone="secondary" as="span" className={s.railCount}>
              {`${phase.completed} / ${phase.total} targets`}
            </Text>
            <ProgressBar value={phase.completed} max={phase.total} label="Analysis progress" />
          </>
        ) : null}
        <Text
          variant="sm"
          tone={tone}
          as="span"
          role="status"
          aria-live="polite"
          className={s.railText}
          title={status}
        >
          {status}
        </Text>
        {/* Its own element after the notice, so a long notice never cuts the link (cv4 D5). */}
        {status && !config.llm_connections.length && config.can_operate_analyzer ? (
          <TextLink to={`${projectPath(slug, 'settings')}?tab=llm`} className={s.railLink}>
            Open LLM connections
          </TextLink>
        ) : null}
      </div>
      <div className={s.railActions}>
        {primary}
        {idleLike ? (
          <span className={s.railMore}>
            <DropdownMenu
              label="More analysis actions"
              placement="top end"
              trigger={
                <Button size="sm" variant="neutral" icon={<Icon name="more" size={14} />}>
                  Actions
                </Button>
              }
              items={[
                {
                  id: 'test',
                  label: test.testing ? 'Cancel test' : testLabel,
                  icon: <ActionTile icon="play" />,
                  disabled: test.testing ? false : locked || !ws.llmReady || noTargets,
                },
                ...(onPreview
                  ? [
                      {
                        id: 'preview',
                        label: 'Prompt preview',
                        icon: <ActionTile icon="eye" />,
                        disabled: !preview.hasTarget,
                      },
                    ]
                  : []),
              ]}
              onAction={(id) => {
                if (id === 'preview') onPreview?.();
                else if (test.testing) test.cancel();
                else void test.run();
              }}
            />
          </span>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One-line rail for the guidance tabs while a job is live or just finished, in the same
 * fixed-height slot as the full rail, so switching tabs never moves the page.
 */
export function CompactJobRail({
  runner,
  phase,
  slug,
  runId,
  onOpen,
}: {
  runner: RunnerState;
  phase: PhaseView;
  slug: string;
  runId: string;
  onOpen: () => void;
}) {
  const job = runner.job;
  if (!job) return null;
  const sum = phase.finished ? summarize(job) : null;
  return (
    <section className={s.rail} aria-label="Analysis job status" data-phase={phase.phase} data-compact="">
      <div className={s.railStatus}>
        {phase.live ? (
          <>
            <Text variant="base" tone="secondary" as="span" className={s.railCount}>
              {`${phase.completed} / ${phase.total} targets`}
            </Text>
            <ProgressBar value={phase.completed} max={phase.total} label="Analysis progress" />
          </>
        ) : null}
        <Text variant="sm" tone="muted" as="span" role="status" aria-live="polite" className={s.railText}>
          {phase.live
            ? (phase.retryNote ?? (phase.reconnecting ? 'Reconnecting…' : 'Analysis running'))
            : sum
              ? phase.phase === 'done'
                ? shortOutcome(sum)
                : phase.phase === 'cancelled'
                  ? `Stopped at ${phase.completed} / ${phase.total}`
                  : (job.error ?? 'The analysis failed')
              : ''}
        </Text>
      </div>
      <div className={s.railActions}>
        {phase.live ? (
          <Button
            size="sm"
            variant="danger"
            onPress={runner.cancel}
            isDisabled={phase.phase === 'cancelling'}
            className={s.railPrimary}
          >
            {phase.phase === 'cancelling' ? 'Cancelling…' : 'Cancel analysis'}
          </Button>
        ) : (
          <>
            <Button size="sm" onPress={runner.dismiss} className={s.railSecondary}>
              Dismiss
            </Button>
            <Button size="sm" onPress={onOpen} className={s.railSecondary}>
              Open results
            </Button>
            {/* cv5 Y1: the compact rail sits on a guidance tab, which has its own primary create action, so View run is
                the accent button there (one solid green button in a view) */}
            <LinkButton
              size="sm"
              variant="accent"
              to={viewRunTo(slug, runId, job.pass_number)}
              className={s.railPrimary}
            >
              View run
            </LinkButton>
          </>
        )}
      </div>
    </section>
  );
}
