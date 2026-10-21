import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Card } from '@/ui';

describe('Card link opt-out (QG1-3)', () => {
  it('marks the anchor of a to or href card as a block link', () => {
    render(
      <MemoryRouter>
        <Card to="/projects/x" data-testid="to">
          a
        </Card>
        <Card href="/elsewhere" data-testid="href">
          b
        </Card>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('to')).toHaveAttribute('data-link', 'block');
    expect(screen.getByTestId('href')).toHaveAttribute('data-link', 'block');
  });

  it('renders no data-link on a card that is not a link', () => {
    render(
      <>
        <Card data-testid="plain">a</Card>
        <Card onPress={() => undefined} data-testid="press">
          b
        </Card>
      </>,
    );
    expect(screen.getByTestId('plain')).not.toHaveAttribute('data-link');
    expect(screen.getByRole('button')).not.toHaveAttribute('data-link');
  });
});
