import { projectPath } from '@/app/routes';
import { Button, EmptyState, LinkButton } from '@/ui';

/** Project scope without a run: Analyze run is a landing; guidance tabs stay usable. */
export function ProjectLanding({ slug, onGuidance }: { slug: string; onGuidance?: () => void }) {
  return (
    <EmptyState
      title="Select a run to analyze"
      body="Auto-analysis diagnoses the failed items of one run. Pick a run from the Runs list, then open Auto-analysis from it. Project guidance (diagnosis categories, production rules and documents) applies to the whole project."
      action={
        <>
          <LinkButton to={projectPath(slug)} variant="accent" size="md">
            Open Runs
          </LinkButton>
          {onGuidance ? (
            <Button size="md" onPress={onGuidance}>
              Open project guidance
            </Button>
          ) : null}
        </>
      }
    />
  );
}
