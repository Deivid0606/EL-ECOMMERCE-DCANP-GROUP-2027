import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * ⭐ Proveedores favoritos del admin: si están activos, todas las pestañas cargan
 * sólo pedidos / productos de esos proveedores.
 */
type Scope = {
  isAdmin: boolean;
  favorites: string[];
  active: boolean;
  /** Lo que eligió el admin (aunque todavía no tenga favoritos). */
  wantActive: boolean;
  /** Cambia cada vez que cambia el filtro: las pestañas recargan con esto. */
  version: number;
  setActive: (on: boolean) => void;
  toggleFavorite: (email: string) => Promise<void>;
  inScopeEmails: (emails: (string | null | undefined)[]) => boolean;
  orderInScope: (o: any) => boolean;
  productInScope: (p: any) => boolean;
};

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const ACTIVE_KEY = 'dcanp_fav_providers_active';

const Ctx = createContext<Scope>({
  isAdmin: false,
  favorites: [],
  active: false,
  wantActive: false,
  version: 0,
  setActive: () => {},
  toggleFavorite: async () => {},
  inScopeEmails: () => true,
  orderInScope: () => true,
  productInScope: () => true,
});

export const orderProviderEmails = (o: any): string[] => {
  const out = new Set<string>();
  [o?.provider_email, o?.supplier_email].forEach((e) => lc(e) && out.add(lc(e)));
  String(o?.provider_emails_list || '')
    .split(/[,;\s]+/)
    .forEach((e) => lc(e) && out.add(lc(e)));
  try {
    const items = typeof o?.items_json === 'string' ? JSON.parse(o.items_json) : o?.items_json;
    if (Array.isArray(items)) items.forEach((it: any) => lc(it?.provider_email) && out.add(lc(it.provider_email)));
  } catch {
    /* items inválidos */
  }
  return [...out];
};

export function ProviderScopeProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const isAdmin = String(profile?.role || '').toUpperCase() === 'ADMIN';
  const [favorites, setFavorites] = useState<string[]>([]);
  const [active, setActiveState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user || !isAdmin) {
      setFavorites([]);
      return;
    }
    (supabase as any)
      .from('profiles')
      .select('favorite_providers')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }: any) => {
        setFavorites(((data?.favorite_providers || []) as string[]).map(lc).filter(Boolean));
        setVersion((v) => v + 1);
      });
  }, [user, isAdmin]);

  const setActive = useCallback((on: boolean) => {
    setActiveState(on);
    try {
      localStorage.setItem(ACTIVE_KEY, on ? '1' : '0');
    } catch {
      /* sin storage */
    }
    setVersion((v) => v + 1);
  }, []);

  const toggleFavorite = useCallback(
    async (email: string) => {
      if (!user) return;
      const e = lc(email);
      const next = favorites.includes(e) ? favorites.filter((x) => x !== e) : [...favorites, e];
      setFavorites(next);
      setVersion((v) => v + 1);
      await (supabase as any).from('profiles').update({ favorite_providers: next }).eq('user_id', user.id);
    },
    [favorites, user],
  );

  const on = isAdmin && active && favorites.length > 0;
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const inScopeEmails = useCallback(
    (emails: (string | null | undefined)[]) => !on || emails.some((e) => favSet.has(lc(e))),
    [on, favSet],
  );
  const orderInScope = useCallback((o: any) => !on || orderProviderEmails(o).some((e) => favSet.has(e)), [on, favSet]);
  const productInScope = useCallback((p: any) => !on || favSet.has(lc(p?.provider_email)), [on, favSet]);

  const value = useMemo<Scope>(
    () => ({ isAdmin, favorites, active: on, wantActive: active, version, setActive, toggleFavorite, inScopeEmails, orderInScope, productInScope }),
    [isAdmin, favorites, on, active, version, setActive, toggleFavorite, inScopeEmails, orderInScope, productInScope],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProviderScope = () => useContext(Ctx);

/** Vuelve a cargar la pestaña cuando el admin cambia sus favoritos (no al montar). */
export function useScopeReload(reload: () => void) {
  const { version } = useProviderScope();
  const [first] = useState(version);
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    if (version !== first) ref.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}
