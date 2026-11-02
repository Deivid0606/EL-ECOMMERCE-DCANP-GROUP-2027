import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ViewErrorBoundary, { isChunkError } from './ViewErrorBoundary';

const Boom = ({ msg }: { msg: string }) => {
  throw new Error(msg);
};

describe('ViewErrorBoundary', () => {
  it('reconoce los errores de archivos de una versión vieja', () => {
    expect(isChunkError(new Error('Failed to fetch dynamically imported module: /assets/OrdersView-abc.js'))).toBe(true);
    expect(isChunkError(new Error('x is undefined'))).toBe(false);
  });

  it('muestra un aviso en vez de dejar la pantalla en negro', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ViewErrorBoundary>
        <Boom msg="x is undefined" />
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('Esta pestaña tuvo un problema')).toBeTruthy();
    expect(screen.getByText('Reintentar')).toBeTruthy();
  });
});
