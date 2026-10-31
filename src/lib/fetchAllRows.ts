import { supabase } from '@/integrations/supabase/client';

const PAGE_SIZE = 1000;
const PARALLEL_PAGES = 6;

/**
 * Trae todas las filas de una tabla (Supabase devuelve como máximo 1.000 por
 * consulta) pidiendo varias páginas a la vez en lugar de una detrás de otra.
 *
 * `apply` agrega filtros y orden; se usa igual para contar y para cada página.
 * Se agrega `id` como desempate para que el paginado sea estable.
 */
export async function fetchAllRows<T = any>(
  table: string,
  apply: (query: any) => any = (q) => q,
  select = '*',
): Promise<{ data: T[]; error: any }> {
  const { count, error: countError } = await apply(
    supabase.from(table as any).select('id', { count: 'exact', head: true }),
  );
  if (countError) return { data: [], error: countError };

  const pages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));
  const page = (n: number) =>
    apply(supabase.from(table as any).select(select))
      .order('id', { ascending: true })
      .range(n * PAGE_SIZE, n * PAGE_SIZE + PAGE_SIZE - 1);

  const results: T[][] = [];
  for (let start = 0; start < pages; start += PARALLEL_PAGES) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(PARALLEL_PAGES, pages - start) }, (_, i) => page(start + i)),
    );
    for (const res of batch) {
      if (res.error) return { data: results.flat(), error: res.error };
      results.push((res.data || []) as T[]);
    }
  }

  // Filas nuevas creadas mientras se descargaba.
  for (let n = pages; (results[n - 1] || []).length === PAGE_SIZE; n++) {
    const res = await page(n);
    if (res.error) break;
    results.push((res.data || []) as T[]);
  }

  // Sin duplicados si alguna fila se movió de página durante la descarga.
  const unique = new Map<string, T>();
  for (const row of results.flat() as any[]) unique.set(String(row?.id), row);
  return { data: Array.from(unique.values()), error: null };
}
