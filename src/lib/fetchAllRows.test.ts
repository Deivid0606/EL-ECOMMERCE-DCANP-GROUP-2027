import { describe, expect, it, vi } from 'vitest';

const rows = Array.from({ length: 2537 }, (_, i) => ({ id: String(i).padStart(5, '0'), status2: i % 3 === 0 ? 'GUIA GENERADA' : null }));
const calls: string[] = [];

vi.mock('@/integrations/supabase/client', () => {
  const make = (head: boolean) => {
    let list = [...rows];
    const q: any = {
      eq: (col: string, val: unknown) => { list = list.filter((r: any) => r[col] === val); return q; },
      order: () => q,
      range: (from: number, to: number) => { calls.push(`range ${from}-${to}`); return Promise.resolve({ data: list.slice(from, to + 1), error: null }); },
      then: (res: any, rej: any) => Promise.resolve(head ? { count: list.length, error: null } : { data: list, error: null }).then(res, rej),
    };
    return q;
  };
  return { supabase: { from: () => ({ select: (_: string, opts?: { head?: boolean }) => make(Boolean(opts?.head)) }) } };
});

import { fetchAllRows } from './fetchAllRows';

describe('fetchAllRows', () => {
  it('trae todas las filas, sin duplicados y en orden', async () => {
    calls.length = 0;
    const { data, error } = await fetchAllRows('orders');
    expect(error).toBeNull();
    expect(data).toHaveLength(2537);
    expect(new Set(data.map((r: any) => r.id)).size).toBe(2537);
    expect(data[0].id).toBe('00000');
    expect(data[2536].id).toBe('02536');
    expect(calls).toHaveLength(3);
  });

  it('aplica los filtros al conteo y a cada página', async () => {
    const { data } = await fetchAllRows('orders', (q) => q.eq('status2', 'GUIA GENERADA'));
    expect(data).toHaveLength(846);
    expect(data.every((r: any) => r.status2 === 'GUIA GENERADA')).toBe(true);
  });

  it('con 0 filas no falla', async () => {
    const { data } = await fetchAllRows('orders', (q) => q.eq('status2', 'NADA'));
    expect(data).toEqual([]);
  });
});
