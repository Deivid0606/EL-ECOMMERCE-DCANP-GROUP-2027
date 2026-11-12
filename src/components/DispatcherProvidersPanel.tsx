import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Person = { user_id: string; email: string; name: string };

/**
 * Admin: qué proveedores puede despachar cada despachante (kind 'dispatcher') o
 * ver cada delivery en «Asignar Pedidos» (kind 'delivery'). Sin proveedores
 * marcados ve todos (como antes).
 */
const KINDS = {
  dispatcher: { table: 'dispatcher_providers', col: 'dispatcher_email', role: 'DESPACHANTE', title: '🚚 Despachantes y proveedores', verb: 'despachar', who: 'despachante', none: 'No hay despachantes aprobados.', count: 'Despacha' },
  delivery: { table: 'delivery_providers', col: 'delivery_email', role: 'DELIVERY', title: '🛵 Deliverys y proveedores', verb: 'ver en Asignar Pedidos', who: 'delivery', none: 'No hay deliverys aprobados.', count: 'Ve' },
} as const;

export default function DispatcherProvidersPanel({ dispatcherEmail, kind = 'dispatcher' }: { dispatcherEmail?: string; kind?: keyof typeof KINDS } = {}) {
  const K = KINDS[kind];
  const [dispatchers, setDispatchers] = useState<Person[]>([]);
  const [providers, setProviders] = useState<Person[]>([]);
  const [links, setLinks] = useState<{ dispatcher_email: string; provider_email: string }[]>([]);
  const [selected, setSelected] = useState(String(dispatcherEmail || '').toLowerCase());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('role', [K.role, 'PROVEEDOR'])
      .eq('approved', true);
    const ids = [...new Set((roles || []).map((r: any) => r.user_id))];
    const { data: people } = ids.length
      ? await supabase.from('profiles').select('user_id, email, name').in('user_id', ids)
      : { data: [] as any[] };
    const byId = new Map((people || []).map((p: any) => [p.user_id, p]));
    const pick = (role: string) =>
      (roles || [])
        .filter((r: any) => r.role === role && byId.get(r.user_id))
        .map((r: any) => {
          const p: any = byId.get(r.user_id);
          return { user_id: p.user_id, email: String(p.email || '').toLowerCase(), name: p.name || p.email };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    setDispatchers(pick(K.role));
    setProviders(pick('PROVEEDOR'));
    const { data: l } = await (supabase as any).from(K.table).select(`${K.col}, provider_email`);
    setLinks((l || []).map((x: any) => ({ dispatcher_email: String(x[K.col]).toLowerCase(), provider_email: String(x.provider_email).toLowerCase() })));
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected && dispatchers.length) setSelected(dispatchers[0].email);
  }, [dispatchers, selected]);

  const assigned = useMemo(
    () => new Set(links.filter((l) => l.dispatcher_email === selected).map((l) => l.provider_email)),
    [links, selected],
  );

  const toggle = async (providerEmail: string) => {
    if (!selected) return;
    setBusy(true);
    const on = assigned.has(providerEmail);
    const { error } = on
      ? await (supabase as any).from(K.table).delete().eq(K.col, selected).eq('provider_email', providerEmail)
      : await (supabase as any).from(K.table).insert({ [K.col]: selected, provider_email: providerEmail });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLinks((prev) =>
      on
        ? prev.filter((l) => !(l.dispatcher_email === selected && l.provider_email === providerEmail))
        : [...prev, { dispatcher_email: selected, provider_email: providerEmail }],
    );
  };

  return (
    <section className="mb-4 rounded-2xl border border-border p-4 shadow-sm">
      <h4 className="text-lg font-black">{K.title}</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Elegí qué proveedores puede {K.verb} cada {K.who}. Si no marcás ninguno, ve todos los pedidos.
      </p>
      {!dispatchers.length ? (
        <div className="text-sm text-muted-foreground">{K.none}</div>
      ) : (
        <>
          {!dispatcherEmail && <select className="app-input mb-3 max-w-md" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {dispatchers.map((d) => (
              <option key={d.email} value={d.email}>
                {d.name} — {d.email}
              </option>
            ))}
          </select>}
          <div className="mb-2 text-xs font-bold">
            {assigned.size ? `${K.count} ${assigned.size} proveedor(es)` : 'Sin restricción: ve todos los proveedores'}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => (
              <label
                key={p.email}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${assigned.has(p.email) ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border'}`}
              >
                <input type="checkbox" disabled={busy} checked={assigned.has(p.email)} onChange={() => void toggle(p.email)} />
                <span className="min-w-0 truncate">
                  <b>{p.name}</b> <span className="text-xs text-muted-foreground">{p.email}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
