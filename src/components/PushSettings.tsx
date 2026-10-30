import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { activatePush, deactivatePush, currentPushEndpoint } from '@/lib/pushNotifications';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Prefs = {
  chat_dm: boolean;
  chat_channels: boolean;
  store_sales: boolean;
  order_statuses: string[];
  stock_low: boolean;
  stock_threshold: number;
  new_products: boolean;
  commissions: boolean;
  all_orders: boolean;
};

const DEFAULT_PREFS: Prefs = {
  chat_dm: true,
  chat_channels: false,
  store_sales: true,
  order_statuses: ['ENTREGADO', 'ENCOMIENDA ENTREGADA', 'CANCELADO', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'DEVUELTO A DEPÓSITO'],
  stock_low: true,
  stock_threshold: 5,
  new_products: true,
  commissions: true,
  all_orders: false,
};

// Estados reales de la tabla orders.
const ORDER_STATUSES: Array<[string, string]> = [
  ['PENDIENTE', '⏳'],
  ['EN RUTA', '🚚'],
  ['ENTREGADO', '✅'],
  ['ENCOMIENDA ENTREGADA', '📮'],
  ['REAGENDADO', '📅'],
  ['NO CONTESTA', '📵'],
  ['NO DESEA', '🙅'],
  ['CANCELADO', '❌'],
  ['CANCELÓ POR WHATSAPP', '💬'],
  ['RECHAZADO', '⛔'],
  ['RECHAZADO EN EL LUGAR', '🚪'],
  ['DEVUELTO A DEPÓSITO', '↩️'],
];

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 py-3 cursor-pointer">
      <span>
        <span className="block text-sm font-bold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-primary' : 'bg-secondary'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export default function PushSettings() {
  const { user, profile } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState<Prefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  const isAdmin = role === 'ADMIN';
  const isProvider = role === 'PROVEEDOR';
  const isSeller = role === 'VENDEDOR';
  const isDelivery = role === 'DELIVERY';

  useEffect(() => {
    if (!user) return;
    currentPushEndpoint()
      .then(async endpoint => {
        if (!endpoint) return setActive(false);
        const { data } = await supabase.from('push_subscriptions' as any).select('id').eq('endpoint', endpoint).eq('user_id', user.id).maybeSingle();
        setActive(Boolean(data));
      })
      .catch(() => setActive(false));

    supabase
      .from('notification_preferences' as any)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const next = { ...DEFAULT_PREFS, ...(data as unknown as Partial<Prefs>) };
        setPrefs(next);
        setSaved(next);
      });
  }, [user]);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs(p => ({ ...p, [key]: value }));

  const toggleDevice = async () => {
    if (!user) return;
    setBusy(true);
    try {
      if (active) {
        await deactivatePush();
        setActive(false);
        toast.success('Notificaciones desactivadas en este dispositivo');
      } else {
        await activatePush(user.id);
        setActive(true);
        toast.success('Notificaciones activadas en este dispositivo');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No fue posible cambiar las notificaciones');
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('notification_preferences' as any)
      .upsert({ user_id: user.id, ...prefs, stock_threshold: Math.max(0, Math.round(prefs.stock_threshold || 0)), updated_at: new Date().toISOString() } as any, { onConflict: 'user_id' });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSaved(prefs);
    toast.success('Preferencias de notificaciones guardadas');
  };

  const sendTest = async () => {
    const { error } = await supabase.rpc('push_test' as any);
    if (error) toast.error(error.message);
    else toast.success('Prueba enviada: llega en menos de un minuto');
  };

  const statusSet = new Set(prefs.order_statuses);
  const toggleStatus = (status: string) =>
    set('order_statuses', statusSet.has(status) ? prefs.order_statuses.filter(s => s !== status) : [...prefs.order_statuses, status]);

  return (
    <div className="app-card !p-4 mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-extrabold">🔔 Notificaciones</h4>
          <p className="text-sm text-muted-foreground">
            Elegí qué avisos querés recibir en el celular o la computadora. En iPhone, primero instalá la app en la pantalla de inicio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {active && (
            <button type="button" className="nav-btn" onClick={sendTest}>
              Enviar prueba
            </button>
          )}
          <button type="button" className={`nav-btn ${active ? '' : 'active'}`} disabled={busy || !user} onClick={toggleDevice}>
            {busy ? 'Guardando...' : active ? 'Desactivar en este dispositivo' : 'Activar en este dispositivo'}
          </button>
        </div>
      </div>

      <div className={`rounded-xl border px-3 py-2 text-xs ${active ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
        {active
          ? '✅ Este dispositivo recibe notificaciones.'
          : '⚠️ Este dispositivo todavía no recibe notificaciones. Activalo para que lleguen los avisos que elijas abajo.'}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border px-4 divide-y divide-border">
          <div className="pt-3 text-xs uppercase tracking-wider font-black text-primary">💬 Inbox</div>
          <Toggle label="Mensajes directos" hint="Cuando alguien te escribe por el Chat." checked={prefs.chat_dm} onChange={v => set('chat_dm', v)} />
          <Toggle label="Canales del Chat" hint="Mensajes en los canales generales (pueden ser muchos)." checked={prefs.chat_channels} onChange={v => set('chat_channels', v)} />

          {!isDelivery && (
            <>
              <div className="pt-3 text-xs uppercase tracking-wider font-black text-primary">🛒 Ventas</div>
              <Toggle
                label="Nueva venta en Mi Tienda"
                hint='Ej.: "Nueva venta de Gs. 178.000 · Promo Octubre: Faja ×2".'
                checked={prefs.store_sales}
                onChange={v => set('store_sales', v)}
              />
              <Toggle label="Comisiones" hint="Solicitudes y cambios de estado de comisiones." checked={prefs.commissions} onChange={v => set('commissions', v)} />
            </>
          )}

          {(isSeller || isAdmin) && (
            <Toggle label="Productos nuevos" hint="Cuando se publica un producto nuevo en el catálogo." checked={prefs.new_products} onChange={v => set('new_products', v)} />
          )}

          {(isAdmin || isProvider) && (
            <>
              <div className="pt-3 text-xs uppercase tracking-wider font-black text-primary">📦 Stock</div>
              <Toggle
                label="Stock bajo"
                hint={isAdmin ? 'De todos los productos.' : 'De tus productos.'}
                checked={prefs.stock_low}
                onChange={v => set('stock_low', v)}
              />
              {prefs.stock_low && (
                <label className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm">Avisar cuando queden</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="app-input !w-24 text-center"
                      value={prefs.stock_threshold}
                      onChange={e => set('stock_threshold', Number(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">unidades o menos</span>
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wider font-black text-primary">🚚 Estados de pedidos</div>
              <div className="text-xs text-muted-foreground mt-1">
                Te avisamos cuando {isAdmin && prefs.all_orders ? 'cualquier pedido' : isProvider ? 'un pedido de tus productos' : isDelivery ? 'un pedido asignado a vos' : 'uno de tus pedidos'} pase a:
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" className="text-xs text-primary font-bold px-2 py-1" onClick={() => set('order_statuses', ORDER_STATUSES.map(([s]) => s))}>
                Todos
              </button>
              <button type="button" className="text-xs text-muted-foreground font-bold px-2 py-1" onClick={() => set('order_statuses', [])}>
                Ninguno
              </button>
            </div>
          </div>
          {isAdmin && (
            <div className="mt-2 border-b border-border">
              <Toggle
                label="Pedidos de todos los vendedores"
                hint="Como admin, recibí estos estados en cualquier pedido, no sólo en los tuyos."
                checked={prefs.all_orders}
                onChange={v => set('all_orders', v)}
              />
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ORDER_STATUSES.map(([status, icon]) => {
              const on = statusSet.has(status);
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                    on ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                    {on ? '✓' : ''}
                  </span>
                  <span>{icon}</span>
                  <span className="truncate">{status}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="nav-btn active" disabled={!dirty || saving} onClick={savePrefs}>
          {saving ? 'Guardando...' : 'Guardar preferencias'}
        </button>
        {dirty && <span className="text-xs text-amber-300">Tenés cambios sin guardar</span>}
        <span className="text-xs text-muted-foreground">Las preferencias aplican a todos tus dispositivos.</span>
      </div>
    </div>
  );
}
