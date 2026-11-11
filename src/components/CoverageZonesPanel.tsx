import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PARAGUAY_LOCATIONS } from '@/lib/paraguayLocations';

/**
 * 📍 Zonas de cobertura: todas las ciudades de Paraguay por departamento, con
 * interruptor, costo plataforma (lo que se le descuenta al vendedor) y, si se
 * elige un delivery, su costo por ciudad. No se escribe ningún nombre a mano.
 */

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

// Nombre de ciudad → clave: sin acentos, sin mayúsculas, sin «- DEPARTAMENTO» al final.
export const zoneKey = (city: string) =>
  String(city || '')
    .split(' - ')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Nombres que se escriben distinto en la base y en la lista oficial.
const ALIASES: Record<string, string> = {
  juanleonmallorquin: 'doctorjuanleonmallorquin',
  juanleonmalloriquin: 'doctorjuanleonmallorquin',
  karaguatay: 'caraguatay',
  puertopdtefranco: 'presidentefranco',
  puertopresidentefranco: 'presidentefranco',
  asuncioncapital: 'asuncion',
  mauriciojosetroche: 'capitanmauriciojosetroche',
  generalbernardinocaballero: 'caballero',
};
const canonKey = (city: string) => {
  const k = zoneKey(city);
  return ALIASES[k] || k;
};

type PriceRow = { id: string; city: string; departamento: string | null; price_gs: number; active?: boolean };
type FeeRow = { id: string; delivery_email: string; city: string; fee_gs: number };
type Zone = { key: string; city: string; department: string; row?: PriceRow };
type Draft = { on?: boolean; price?: string; fee?: string };

const digits = (v: string) => v.replace(/\D/g, '');

