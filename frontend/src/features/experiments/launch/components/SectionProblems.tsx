import { useLaunch, type SectionId } from '../LaunchContext';
import { plural } from '../../lib/format';
import { Callout } from './Callout';
import { ProblemList } from './ProblemList';

/**
 * "N problems in this section" with the clickable list. `LaunchSection` renders it at the top of
 * its body, so a section normally never uses it directly.
 */
export function SectionProblems({ id }: { id: SectionId }) {
  const { sectionSummary } = useLaunch();
  const { problems } = sectionSummary(id);
  if (!problems.length) return null;
  return (
    <Callout tone="error" title={`${plural(problems.length, 'problem')} in this section`}>
      <ProblemList items={problems} label={`Problems in ${id}`} />
    </Callout>
  );
}
