import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const rpc = vi.fn(async () => ({ data: { total: 430000, commission: 85000, delivery: 35000 }, error: null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...(args as [])),
    from: () => ({
      select: () => ({
        range: async () => ({
          data: [
            { sku: 'A1', title: 'Producto A', provider_price_gs: 25000 },
            { sku: 'B2', title: 'Producto B', provider_price_gs: 95000 },
          ],
          error: null,
        }),
      }),
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useOrderEditTools } from './OrderEditTools';

function Harness({ order }: { order: any }) {
  const tools = useOrderEditTools(() => undefined);
  return (
    <div>
      <button onClick={() => tools.openEditor(order)}>abrir</button>
      {tools.modal}
    </div>
  );
}

describe('Editar pedido', () => {
  it('recalcula la comisión al cambiar cantidad y precio, y guarda en el servidor', async () => {
    const order = {
      id: 'o1',
      order_number: 'P-1',
      customer_name: 'Ana',
      city: 'Asunción',
      delivery_gs: 35000,
      items_json: [
        { sku: 'A1', qty: 1, sale_gs: 150000 },
        { sku: 'B2', qty: 2, sale_gs: 200000 },
      ],
    };
    render(<Harness order={order} />);
    fireEvent.click(screen.getByText('abrir'));
    await waitFor(() => expect(screen.getByText(/Producto B · proveedor/)).toBeTruthy());

    // 2.º producto: 3 unidades por 280.000
    const qtyInputs = screen.getAllByTitle('Cantidad');
    const priceInputs = screen.getAllByTitle('Precio total de la línea (Gs)');
    fireEvent.change(qtyInputs[1], { target: { value: '3' } });
    fireEvent.change(priceInputs[1], { target: { value: '280000' } });

    // 430.000 − (25.000 + 3 × 95.000) − 35.000 = 85.000
    expect(screen.getByText('Gs 430.000')).toBeTruthy();
    expect(screen.getByText('Gs 85.000')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('💾 Guardar cambios'));
    });
    expect(rpc).toHaveBeenCalledWith('edit_order_items', {
      p_order_id: 'o1',
      p_items: [
        { sku: 'A1', qty: 1, sale_gs: 150000 },
        { sku: 'B2', qty: 3, sale_gs: 280000 },
      ],
      p_delivery_gs: 35000,
    });
  });
});
