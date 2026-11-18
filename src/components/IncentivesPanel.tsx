import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { addDaysKey, pyToday } from '@/lib/pyTime';

/**
 * 🏆 Incentivos individuales: meta de entregas en un período y premio
 * (tanque lleno, medio tanque, Gs…). Barra de progreso por delivery.
 */

type Incentive = {
  id: string;
  delivery_email: string;
  reward: string;
  target: number;
  starts_on: string;
  ends_on: string;
  note: string | null;
  created_by: string | null;
  paid_at: string | null;
};
type Person = { email: string; name?: string };

const REWARDS = ['⛽ Tanque lleno', '⛽ Medio tanque', '💵 Gs 100.000', '💵 Gs 200.000'];
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
const monthEnd = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export default function IncentivesPanel({
  canManage,
  isAdmin,
  myEmail,
  deliveries,
}: {
  canManage: boolean;
  isAdmin: boolean;
  myEmail: string;
  deliveries: Person[];
}) {
  const today = pyToday();
  const [items, setItems] = useState<Incentive[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'active' | 'done' | 'all'>('active');
  const [search, setSearch] = useState('');

  // Formulario
  const [showForm, setShowForm] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickSearch, setPickSearch] = useState('');
  const [target, setTarget] = useState('');
  const [reward, setReward] = useState(REWARDS[0]);
  const [customReward, setCustomReward] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysKey(today, 6));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const nameOf = useCallback(
    (email: string) => deliveries.find((d) => lc(d.email) === lc(email))?.name || email,
    [deliveries],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('delivery_incentives')
      .select('*')
      .order('ends_on', { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as Incentive[];
    setItems(list);
    if (list.length) {
      const { data: prog } = await (supabase as any).rpc('incentives_progress', { p_ids: list.map((i) => i.id) });
      setProgress(Object.fromEntries(((prog || []) as any[]).map((p) => [p.id, Number(p.delivered || 0)])));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const goal = Number(String(target).replace(/\D/g, ''));
    const prize = (reward === 'otro' ? customReward : reward).trim();
    if (!picked.size) return toast.error('Elegí al menos un delivery');
    if (!goal) return toast.error('Poné la cantidad de entregas de la meta');
    if (!prize) return toast.error('Escribí el premio');
    if (!from || !to || to < from) return toast.error('Revisá las fechas del período');
    setSaving(true);
    const rows = [...picked].map((email) => ({
      delivery_email: email,
      reward: prize,
      target: goal,
      starts_on: from,
      ends_on: to,
      note: note.trim() || null,
      created_by: lc(myEmail),
    }));
    const { error } = await (supabase as any).from('delivery_incentives').insert(rows);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`🏆 ${rows.length} incentivo(s) creado(s)`);
    setPicked(new Set());
    setTarget('');
    setNote('');
    setShowForm(false);
    void load();
  };

  const markPaid = async (i: Incentive) => {
    if (!confirm(`¿Marcar como entregado el premio «${i.reward}» a ${nameOf(i.delivery_email)}?`)) return;
    const { error } = await (supabase as any)
      .from('delivery_incentives')
      .update({ paid_at: new Date().toISOString(), paid_by: lc(myEmail) })
      .eq('id', i.id);
    if (error) return toast.error(error.message);
    toast.success('💵 Premio marcado como entregado');
    void load();
  };

  const remove = async (i: Incentive) => {
    if (!confirm(`¿Eliminar el incentivo «${i.reward}» de ${nameOf(i.delivery_email)}?`)) return;
    const { error } = await (supabase as any).from('delivery_incentives').delete().eq('id', i.id);
    if (error) return toast.error(error.message);
    void load();
  };

  const rows = useMemo(() => {
    const q = lc(search);
    return items
      .map((i) => {
        const done = progress[i.id] || 0;
        const achieved = done >= i.target;
        const expired = i.ends_on < today;
        return { ...i, done, achieved, expired, pct: Math.min(100, Math.round((done / i.target) * 100)) };
      })
      .filter((i) => {
        if (view === 'active' && (i.paid_at || (i.expired && !i.achieved))) return false;
        if (view === 'done' && !(i.paid_at || i.expired || i.achieved)) return false;
        if (q && !lc(nameOf(i.delivery_email)).includes(q) && !lc(i.delivery_email).includes(q) && !lc(i.reward).includes(q)) return false;
        return true;
      })
      .sort((a, b) => Number(b.achieved && !b.paid_at) - Number(a.achieved && !a.paid_at) || b.pct - a.pct);
  }, [items, progress, view, search, today, nameOf]);

  const kpis = useMemo(() => {
    const live = items.filter((i) => !i.paid_at && i.ends_on >= today);
    return {
      active: live.length,
      achieved: items.filter((i) => !i.paid_at && (progress[i.id] || 0) >= i.target).length,
      paid: items.filter((i) => i.paid_at).length,
    };
  }, [items, progress, today]);

  const pickList = deliveries.filter((d) => !pickSearch.trim() || lc(d.name || d.email).includes(lc(pickSearch)) || lc(d.email).includes(lc(pickSearch)));

  return (
    <section className="space-y-4">
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-500/15 via-slate-900/60 to-fuchsia-500/10 p-5 shadow-2xl">
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-300/80">Incentivos</div>
            <h2 className="text-2xl font-black text-white">🏆 Metas de entregas</h2>
            <p className="mt-1 text-xs text-slate-400">
              {canManage
                ? 'Poné una meta de entregas a cada delivery y el premio que se gana si la cumple.'
                : 'Cumplí la meta de entregas del período y ganate el premio.'}
            </p>
          </div>
          {canManage && (
            <button type="button" className="nav-btn active" onClick={() => setShowForm((v) => !v)}>
              {showForm ? '✕ Cerrar' : '＋ Nuevo incentivo'}
            </button>
          )}
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          {[
            ['⏳ En curso', kpis.active, 'text-cyan-300'],
            ['🏆 Cumplidos sin pagar', kpis.achieved, 'text-emerald-300'],
            ['💵 Premios entregados', kpis.paid, 'text-amber-300'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
              <div className={`mt-1 text-2xl font-black ${tone}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {canManage && showForm && (
        <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-xl">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-black">1. 🛵 Deliverys ({picked.size})</span>
                <span className="flex gap-1">
                  <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => setPicked(new Set(pickList.map((d) => lc(d.email))))}>
                    Todos
                  </button>
                  <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => setPicked(new Set())}>
                    Ninguno
                  </button>
                </span>
              </div>
              <input className="app-input mb-2" placeholder="🔎 Buscar delivery" value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} />
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-1.5">
                {pickList.map((d) => {
                  const e = lc(d.email);
                  const on = picked.has(e);
                  return (
                    <label key={e} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${on ? 'bg-amber-500/15' : 'hover:bg-white/5'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(e)) next.delete(e);
                            else next.add(e);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 truncate">
                        <b>{d.name || d.email}</b> <span className="text-[11px] text-slate-500">{d.email}</span>
                      </span>
                    </label>
                  );
                })}
                {!pickList.length && <div className="p-3 text-center text-xs text-slate-500">Sin deliverys</div>}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1 text-sm font-black">2. 🎯 Meta de entregas</div>
                <input
                  className="app-input"
                  inputMode="numeric"
                  placeholder="Ej. 80"
                  value={target}
                  onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-black">3. 🎁 Premio</div>
                <div className="flex flex-wrap gap-1.5">
                  {[...REWARDS, 'otro'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReward(r)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${reward === r ? 'border-amber-400/70 bg-amber-500/20 text-amber-100' : 'border-white/10 text-slate-300'}`}
                    >
                      {r === 'otro' ? '✏️ Otro' : r}
                    </button>
                  ))}
                </div>
                {reward === 'otro' && (
                  <input className="app-input mt-2" placeholder="Ej. 💵 Gs 150.000 o 🍕 Cena" value={customReward} onChange={(e) => setCustomReward(e.target.value)} />
                )}
              </div>
              <div>
                <div className="mb-1 text-sm font-black">4. 📅 Período</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {[
                    ['Esta semana (7 días)', today, addDaysKey(today, 6)],
                    ['15 días', today, addDaysKey(today, 14)],
                    ['Este mes', `${today.slice(0, 8)}01`, monthEnd(today)],
                  ].map(([label, f, t]) => (
                    <button
                      key={label}
                      type="button"
                      className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${from === f && to === t ? 'border-cyan-400/70 bg-cyan-500/20 text-cyan-100' : 'border-white/10 text-slate-300'}`}
                      onClick={() => {
                        setFrom(f);
                        setTo(t);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  Desde <input type="date" className="app-input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
                  hasta <input type="date" className="app-input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
              <input className="app-input" placeholder="Nota (opcional): ej. sólo entregas en Central" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="nav-btn active w-full" disabled={saving} onClick={() => void create()}>
                {saving ? 'Guardando…' : `🏆 Crear incentivo${picked.size > 1 ? ` para ${picked.size} deliverys` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['active', '⏳ En curso'],
          ['done', '✅ Terminados'],
          ['all', 'Todos'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={`nav-btn !py-1.5 ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
        <input className="app-input !w-56" placeholder="🔎 Buscar delivery o premio" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      ) : rows.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((i) => {
            const left = daysBetween(today, i.ends_on);
            const missing = Math.max(0, i.target - i.done);
            const state = i.paid_at
              ? { label: '💵 Premio entregado', cls: 'bg-amber-500/20 text-amber-200' }
              : i.achieved
                ? { label: '🏆 ¡Cumplido!', cls: 'bg-emerald-500/20 text-emerald-200' }
                : i.expired
                  ? { label: '⌛ Vencido', cls: 'bg-rose-500/20 text-rose-200' }
                  : { label: `⏳ ${left === 0 ? 'Último día' : `Quedan ${left} día(s)`}`, cls: 'bg-cyan-500/15 text-cyan-200' };
            const bar = i.achieved ? 'from-emerald-500 to-lime-400' : i.expired ? 'from-rose-500 to-orange-400' : 'from-cyan-500 to-blue-500';
            return (
              <div
                key={i.id}
                className={`rounded-2xl border p-4 shadow-xl ${i.achieved && !i.paid_at ? 'border-emerald-400/50 bg-emerald-500/5 shadow-emerald-500/10' : 'border-white/10 bg-slate-900/70'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">🛵 {nameOf(i.delivery_email)}</div>
                    <div className="text-[11px] text-slate-500">
                      {fmt(i.starts_on)} → {fmt(i.ends_on)}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${state.cls}`}>{state.label}</span>
                </div>

                <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-center text-base font-black text-amber-100">
                  🎁 {i.reward}
                </div>

                <div className="mt-3 flex items-end justify-between">
                  <div className="text-3xl font-black text-white">
                    {i.done}
                    <span className="text-base font-bold text-slate-500"> / {i.target}</span>
                  </div>
                  <div className="text-sm font-black text-slate-300">{i.pct}%</div>
                </div>
                <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full rounded-full bg-gradient-to-r ${bar} transition-all`} style={{ width: `${i.pct}%` }} />
                </div>
                <div className="mt-1.5 text-[11px] text-slate-400">
                  {i.achieved ? '¡Meta cumplida!' : i.expired ? `Le faltaron ${missing} entrega(s)` : `Le faltan ${missing} entrega(s)`}
                </div>
                {i.note && <div className="mt-1 text-[11px] text-slate-500">📝 {i.note}</div>}

                {canManage && (isAdmin || lc(i.created_by) === lc(myEmail)) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {i.achieved && !i.paid_at && (
                      <button type="button" className="nav-btn active !px-2 !py-1 !text-[11px]" onClick={() => void markPaid(i)}>
                        💵 Marcar premio entregado
                      </button>
                    )}
                    <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => void remove(i)}>
                      🗑️ Eliminar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-slate-500">
          {view === 'active' ? 'No hay incentivos en curso.' : 'No hay incentivos para mostrar.'}
          {canManage && view === 'active' && ' Tocá «＋ Nuevo incentivo» para crear uno.'}
        </div>
      )}
    </section>
  );
}
