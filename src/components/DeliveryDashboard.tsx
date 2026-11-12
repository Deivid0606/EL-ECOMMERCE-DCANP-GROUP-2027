import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { addDaysKey, pyFirstOfMonth, pyStart, pyToday } from '@/lib/pyTime';

/**
 * 📊 Dashboard del delivery: lo que tiene para rendir (mismas reglas que
 * Cierres › Pagos), sus rendiciones, su rendimiento y el stock en mano.
 */

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(n || 0));
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const norm = (v: unknown) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
const pyDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : '');
const DELIVERED = ['ENTREGADO', 'ENCOMIENDA ENTREGADA'];
const CANCELLED = ['CANCELADO', 'CANCELÓ POR WHATSAPP', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'NO DESEA', 'DEVUELTO A DEPÓSITO'];

type Order = {
  id: string;
  order_number: string | null;
  status: string | null;
  total_gs: number | null;
  delivery_fee_gs: number | null;
  city: string | null;
  provider_email: string | null;
  provider_emails_list: string | null;
  assigned_delivery: string | null;
  assigned_at: string | null;
  customer_name?: string | null;
};

const providerOf = (o: Order) => lc(o.provider_email) || lc(String(o.provider_emails_list || '').split(/[,;\s]+/)[0]) || 'sin proveedor';

