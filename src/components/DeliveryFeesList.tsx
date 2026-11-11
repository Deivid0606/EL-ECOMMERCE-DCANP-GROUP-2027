import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PARAGUAY_LOCATIONS } from '@/lib/paraguayLocations';
import { canonKey } from '@/components/CoverageZonesPanel';

/**
 * 📋 Tarifas por delivery: una tarjeta por delivery (nombre, cantidad de
 * ciudades y rango de precios). Al abrirla, sus ciudades ordenadas por
 * departamento. ✏️ Editar abre Zonas con ese delivery; 📋 Copiar pasa sus
 * tarifas a otro delivery.
 */

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

type Fee = { id: string; delivery_email: string; city: string; fee_gs: number };
type User = { email: string; name?: string; role?: string };

const DEPT_BY_KEY = new Map<string, string>();
PARAGUAY_LOCATIONS.forEach((d) => d.cities.forEach((c) => DEPT_BY_KEY.set(canonKey(c), d.department)));
const DEPT_ORDER = PARAGUAY_LOCATIONS.map((d) => d.department);

export default function DeliveryFeesList({
  fees,
  users,
  prices,
  canManage,
  onEdit,
  onDelete,
  onChanged,
}: {
  fees: Fee[];
  users: User[];
  prices: { city: string; departamento?: string | null; active?: boolean }[];
  canManage: boolean;
  onEdit: (email: string) => void;
  onDelete: (id: string) => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const [copyTo, setCopyTo] = useState('');
  const [busy, setBusy] = useState(false);

  const userByEmail = useMemo(() => new Map(users.map((u) => [u.email.toLowerCase(), u])), [users]);
  const covered = useMemo(() => new Set(prices.filter((p) => p.active !== false).map((p) => canonKey(p.city))), [prices]);
  const deptOf = (city: string) => {
    const k = canonKey(city);
    return DEPT_BY_KEY.get(k) || String(prices.find((p) => canonKey(p.city) === k)?.departamento || '').trim() || 'Otros';
  };

  const groups = useMemo(() => {
    const map = new Map<string, Fee[]>();
    for (const f of fees) {
      const e = String(f.delivery_email || '').toLowerCase();
      if (!e) continue;
      if (!map.has(e)) map.set(e, []);
      map.get(e)!.push(f);
    }
    return Array.from(map.entries())
      .map(([email, list]) => {
        const amounts = list.map((f) => Number(f.fee_gs || 0)).filter((n) => n > 0);
        const user = userByEmail.get(email);
        return {
          email,
          name: user?.name || email,
          isProvider: String(user?.role || '').toUpperCase() === 'PROVEEDOR',
          list,
          min: amounts.length ? Math.min(...amounts) : 0,
          max: amounts.length ? Math.max(...amounts) : 0,
          uncovered: list.filter((f) => !covered.has(canonKey(f.city))).length,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }, [fees, userByEmail, covered]);

  const q = search.trim().toLowerCase();
  const shown = groups.filter((g) => !q || g.name.toLowerCase().includes(q) || g.email.includes(q));

  const byDepartment = (list: Fee[]) => {
    const map = new Map<string, Fee[]>();
    for (const f of list) {
      const d = deptOf(f.city);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(f);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        const ia = DEPT_ORDER.indexOf(a);
        const ib = DEPT_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      })
      .map(([d, items]) => [d, items.sort((x, y) => x.city.localeCompare(y.city, 'es'))] as const);
  };

  const copy = async () => {
    const source = groups.find((g) => g.email === copyFrom);
    const target = copyTo.toLowerCase();
    if (!source || !target || target === source.email) return toast.error('Elegí a quién copiar');
    const targetName = userByEmail.get(target)?.name || target;
    const existing = new Map(fees.filter((f) => f.delivery_email.toLowerCase() === target).map((f) => [canonKey(f.city), f]));
    const replaced = source.list.filter((f) => existing.has(canonKey(f.city))).length;
    if (
      !confirm(
        `¿Copiar las ${source.list.length} tarifas de ${source.name} a ${targetName}?` +
          (replaced ? `\n\n${replaced} ciudad(es) que ${targetName} ya tiene se van a reemplazar.` : ''),
      )
    )
      return;
    setBusy(true);
    let errors = 0;
    for (const f of source.list) {
      const prev = existing.get(canonKey(f.city));
      const res = prev
        ? await supabase.from('delivery_fees').update({ fee_gs: f.fee_gs }).eq('id', prev.id)
        : await supabase.from('delivery_fees').insert({ delivery_email: target, city: f.city, fee_gs: f.fee_gs });
      if (res.error) errors++;
    }
    setBusy(false);
    if (errors) toast.error(`${errors} tarifa(s) no se pudieron copiar`);
    else toast.success(`📋 ${source.list.length} tarifas copiadas a ${targetName}`);
    setCopyFrom(null);
    setCopyTo('');
    onChanged();
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-base font-extrabold">📋 Tarifas por delivery</h4>
          <p className="text-xs text-muted-foreground">Tocá un delivery para ver sus ciudades. ⚠️ = tarifa en una ciudad sin cobertura.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="app-input !w-56" placeholder="🔎 Buscar delivery…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="chip text-[11px]">{groups.length} titulares</span>
        </div>
      </div>

      <div className="space-y-2">
        {shown.map((g) => {
          const isOpen = open === g.email;
          return (
            <div key={g.email} className="overflow-hidden rounded-xl border border-border">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(isOpen ? null : g.email)}>
                  <span className="text-xs">{isOpen ? '▾' : '▸'}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold">
                      {g.isProvider ? '🏢' : '🚚'} {g.name}
                      {g.isProvider && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(proveedor)</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {g.list.length} ciudad(es) · {g.min === g.max ? `${nf(g.min)} Gs` : `${nf(g.min)} a ${nf(g.max)} Gs`}
                      {g.uncovered > 0 && <span className="ml-1 text-amber-400">· ⚠️ {g.uncovered} sin cobertura</span>}
                    </span>
                  </span>
                </button>
                {canManage && (
                  <>
                    <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => onEdit(g.email)}>
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      className="nav-btn !px-2 !py-1 !text-[11px]"
                      onClick={() => {
                        setCopyFrom(copyFrom === g.email ? null : g.email);
                        setCopyTo('');
                      }}
                    >
                      📋 Copiar
                    </button>
                  </>
                )}
              </div>

              {copyFrom === g.email && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-3 py-2 text-xs">
                  <span>Copiar sus {g.list.length} tarifas a:</span>
                  <select className="app-input !w-auto !py-1 text-xs" value={copyTo} onChange={(e) => setCopyTo(e.target.value)}>
                    <option value="">Elegí un delivery…</option>
                    {users
                      .filter((u) => u.email.toLowerCase() !== g.email)
                      .map((u) => (
                        <option key={u.email} value={u.email.toLowerCase()}>
                          {u.name || u.email}
                        </option>
                      ))}
                  </select>
                  <button type="button" className="nav-btn active !px-2 !py-1 !text-[11px]" disabled={busy || !copyTo} onClick={() => void copy()}>
                    {busy ? 'Copiando…' : 'Copiar'}
                  </button>
                </div>
              )}

              {isOpen && (
                <div className="space-y-2 border-t border-border px-3 py-2">
                  {byDepartment(g.list).map(([dept, items]) => (
                    <div key={dept}>
                      <div className="mb-1 text-[11px] font-bold uppercase text-muted-foreground">{dept}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((f) => {
                          const ok = covered.has(canonKey(f.city));
                          return (
                            <span
                              key={f.id}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${ok ? 'border-border' : 'border-amber-500/50 bg-amber-500/10'}`}
                              title={ok ? '' : 'La plataforma no cubre esta ciudad'}
                            >
                              {!ok && '⚠️'} {f.city.trim()} <b>{nf(Number(f.fee_gs || 0))}</b>
                              {canManage && (
                                <button type="button" className="ml-0.5 text-muted-foreground hover:text-red-400" title="Eliminar" onClick={() => onDelete(f.id)}>
                                  ✕
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <p className="py-4 text-center text-sm text-muted-foreground">Sin tarifas</p>}
      </div>
    </div>
  );
}
