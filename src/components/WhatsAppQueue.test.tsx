import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useWhatsAppQueue } from './WhatsAppQueue';

const orders = [
  { id: '1', order_number: 'A1', customer_name: 'Ana Lopez', phone: '0981111111', total_gs: 1000, items_json: [] },
  { id: '2', order_number: 'A2', customer_name: 'Beto Ruiz', phone: '0982222222', total_gs: 2000, items_json: [] },
];

function Harness({ onSent }: { onSent: (id: string) => void }) {
  const q = useWhatsAppQueue({ getPhone: (o) => o.phone, normalizePhone: (p) => `595${p.slice(1)}`, onSent });
  return (
    <div>
      <button onClick={() => q.start(orders)}>go</button>
      {q.ui}
    </div>
  );
}

describe('useWhatsAppQueue', () => {
  it('abre el primero ya y espera los minutos elegidos para el siguiente', () => {
    vi.useFakeTimers();
    localStorage.clear();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const sent: string[] = [];
    render(<Harness onSent={(id) => sent.push(id)} />);
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByRole('button', { name: '5 min' }));
    fireEvent.click(screen.getByText('📲 Empezar'));

    fireEvent.click(screen.getByText('📲 Abrir WhatsApp'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain('https://wa.me/595981111111');
    expect(sent).toEqual(['1']);

    // Durante la espera el botón está deshabilitado
    expect((screen.getByText('📲 Abrir WhatsApp') as HTMLButtonElement).disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    expect((screen.getByText('📲 Abrir WhatsApp') as HTMLButtonElement).disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(61_000); });
    expect((screen.getByText('📲 Abrir WhatsApp') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText('📲 Abrir WhatsApp'));
    expect(String(open.mock.calls[1][0])).toContain('https://wa.me/595982222222');
    expect(sent).toEqual(['1', '2']);
    // Los dos mensajes son distintos
    expect(open.mock.calls[0][0]).not.toBe(open.mock.calls[1][0]);
    vi.useRealTimers();
  });
});
