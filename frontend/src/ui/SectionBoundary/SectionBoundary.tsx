import { Component, type ReactNode } from 'react';
import { ErrorState } from '../ErrorState';

export interface SectionBoundaryProps {
  /** Names the part that failed ("Could not show Repeat run analysis"). */
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A render error inside one report section stays in that section (round 10: a crash in the By pass table blanked
 * the whole run page with "Something went wrong"). Retry renders the section again.
 */
export class SectionBoundary extends Component<SectionBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }

  override render() {
    if (this.state.error)
      return (
        <ErrorState
          compact
          error={this.state.error}
          title={`Could not show ${this.props.name}`}
          onRetry={() => this.setState({ error: null })}
        />
      );
    return this.props.children;
  }
}
