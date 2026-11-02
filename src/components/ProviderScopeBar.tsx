import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProviderScope } from '@/lib/providerScope';

type Provider = { email: string; name: string };

/** ⭐ Barra del admin: proveedores favoritos y «ver sólo favoritos / ver todos». */
export default function ProviderScopeBar() {
  const { isAdmin, favorites, active, wantActive, setActive, toggleFavorite } = useProviderScope();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!isAdmin || !open || providers.length) return;
    (async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'PROVEEDOR').eq('approved', true);
      const ids = (roles || []).map((r: any) => r.user_id);
      if (!ids.length) return;
      const { data } = await supabase.from('profiles').select('email, name').in('user_id', ids);
      setProviders(
        (data || [])
          .filter((p: any) => p.email)
          .map((p: any) => ({ email: String(p.email).toLowerCase(), name: p.name || p.email }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })();
  }, [isAdmin, open, providers.length]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return providers
      .filter((p) => !t || p.name.toLowerCase().includes(t) || p.email.includes(t))
      .sort((a, b) => Number(favorites.includes(b.email)) - Number(favorites.includes(a.email)));
  }, [providers, q, favorites]);

  if (!isAdmin) return null;

  return (
    <div className="mb-3">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${
          active ? 'border-amber-400/50 bg-amber-500/10' : 'border-border bg-card/40'
        }`}
      >
        <b className="text-sm">⭐ Proveedores</b>
        <div className="inline-flex overflow-hidden rounded-full border border-border">
          <button
            type="button"
            className={`px-3 py-1 font-bold ${wantActive ? 'bg-amber-500 text-black' : 'text-muted-foreground'}`}
            onClick={() => setActive(true)}
          >
            Sólo favoritos{favorites.length ? ` (${favorites.length})` : ''}
          </button>
          <button
            type="button"
            className={`px-3 py-1 font-bold ${!wantActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            onClick={() => setActive(false)}
          >
            Todos
          </button>
        </div>
        <span className="text-muted-foreground">
          {active
            ? 'Todas las pestañas muestran sólo pedidos y productos de tus favoritos.'
            : wantActive && !favorites.length
              ? 'Todavía no marcaste favoritos: se ve todo.'
              : 'Se ven todos los proveedores.'}
        </span>
        <button type="button" className="nav-btn ml-auto !px-3 !py-1 !text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cerrar' : '⭐ Elegir favoritos'}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-2xl border border-border bg-background p-3 shadow-xl">
          <input className="app-input mb-2" placeholder="🔎 Buscar proveedor…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => {
              const fav = favorites.includes(p.email);
              return (
                <button
                  key={p.email}
                  type="button"
                  onClick={() => void toggleFavorite(p.email)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                    fav ? 'border-amber-400/60 bg-amber-500/10' : 'border-border hover:bg-secondary/40'
                  }`}
                >
                  <span className="text-lg">{fav ? '⭐' : '☆'}</span>
                  <span className="min-w-0 truncate">
                    <b>{p.name}</b> <span className="text-xs text-muted-foreground">{p.email}</span>
                  </span>
                </button>
              );
            })}
            {!shown.length && <div className="p-3 text-sm text-muted-foreground">Cargando proveedores…</div>}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Se guarda solo. La próxima vez que inicies sesión ya arranca con tus favoritos.</p>
        </div>
      )}
    </div>
  );
}