export default function DeliveryDashboard() {
  const { profile } = useAuth();
  const email = lc(profile?.email);
  const [loading, setLoading] = useState(true);
  const [toRender, setToRender] = useState<Order[]>([]);
  const [fees, setFees] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [month, setMonth] = useState<Order[]>([]);
  const [stock, setStock] = useState<{ title: string; qty: number }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openProvider, setOpenProvider] = useState<string | null>(null);

  const today = pyToday();
  const monthStart = pyFirstOfMonth();
  const weekStart = addDaysKey(today, -6);

  useEffect(() => {
    if (!email) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const sel = 'id,order_number,status,total_gs,delivery_fee_gs,city,provider_email,provider_emails_list,assigned_delivery,assigned_at,customer_name';
      const [pending, feeRes, att, subs, monthRes, stockRes] = await Promise.all([
        supabase.from('orders').select(sel).ilike('assigned_delivery', email).in('status', DELIVERED).eq('delivery_settled', false).range(0, 1999),
        (supabase as any).rpc('get_closure_delivery_fees'),
        (supabase as any).from('delivery_attempt_payments').select('id,amount,provider_email,status,day').ilike('delivery_email', email).is('closure_id', null),
        (supabase as any)
          .from('delivery_closure_submissions')
          .select('id,amount_gs,status,created_at,destination_email,rejection_reason')
          .ilike('delivery_email', email)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase.from('orders').select(sel).ilike('assigned_delivery', email).gte('assigned_at', pyStart(monthStart)).range(0, 1999),
        (supabase as any).from('delivery_stock').select('quantity, products(title)').ilike('delivery_email', email).gt('quantity', 0),
      ]);
      if (!alive) return;

      // Igual que Cierres: lo que ya está en un comprobante enviado no se vuelve a rendir.
      const all = ((pending.data || []) as unknown as Order[]);
      const used = new Set<string>();
      const ids = all.map((o) => o.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await (supabase as any).from('delivery_closure_orders').select('order_id').in('order_id', ids.slice(i, i + 200));
        (data || []).forEach((r: any) => used.add(String(r.order_id)));
      }
      if (!alive) return;
      const open = all.filter((o) => !used.has(String(o.id)));
      setToRender(open);
      setFees(feeRes.data || []);
      setAttempts(att.data || []);
      setSubmissions(subs.data || []);
      setMonth((monthRes.data || []) as unknown as Order[]);
      setStock(
        ((stockRes.data || []) as any[])
          .map((r) => ({ title: String(r.products?.title || 'Producto'), qty: Number(r.quantity || 0) }))
          .sort((a, b) => b.qty - a.qty),
      );

      const providerEmails = [...new Set([...open.map(providerOf), ...(att.data || []).map((a: any) => lc(a.provider_email)), ...(subs.data || []).map((s: any) => lc(s.destination_email))])].filter(
        (e) => e.includes('@'),
      );
      if (providerEmails.length) {
        const { data } = await supabase.from('profiles').select('email,name').in('email', providerEmails);
        if (alive) setNames(Object.fromEntries((data || []).map((p: any) => [lc(p.email), p.name || p.email])));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [email, monthStart]);

  const feeOf = (o: Order) => {
    const frozen = Number(o.delivery_fee_gs || 0);
    if (frozen > 0) return frozen;
    const match = fees.find((f: any) => norm(f.delivery_email) === norm(o.assigned_delivery) && norm(f.city) === norm(o.city));
    return Number(match?.fee_gs || 0);
  };

  const byProvider = useMemo(() => {
    const map = new Map<string, { orders: Order[]; collected: number; pay: number; attempts: number }>();
    const entry = (p: string) => map.get(p) || { orders: [], collected: 0, pay: 0, attempts: 0 };
    for (const o of toRender) {
      const p = providerOf(o);
      const e = entry(p);
      e.orders.push(o);
      e.collected += o.status === 'ENTREGADO' ? Number(o.total_gs || 0) : 0;
      e.pay += feeOf(o);
      map.set(p, e);
    }
    for (const a of attempts) {
      const p = lc(a.provider_email) || 'sin proveedor';
      const e = entry(p);
      e.attempts += Number(a.amount || 0);
      map.set(p, e);
    }
    return [...map.entries()]
      .map(([provider, v]) => ({ provider, ...v, net: v.collected - v.pay - v.attempts }))
      .sort((a, b) => b.net - a.net);
  }, [toRender, attempts, fees]);

  const totals = byProvider.reduce(
    (t, p) => ({ collected: t.collected + p.collected, pay: t.pay + p.pay + p.attempts, net: t.net + p.net, orders: t.orders + p.orders.length }),
    { collected: 0, pay: 0, net: 0, orders: 0 },
  );

  const perf = useMemo(() => {
    const count = (from: string, pred: (o: Order) => boolean) => month.filter((o) => pyDay(o.assigned_at) >= from && pred(o)).length;
    const delivered = (o: Order) => DELIVERED.includes(String(o.status || '').toUpperCase());
    const cancelled = (o: Order) => CANCELLED.includes(String(o.status || '').toUpperCase());
    const monthTotal = month.length;
    const monthDelivered = count(monthStart, delivered);
    return {
      today: count(today, delivered),
      todayTotal: count(today, () => true),
      week: count(weekStart, delivered),
      month: monthDelivered,
      cancelled: count(monthStart, cancelled),
      effectiveness: monthTotal ? Math.round((monthDelivered / monthTotal) * 100) : 0,
      monthTotal,
    };
  }, [month, today, weekStart, monthStart]);

  const nameOf = (e: string) => names[e] || e;
  const statusChip = (s: string) =>
    s === 'APROBADO' ? 'bg-emerald-500/20 text-emerald-300' : s === 'RECHAZADO' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300';

  if (loading) return <div className="app-card text-sm text-muted-foreground">Cargando tu dashboard…</div>;

  return (
    <div className="space-y-4">
      <div className="app-card">
        <h3 className="mb-1 text-lg font-extrabold">💰 Lo que tenés para rendir</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Pedidos entregados que todavía no rendiste, con las mismas cuentas que Cierres › Pagos. Para rendir, andá a <b>Cierres</b> y subí el comprobante.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="📦 Pedidos" value={String(totals.orders)} />
          <Kpi label="💵 Cobrado" value={`Gs ${nf(totals.collected)}`} />
          <Kpi label="🛵 Tu pago" value={`Gs ${nf(totals.pay)}`} />
          <Kpi label="➡️ Neto a rendir" value={`Gs ${nf(totals.net)}`} strong />
        </div>
        {byProvider.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">✅ No tenés nada pendiente de rendir</div>
        ) : (
          <div className="space-y-2">
            {byProvider.map((p) => (
              <div key={p.provider} className="overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => setOpenProvider(openProvider === p.provider ? null : p.provider)}
                >
                  <span className="text-sm font-bold">
                    {openProvider === p.provider ? '▾' : '▸'} 🏢 {nameOf(p.provider)} <span className="text-xs font-normal text-muted-foreground">({p.orders.length} pedidos)</span>
                  </span>
                  <span className="text-xs">
                    Cobrado {nf(p.collected)} · Tu pago {nf(p.pay + p.attempts)} · <b className="text-sm">Neto Gs {nf(p.net)}</b>
                  </span>
                </button>
                {openProvider === p.provider && (
                  <div className="border-t border-border px-3 py-2 text-xs">
                    {p.orders.map((o) => (
                      <div key={o.id} className="flex flex-wrap justify-between gap-2 py-0.5">
                        <span>
                          {o.order_number || o.id.slice(0, 8)} · {o.city} · {o.status === 'ENCOMIENDA ENTREGADA' ? '📮 encomienda' : 'entregado'}
                        </span>
                        <span>
                          {o.status === 'ENTREGADO' ? `cobrado ${nf(Number(o.total_gs || 0))}` : 'sin cobro'} · tu pago {nf(feeOf(o))}
                        </span>
                      </div>
                    ))}
                    {p.attempts > 0 && <div className="py-0.5 text-orange-300">💸 Intentos pagados: Gs {nf(p.attempts)}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="app-card">
        <h3 className="mb-3 text-lg font-extrabold">📊 Tu rendimiento</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="✅ Hoy" value={`${perf.today} / ${perf.todayTotal}`} />
          <Kpi label="📅 Últimos 7 días" value={String(perf.week)} />
          <Kpi label="🗓 Este mes" value={String(perf.month)} />
          <Kpi label="❌ Cancelados (mes)" value={String(perf.cancelled)} />
          <Kpi label="🎯 Efectividad (mes)" value={`${perf.effectiveness}%`} strong />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Entregados según el día en que se te asignó el pedido. Efectividad: entregados ÷ {perf.monthTotal} asignados este mes.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="app-card">
          <h3 className="mb-2 text-lg font-extrabold">🧾 Tus últimas rendiciones</h3>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no enviaste comprobantes.</p>
          ) : (
            <div className="divide-y divide-border text-sm">
              {submissions.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {new Date(s.created_at).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit' })} · {nameOf(lc(s.destination_email))}
                  </span>
                  <span className="flex items-center gap-2">
                    <b>Gs {nf(Number(s.amount_gs || 0))}</b>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusChip(String(s.status || '').toUpperCase())}`}>{s.status}</span>
                  </span>
                  {s.rejection_reason && <span className="w-full text-[11px] text-rose-300">Motivo: {s.rejection_reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="app-card">
          <h3 className="mb-2 text-lg font-extrabold">📦 Stock que tenés en mano</h3>
          {stock.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tenés stock cargado.</p>
          ) : (
            <div className="divide-y divide-border text-sm">
              {stock.map((s, i) => (
                <div key={i} className="flex justify-between py-1.5">
                  <span>{s.title}</span>
                  <b>{s.qty}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-2 ${strong ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-border'}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-black ${strong ? 'text-lg' : 'text-base'}`}>{value}</div>
    </div>
  );
}
