import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Person = { user_id: string; email: string; name: string };

/**
 * Admin: qué proveedores puede despachar cada despachante. Un despachante sin
 * proveedores marcados ve todos los pedidos (como antes).
 */
export default function DispatcherProvidersPanel() {
  const [dispatchers, setDispatchers] = useState<Person[]>([]);
  const [providers, setProviders] = useState<Person[]>([]);
  const [links, setLinks] = useState<{ dispatcher_email: string; provider_email: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: roles } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('role', ['DESPACHANTE', 'PROVEEDOR'])
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
    setDispatchers(pick('DESPACHANTE'));
    setProviders(pick('PROVEEDOR'));
    const { data: l } = await (supabase as any).from('dispatcher_providers').select('dispatcher_email, provider_email');
    setLinks((l || []).map((x: any) => ({ dispatcher_email: String(x.dispatcher_email).toLowerCase(), provider_email: String(x.provider_email).toLowerCase() })));
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
      ? await (supabase as any).from('dispatcher_providers').delete().eq('dispatcher_email', selected).eq('provider_email', providerEmail)
      : await (supabase as any).from('dispatcher_providers').insert({ dispatcher_email: selected, provider_email: providerEmail });
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
      <h4 className="text-lg font-black">🚚 Despachantes y proveedores</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Elegí qué proveedores puede despachar cada despachante. Si no marcás ninguno, ve todos los pedidos.
      </p>
      {!dispatchers.length ? (
        <div className="text-sm text-muted-foreground">No hay despachantes aprobados.</div>
      ) : (
        <>
          <select className="app-input mb-3 max-w-md" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {dispatchers.map((d) => (
              <option key={d.email} value={d.email}>
                {d.name} — {d.email}
              </option>
            ))}
          </select>
          <div className="mb-2 text-xs font-bold">
            {assigned.size ? `Despacha ${assigned.size} proveedor(es)` : 'Sin restricción: ve todos los proveedores'}
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
