import { Button, Select, Text } from '@/ui';
import type { AnalysisConfig } from '@/api/analysis';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import s from './blocks.module.css';

/** Connection select + Test Selected (<=3) + "Analyze N items". */
export function RunBar({
  ws,
  config,
  className,
}: {
  ws: RunWorkspace;
  config: AnalysisConfig;
  className?: string;
}) {
  const { runner, test } = ws;
  const running = runner.busy;
  const testCount = ws.testKeys.length || 1;
  const server = running && runner.job?.progress.total ? runner.job.progress.total : null;
  const noTargets = ws.targetCount === 0;
  return (
    <div className={[s.runBar, className].filter(Boolean).join(' ')}>
      <Select
        label="LLM connection"
        items={config.llm_connections.map((c) => ({
          key: c.id,
          label: `${c.name} · ${c.llm_model}${c.llm_api_key_set ? '' : ' · key missing'}`,
          disabled: !c.llm_api_key_set,
        }))}
        value={ws.connectionId}
        onChange={(k) => k != null && ws.setConnectionId(String(k))}
        isDisabled={running || test.testing || config.llm_connections.length === 0}
        width={240}
        searchable={false}
        placeholder="No connection"
      />
      <div className={s.runBarActions}>
        {test.testing ? (
          <Button size="md" onPress={test.cancel}>
            Cancel test
          </Button>
        ) : (
          <Button size="md" onPress={() => void test.run()} isDisabled={running || !ws.llmReady || noTargets}>
            {`Test Selected (${testCount})`}
          </Button>
        )}
        <Button
          variant="accent"
          size="md"
          onPress={() => void ws.analyze()}
          isDisabled={running || test.testing || !ws.llmReady || noTargets}
          loading={runner.starting}
        >
          {running
            ? 'Analysis running'
            : `Analyze ${ws.targetCount} ${ws.targetCount === 1 ? 'item' : 'items'}`}
        </Button>
      </div>
      <Text variant="sm" tone="muted" as="p" className={s.runBarHint}>
        {server != null
          ? `The server queued ${server} targets.`
          : ws.testKeys.length
            ? `Testing the ${ws.testKeys.length} checked targets (max 3).`
            : 'Tests the previewed target unless you check up to 3. Nothing is saved by a test.'}
      </Text>
    </div>
  );
}