export default function CoverageZonesPanel({
  isAdmin,
  deliveries,
  onSaved,
}: {
  isAdmin: boolean;
  deliveries: { email: string; name?: string; role?: string }[];
  onSaved?: () => void;
}) {
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [show, setShow] = useState<'all' | 'on' | 'off'>('all');
  const [delivery, setDelivery] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkFee, setBulkFee] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [p, f] = await Promise.all([
      supabase.from('client_prices').select('*').order('city'),
      supabase.from('delivery_fees').select('id, delivery_email, city, fee_gs'),
    ]);
    if (p.error) toast.error(p.error.message);
    setPrices((p.data || []) as any);
    setFees((f.data || []) as any);
    setDrafts({});
  };
  useEffect(() => {
    void load();
  }, []);

  // Lista oficial + ciudades guardadas que no están en ella (ej. INTERIOR PAGO ANTICIPADO).
  const zones = useMemo(() => {
    const byKey = new Map<string, Zone>();
    for (const d of PARAGUAY_LOCATIONS) {
      for (const c of d.cities) {
        const key = canonKey(c);
        if (!byKey.has(key)) byKey.set(key, { key, city: c, department: d.department });
      }
    }
    for (const row of prices) {
      const key = canonKey(row.city);
      const zone = byKey.get(key);
      if (zone && !zone.row) zone.row = row;
      else if (!zone) byKey.set(key, { key, city: row.city.trim(), department: String(row.departamento || 'Otros').trim() || 'Otros', row });
    }
    return Array.from(byKey.values());
  }, [prices]);

  const departments = useMemo(() => {
    const order = PARAGUAY_LOCATIONS.map((d) => d.department);
    const extra = Array.from(new Set(zones.map((z) => z.department))).filter((d) => !order.includes(d));
    return [...order, ...extra.sort()];
  }, [zones]);

  const feeByKey = useMemo(() => {
    const map = new Map<string, FeeRow>();
    const target = delivery.toLowerCase();
    if (!target) return map;
    for (const f of fees) {
      if (String(f.delivery_email || '').toLowerCase() !== target) continue;
      const k = canonKey(f.city);
      if (!map.has(k)) map.set(k, f);
    }
    return map;
  }, [fees, delivery]);

  const isOn = (z: Zone) => drafts[z.key]?.on ?? (Boolean(z.row) && z.row!.active !== false);
  const priceOf = (z: Zone) => drafts[z.key]?.price ?? (z.row ? String(z.row.price_gs || '') : '');
  const feeOf = (z: Zone) => drafts[z.key]?.fee ?? (feeByKey.get(z.key) ? String(feeByKey.get(z.key)!.fee_gs || '') : '');
  const setDraft = (key: string, patch: Draft) => setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const q = zoneKey(search);
  const visible = zones.filter(
    (z) =>
      (!dept || z.department === dept) &&
      (!q || z.key.includes(q) || zoneKey(z.department).includes(q)) &&
      (show === 'all' || (show === 'on' ? isOn(z) : !isOn(z))),
  );
  const grouped = departments
    .map((d) => ({ department: d, zones: visible.filter((z) => z.department === d).sort((a, b) => a.city.localeCompare(b.city, 'es')) }))
    .filter((g) => g.zones.length);

  const onCount = zones.filter(isOn).length;
  const dirtyKeys = Object.keys(drafts);

  const setVisibleOn = (on: boolean) => {
    if (!visible.length) return;
    if (!confirm(`¿${on ? 'Prender' : 'Apagar'} ${visible.length} ciudad(es) de la lista?`)) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const z of visible) next[z.key] = { ...next[z.key], on };
      return next;
    });
  };
  const applyToVisibleOn = (field: 'price' | 'fee', value: string) => {
    const v = digits(value);
    if (!v) return toast.error('Escribí el monto');
    const targets = visible.filter(isOn);
    if (!targets.length) return toast.error('No hay ciudades prendidas en la lista');
    setDrafts((prev) => {
      const next = { ...prev };
      for (const z of targets) next[z.key] = { ...next[z.key], [field]: v };
      return next;
    });
    toast.success(`Monto aplicado a ${targets.length} ciudad(es) prendida(s). Tocá Guardar.`);
  };

  const save = async () => {
    const byKey = new Map(zones.map((z) => [z.key, z]));
    const problems: string[] = [];
    for (const key of dirtyKeys) {
      const z = byKey.get(key)!;
      if (isAdmin && isOn(z) && !(Number(digits(priceOf(z))) > 0)) problems.push(z.city);
    }
    if (problems.length) {
      toast.error(`Poné el costo plataforma de: ${problems.slice(0, 6).join(', ')}${problems.length > 6 ? '…' : ''}`, { duration: 9000 });
      return;
    }
    setSaving(true);
    let ok = 0;
    const errors: string[] = [];
    for (const key of dirtyKeys) {
      const z = byKey.get(key)!;
      const d = drafts[key];
      // Nombre con el que se guarda la ciudad (el existente o el oficial).
      const cityName = z.row?.city?.trim() || z.city;
      if (isAdmin && (d.on !== undefined || d.price !== undefined)) {
        const on = isOn(z);
        const price = Number(digits(priceOf(z))) || 0;
        const res = z.row
          ? await (supabase as any).from('client_prices').update({ active: on, price_gs: price || z.row.price_gs }).eq('id', z.row.id)
          : on
            ? await (supabase as any).from('client_prices').insert({ city: z.city, departamento: z.department, price_gs: price, active: true })
            : { error: null };
        if (res.error) errors.push(`${z.city}: ${res.error.message}`);
        else ok++;
      }
      if (delivery && d.fee !== undefined) {
        const fee = Number(digits(d.fee)) || 0;
        const existing = feeByKey.get(key);
        const db = supabase.from('delivery_fees');
        const res = existing
          ? fee
            ? await db.update({ fee_gs: fee }).eq('id', existing.id)
            : await db.delete().eq('id', existing.id)
          : fee
            ? await db.insert({ delivery_email: delivery, city: cityName, fee_gs: fee })
            : { error: null };
        if (res.error) errors.push(`${z.city} (delivery): ${res.error.message}`);
        else ok++;
      }
    }
    setSaving(false);
    if (errors.length) toast.error(`No se guardaron ${errors.length}: ${errors[0]}`, { duration: 12000 });
    if (ok) toast.success('✅ Cambios guardados');
    await load();
    onSaved?.();
  };

  const deliveryName = deliveries.find((d) => d.email.toLowerCase() === delivery.toLowerCase())?.name;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold">📍 Zonas de cobertura</h3>
          <p className="text-xs text-muted-foreground">
            Prendé las ciudades donde se entrega y poné sus precios. Las apagadas no aparecen al cargar pedidos (formulario, Shopify, Mi Tienda y
            páginas). <b>Costo plataforma</b>: lo que se le descuenta al vendedor.
          </p>
        </div>
        <button type="button" className="nav-btn active" disabled={saving || !dirtyKeys.length} onClick={() => void save()}>
          {saving ? 'Guardando…' : `💾 Guardar${dirtyKeys.length ? ` (${dirtyKeys.length})` : ''}`}
        </button>
      </div>

      <div className="mb-3 space-y-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-400">🟢 {onCount} prendidas</span>
          <span className="rounded-full bg-zinc-500/20 px-2 py-0.5 font-bold">⚪ {zones.length - onCount} apagadas</span>
          {dirtyKeys.length > 0 && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-bold text-amber-400">✏️ {dirtyKeys.length} sin guardar</span>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input className="app-input" placeholder="🔎 Buscar ciudad…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="app-input" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select className="app-input" value={show} onChange={(e) => setShow(e.target.value as any)}>
            <option value="all">Prendidas y apagadas</option>
            <option value="on">Solo prendidas</option>
            <option value="off">Solo apagadas</option>
          </select>
          <select className="app-input" value={delivery} onChange={(e) => setDelivery(e.target.value)}>
            <option value="">🛵 Costo delivery de… (elegí)</option>
            {deliveries.map((d) => (
              <option key={d.email} value={d.email.toLowerCase()}>
                {d.name || d.email}
                {String(d.role || '').toUpperCase() === 'PROVEEDOR' ? ' (proveedor)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => setVisibleOn(true)}>
                🟢 Prender las de la lista
              </button>
              <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => setVisibleOn(false)}>
                ⚪ Apagar las de la lista
              </button>
              <input
                className="app-input !w-28 !py-1 text-xs"
                inputMode="numeric"
                placeholder="Plataforma Gs"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(digits(e.target.value))}
              />
              <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => applyToVisibleOn('price', bulkPrice)}>
                Aplicar a las prendidas
              </button>
            </>
          )}
          {delivery && (
            <>
              <input
                className="app-input !w-28 !py-1 text-xs"
                inputMode="numeric"
                placeholder="Delivery Gs"
                value={bulkFee}
                onChange={(e) => setBulkFee(digits(e.target.value))}
              />
              <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => applyToVisibleOn('fee', bulkFee)}>
                Aplicar costo delivery a las prendidas
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Los botones de arriba actúan sobre las ciudades que se ven según la búsqueda y los filtros. Nada se guarda hasta tocar <b>Guardar</b>.
        </p>
      </div>

      <div className="space-y-3">
        {grouped.map((g) => (
          <div key={g.department} className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between bg-secondary/40 px-3 py-2 text-sm font-extrabold">
              <span>
                📍 {g.department} <span className="text-xs font-normal text-muted-foreground">({g.zones.length})</span>
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">{g.zones.filter(isOn).length} prendidas</span>
            </div>
            <div className="divide-y divide-border">
              {g.zones.map((z) => {
                const on = isOn(z);
                const dirty = Boolean(drafts[z.key]);
                return (
                  <div key={z.key} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${on ? '' : 'opacity-60'} ${dirty ? 'bg-amber-500/5' : ''}`}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      disabled={!isAdmin}
                      onClick={() => setDraft(z.key, { on: !on })}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      title={on ? 'Con cobertura: tocá para apagar' : 'Sin cobertura: tocá para prender'}
                    >
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="min-w-[9rem] flex-1 text-sm font-semibold">{z.city}</span>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      Plataforma
                      <input
                        className="app-input !w-28 !py-1 text-right text-sm"
                        inputMode="numeric"
                        placeholder="Gs"
                        disabled={!isAdmin || !on}
                        value={priceOf(z) ? nf(Number(digits(priceOf(z)))) : ''}
                        onChange={(e) => setDraft(z.key, { price: digits(e.target.value) })}
                      />
                    </label>
                    {delivery && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={deliveryName || delivery}>
                        Delivery
                        <input
                          className="app-input !w-28 !py-1 text-right text-sm"
                          inputMode="numeric"
                          placeholder="Gs"
                          disabled={!on}
                          value={feeOf(z) ? nf(Number(digits(feeOf(z)))) : ''}
                          onChange={(e) => setDraft(z.key, { fee: digits(e.target.value) })}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!grouped.length && <p className="py-6 text-center text-sm text-muted-foreground">No hay ciudades con ese filtro.</p>}
      </div>
    </div>
  );
}
