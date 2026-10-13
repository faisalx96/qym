import type { AnalysisConfig } from '@/api/analysis';
import { Button, DropdownMenu, IconButton, LinkButton, Select, Text } from '@/ui';
import type { PhaseView } from '../useAnalysisPhase';
import type { RunnerState } from '../useAnalysisRunner';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { ProgressBar, shortOutcome, summarize, viewRunTo } from './JobStatus';
import s from './blocks.module.css';

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
 * Sticky action rail: connection, prompt preview, Test, and exactly one primary
 * action per phase (Analyze N / Cancel analysis / View run). Always mounted with a
 * fixed height; every phase renders into the same three slots.
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
  onPreview: () => void;
}) {
  const { runner, test, preview } = ws;
  const job = runner.job;
  const noTargets = ws.targetCount === 0;
  const locked = phase.live || test.testing;
  const testCount = ws.testKeys.length || 1;
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
  } else if (ws.sessionAnalyzed.size) status = `${ws.sessionAnalyzed.size} analyzed this session`;
  else status = '';

  const testButton = test.testing ? (
    <Button size="md" onPress={test.cancel} className={s.railSecondary}>
      Cancel test
    </Button>
  ) : (
    <Button
      size="md"
      onPress={() => void test.run()}
      isDisabled={locked || !ws.llmReady || noTargets}
      className={s.railSecondary}
    >
      {`Test selected (${testCount})`}
    </Button>
  );

  const analyzeLabel = `Analyze ${ws.targetCount} ${ws.targetCount === 1 ? 'item' : 'items'}`;
  let primary;
  if (phase.phase === 'running' || phase.phase === 'cancelling') {
    primary = (
      <Button
        size="md"
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
        <Button size="md" onPress={runner.dismiss} className={s.railSecondary}>
          Analyze again
        </Button>
        <LinkButton
          size="md"
          variant="accent"
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
        <LinkButton size="md" to={viewRunTo(slug, runId, job?.pass_number)} className={s.railSecondary}>
          View run
        </LinkButton>
        <Button size="md" variant="accent" onPress={runner.dismiss} className={s.railPrimary}>
          Analyze again
        </Button>
      </>
    );
  } else {
    primary = (
      <>
        <span className={s.railTest}>{testButton}</span>
        <Button
          size="md"
          variant="accent"
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
          label="LLM connection"
          hideLabel
          items={config.llm_connections.map((c) => ({
            key: c.id,
            label: `${c.name} · ${c.llm_model}${c.llm_api_key_set ? '' : ' · key missing'}`,
            disabled: !c.llm_api_key_set,
          }))}
          value={ws.connectionId}
          onChange={(k) => k != null && ws.setConnectionId(String(k))}
          isDisabled={locked || config.llm_connections.length === 0}
          width="100%"
          className={s.railSelect}
          searchable={false}
          placeholder="No connection"
        />
        <Button size="md" onPress={onPreview} isDisabled={!preview.hasTarget} className={s.railPreview}>
          {preview.characters != null
            ? `Prompt preview · ${preview.characters.toLocaleString()} chars`
            : 'Prompt preview'}
        </Button>
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
      </div>
      <div className={s.railActions}>
        {primary}
        {idleLike ? (
          <span className={s.railMore}>
            <DropdownMenu
              label="More analysis actions"
              placement="top end"
              trigger={<IconButton label="More analysis actions" icon="more" />}
              items={[
                {
                  id: 'test',
                  label: test.testing ? 'Cancel test' : `Test selected (${testCount})`,
                  disabled: test.testing ? false : locked || !ws.llmReady || noTargets,
                },
                { id: 'preview', label: 'Prompt preview', disabled: !preview.hasTarget },
              ]}
              onAction={(id) => {
                if (id === 'preview') onPreview();
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
            size="md"
            variant="danger"
            onPress={runner.cancel}
            isDisabled={phase.phase === 'cancelling'}
            className={s.railPrimary}
          >
            {phase.phase === 'cancelling' ? 'Cancelling…' : 'Cancel analysis'}
          </Button>
        ) : (
          <>
            <Button size="md" onPress={runner.dismiss} className={s.railSecondary}>
              Dismiss
            </Button>
            <Button size="md" onPress={onOpen} className={s.railSecondary}>
              Open results
            </Button>
            <LinkButton
              size="md"
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
