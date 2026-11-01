/**
 * C130: a published version is not a dead end. With an active environment, 'Run experiment on v2' opens the launch
 * form with this dataset and version chosen; without one, the runs empty state keeps the SDK line, copyable.
 */
import { useEvalEnvironments } from '@/api/evalCommon';
import { launchPath } from '@/features/experiments/paths';
import { CopyButton, Icon, LinkButton } from '@/ui';
import styles from './RunOnVersion.module.css';

/** Whether the project has an active environment (`undefined` while it loads). */
export function useCanLaunch(projectId: string): boolean | undefined {
  const envs = useEvalEnvironments(projectId, { active: true });
  return envs.data ? envs.data.length > 0 : undefined;
}

export function RunOnVersionLink({
  slug,
  datasetName,
  version,
}: {
  slug: string;
  datasetName: string;
  version: string;
}) {
  return (
    <LinkButton
      variant="accent"
      icon={<Icon name="play" size={12} />}
      to={launchPath(slug, { dataset: datasetName, version })}
      data-testid="run-on-version"
    >
      Run experiment on {version}
    </LinkButton>
  );
}

/** The SDK line for a project without an environment, with the project it reports to. */
export function SdkLine({ slug, datasetRef }: { slug: string; datasetRef: string }) {
  const line = `Evaluator(task, "${datasetRef}", …)  # with an API key of project ${slug}`;
  return (
    <span className={styles.sdk}>
      <code>{line}</code>
      <CopyButton text={line.replace('…', '')} label="Copy the SDK line" />
    </span>
  );
}
