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

  if (loading)
    return (
      <div className="space-y-4">
        <div className="h-48 animate-pulse rounded-3xl border border-border bg-card/40" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-card/40" />
          ))}
        </div>
      </div>
    );

  const payTotal = totals.pay;
  const payPct = totals.collected > 0 ? Math.min(100, Math.round((payTotal / totals.collected) * 100)) : 0;
  const pendingSubs = submissions.filter((s) => String(s.status || '').toUpperCase() === 'PENDIENTE').length;
  const maxStock = Math.max(1, ...stock.map((s) => s.qty));
  const todayPct = perf.todayTotal ? Math.round((perf.today / perf.todayTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ── Neto a rendir ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/15 via-slate-900/60 to-violet-500/15 p-5 shadow-2xl md:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/80">Neto a rendir</div>
            <div className="mt-1 text-4xl font-black tracking-tight text-white md:text-5xl">
              <span className="mr-1 text-xl font-bold text-slate-400 md:text-2xl">Gs</span>
              {nf(totals.net)}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
              <span className="rounded-full border border-white/10 bg-slate-950/50 px-2.5 py-1 text-slate-300">📦 {totals.orders} pedidos</span>
              <span className="rounded-full border border-white/10 bg-slate-950/50 px-2.5 py-1 text-slate-300">🏢 {byProvider.length} proveedor(es)</span>
              {pendingSubs > 0 && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">⏳ {pendingSubs} comprobante(s) en revisión</span>
              )}
            </div>
          </div>
          <div className="hidden h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/60 text-2xl shadow-inner sm:flex">💰</div>
        </div>

        <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
          <MiniStat label="Cobrado a clientes" value={`Gs ${nf(totals.collected)}`} dot="bg-emerald-400" />
          <MiniStat label="Tu pago (delivery + intentos)" value={`Gs ${nf(payTotal)}`} dot="bg-violet-400" />
        </div>
        <div className="relative mt-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-950/60">
            <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${payPct}%` }} />
            <div className="h-full flex-1 bg-gradient-to-r from-cyan-500 to-emerald-400" />
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-bold text-slate-400">
            <span>Tu pago {payPct}%</span>
            <span>A rendir {100 - payPct}%</span>
          </div>
        </div>
        <p className="relative mt-3 text-[11px] text-slate-400">Mismas cuentas que Cierres › Pagos. Para rendir, andá a <b className="text-slate-200">Cierres</b> y subí el comprobante.</p>
      </section>

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi tone="emerald" icon="✅" title="Entregados hoy" value={`${perf.today}`} sub={`de ${perf.todayTotal} asignados`} progress={todayPct} />
        <Kpi tone="blue" icon="📅" title="Últimos 7 días" value={`${perf.week}`} sub="pedidos entregados" />
        <Kpi tone="cyan" icon="🗓" title="Este mes" value={`${perf.month}`} sub={`de ${perf.monthTotal} asignados`} />
        <Kpi tone="rose" icon="❌" title="Cancelados (mes)" value={`${perf.cancelled}`} sub="incluye rechazados" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Efectividad */}
        <section className="rounded-3xl border border-border bg-card/60 p-5 shadow-xl">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Efectividad del mes</div>
          <div className="mt-3 flex items-center gap-4">
            <Ring pct={perf.effectiveness} />
            <div className="text-xs text-slate-400">
              <div>
                <b className="text-base text-white">{perf.month}</b> entregados
              </div>
              <div>
                de <b className="text-white">{perf.monthTotal}</b> asignados
              </div>
              <div className="mt-1 font-bold" style={{ color: ringColor(perf.effectiveness) }}>
                {perf.effectiveness >= 80 ? 'Excelente 🔥' : perf.effectiveness >= 60 ? 'Bien, se puede mejorar' : 'A mejorar'}
              </div>
            </div>
          </div>
        </section>

        {/* Por proveedor */}
        <section className="rounded-3xl border border-border bg-card/60 p-5 shadow-xl lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">A rendir por proveedor</div>
            <span className="hidden text-[11px] text-slate-500 sm:inline">Tocá para ver los pedidos</span>
          </div>
          {byProvider.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-300">✅ No tenés nada pendiente de rendir</div>
          ) : (
            <div className="space-y-2">
              {byProvider.map((p) => {
                const share = totals.net > 0 ? Math.max(0, Math.round((p.net / totals.net) * 100)) : 0;
                return (
                  <div key={p.provider} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
                    <button
                      type="button"
                      className="w-full px-4 py-3 text-left"
                      onClick={() => setOpenProvider(openProvider === p.provider ? null : p.provider)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-extrabold text-white">
                          <span className="mr-1 text-slate-500">{openProvider === p.provider ? '▾' : '▸'}</span>🏢 {nameOf(p.provider)}
                        </span>
                        <span className="text-base font-black text-cyan-300">Gs {nf(p.net)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${share}%` }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                        <span>{p.orders.length} pedidos</span>
                        <span>Cobrado {nf(p.collected)}</span>
                        <span>Tu pago {nf(p.pay + p.attempts)}</span>
                      </div>
                    </button>
                    {openProvider === p.provider && (
                      <div className="divide-y divide-white/5 border-t border-white/10 px-4 py-2 text-xs">
                        {p.orders.map((o) => (
                          <div key={o.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                            <span className="text-slate-300">
                              <b>{o.order_number || o.id.slice(0, 8)}</b> · {o.city}
                              {o.status === 'ENCOMIENDA ENTREGADA' && <span className="ml-1 rounded bg-violet-500/20 px-1 text-[10px] text-violet-300">encomienda</span>}
                            </span>
                            <span className="text-slate-400">
                              {o.status === 'ENTREGADO' ? <>cobrado <b className="text-emerald-300">{nf(Number(o.total_gs || 0))}</b></> : 'sin cobro'} · tu pago{' '}
                              <b className="text-violet-300">{nf(feeOf(o))}</b>
                            </span>
                          </div>
                        ))}
                        {p.attempts > 0 && <div className="py-1.5 text-orange-300">💸 Intentos pagados: Gs {nf(p.attempts)}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card/60 p-5 shadow-xl">
          <div className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">🧾 Últimas rendiciones</div>
          {submissions.length === 0 ? (
            <p className="text-sm text-slate-400">Todavía no enviaste comprobantes.</p>
          ) : (
            <div className="space-y-2">
              {submissions.map((s) => {
                const st = String(s.status || '').toUpperCase();
                return (
                  <div key={s.id} className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">{nameOf(lc(s.destination_email))}</div>
                        <div className="text-[11px] text-slate-500">
                          {new Date(s.created_at).toLocaleDateString('es-PY', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-white">Gs {nf(Number(s.amount_gs || 0))}</div>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${statusChip(st)}`}>
                          {st === 'APROBADO' ? '✓ APROBADO' : st === 'RECHAZADO' ? '✕ RECHAZADO' : '⏳ EN REVISIÓN'}
                        </span>
                      </div>
                    </div>
                    {s.rejection_reason && <div className="mt-1 text-[11px] text-rose-300">Motivo: {s.rejection_reason}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-card/60 p-5 shadow-xl">
          <div className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">📦 Stock en mano</div>
          {stock.length === 0 ? (
            <p className="text-sm text-slate-400">No tenés stock cargado.</p>
          ) : (
            <div className="space-y-2.5">
              {stock.map((s, i) => (
                <div key={i}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-slate-300">{s.title}</span>
                    <b className="text-white">{s.qty} u.</b>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400" style={{ width: `${Math.round((s.qty / maxStock) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type Tone = 'blue' | 'emerald' | 'cyan' | 'rose';
const TONES: Record<Tone, { card: string; bar: string }> = {
  blue: { card: 'from-blue-500/20 to-cyan-500/5 border-blue-500/25', bar: 'from-blue-500 to-cyan-400' },
  emerald: { card: 'from-emerald-500/20 to-teal-500/5 border-emerald-500/25', bar: 'from-emerald-500 to-teal-400' },
  cyan: { card: 'from-cyan-500/20 to-blue-500/5 border-cyan-500/25', bar: 'from-cyan-500 to-blue-400' },
  rose: { card: 'from-rose-500/20 to-red-500/5 border-rose-500/25', bar: 'from-rose-500 to-red-400' },
};

function Kpi({ tone, icon, title, value, sub, progress }: { tone: Tone; icon: string; title: string; value: string; sub?: string; progress?: number }) {
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${TONES[tone].card} p-4 shadow-xl`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</div>
          <div className="mt-1.5 text-3xl font-black leading-none text-white">{value}</div>
          {sub && <div className="mt-1.5 text-[11px] font-bold text-slate-400">{sub}</div>}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/50 text-lg">{icon}</div>
      </div>
      {progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-950/60">
          <div className={`h-full rounded-full bg-gradient-to-r ${TONES[tone].bar}`} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}

const ringColor = (pct: number) => (pct >= 80 ? '#34d399' : pct >= 60 ? '#fbbf24' : '#fb7185');

function Ring({ pct }: { pct: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
      <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="10" />
      <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        stroke={ringColor(pct)}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`}
        transform="rotate(-90 55 55)"
      />
      <text x="55" y="61" textAnchor="middle" fontSize="22" fontWeight="900" fill="#fff">
        {pct}%
      </text>
    </svg>
  );
}
