import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { addDaysKey, pyToday } from '@/lib/pyTime';

type Row = {
  id: string;
  delivery_email: string;
  day: string;
  status: 'TRABAJANDO' | 'FINALIZADO' | 'NO_ASISTE';
  started_at: string | null;
  ended_at: string | null;
  note: string | null;
};
type Person = { email: string; name: string };

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const hm = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }) : '—');
const worked = (rows: Row[], now: number) =>
  rows
    .filter((r) => r.started_at)
    .reduce((sum, r) => sum + ((r.ended_at ? new Date(r.ended_at).getTime() : now) - new Date(r.started_at as string).getTime()), 0);
const dayName = (d: string) =>
  new Date(`${d}T12:00:00-03:00`).toLocaleDateString('es-PY', { weekday: 'long', day: '2-digit', month: '2-digit' });

/** 🕒 Asistencia: el delivery marca entrada / salida (con cronómetro) o «no asistiré»; admin y proveedor ven quién trabaja. */
export default function AttendanceView() {
  const { user, profile } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  const myEmail = lc(profile?.email);
  const isDelivery = role === 'DELIVERY';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app-card">
      <h3 className="mb-1 text-lg font-extrabold">🕒 Asistencia</h3>
      {isDelivery ? (
        <DeliveryAttendance myEmail={myEmail} now={now} />
      ) : (
        <TeamAttendance userId={user?.id || ''} now={now} />
      )}
    </div>
  );
}

function DeliveryAttendance({ myEmail, now }: { myEmail: string; now: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const today = pyToday();

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('delivery_attendance')
      .select('*')
      .ilike('delivery_email', myEmail)
      .gte('day', addDaysKey(today, -13))
      .order('started_at', { ascending: true });
    setRows((data || []) as Row[]);
  }, [myEmail, today]);

  useEffect(() => {
    if (myEmail) void load();
  }, [myEmail, load]);

  const todayRows = rows.filter((r) => r.day === today);
  // Jornada de un día anterior que quedó abierta (se olvidó marcar la salida).
  const pastOpen = rows.find((r) => r.status === 'TRABAJANDO' && !r.ended_at && r.day < today);
  const [pastEnd, setPastEnd] = useState('');
  useEffect(() => {
    if (!pastOpen?.started_at) return;
    // Hora sugerida: 8 horas después de la entrada (como máximo 23:59 de ese día).
    const start = new Date(pastOpen.started_at);
    const startPy = new Date(start.getTime() - 3 * 3600_000);
    const mins = Math.min(startPy.getUTCHours() * 60 + startPy.getUTCMinutes() + 8 * 60, 23 * 60 + 59);
    setPastEnd(`${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
  }, [pastOpen?.id, pastOpen?.started_at]);

  const closePast = async () => {
    if (!pastEnd) return toast.error('Elegí a qué hora terminaste');
    setBusy(true);
    const { error } = await (supabase as any).rpc('attendance_close_past', { p_end_time: pastEnd });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`✅ Jornada del ${dayName(pastOpen!.day)} finalizada. Ya podés marcar la entrada de hoy.`);
    void load();
  };
  const open = todayRows.find((r) => r.status === 'TRABAJANDO' && !r.ended_at);
  const absent = todayRows.find((r) => r.status === 'NO_ASISTE');
  const total = worked(todayRows, now);

  const act = async (action: string, note?: string) => {
    setBusy(true);
    const { error } = await (supabase as any).rpc('attendance_action', { p_action: action, p_note: note ?? null });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      action === 'start' ? '▶ Entrada marcada: el cronómetro empezó' : action === 'stop' ? '⏹ Salida marcada' : action === 'absent' ? '🚫 Avisaste que no asistís hoy' : 'Listo',
    );
    void load();
  };

  const history = useMemo(() => {
    const byDay = new Map<string, Row[]>();
    rows.filter((r) => r.day !== today).forEach((r) => byDay.set(r.day, [...(byDay.get(r.day) || []), r]));
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows, today]);

  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">Marcá tu entrada al empezar a trabajar y la salida al terminar. Si hoy no trabajás, avisá con «No asistiré hoy».</p>

      {pastOpen && (
        <div className="mx-auto mb-4 max-w-md rounded-3xl border border-amber-500/50 bg-amber-500/10 p-5 text-center shadow-xl">
          <div className="text-sm font-black text-amber-300">⚠️ Quedó abierta tu jornada del {dayName(pastOpen.day)}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Entraste a las {time(pastOpen.started_at)} y no marcaste la salida. Finalizala para poder marcar la entrada de hoy.
          </p>
          <label className="mt-3 flex items-center justify-center gap-2 text-sm">
            ¿A qué hora terminaste ese día?
            <input type="time" className="app-input !w-auto !py-1" value={pastEnd} onChange={(e) => setPastEnd(e.target.value)} />
          </label>
          <button
            type="button"
            className="mt-3 w-full rounded-2xl bg-rose-600 py-4 text-lg font-black text-white disabled:opacity-50"
            disabled={busy || !pastEnd}
            onClick={() => void closePast()}
          >
            ⏹ Finalizar jornada del {pastOpen.day.slice(8, 10)}/{pastOpen.day.slice(5, 7)}
          </button>
        </div>
      )}

      <div
        className={`mx-auto max-w-md rounded-3xl border p-6 text-center shadow-xl ${pastOpen ? 'pointer-events-none opacity-50' : ''} ${
          open ? 'border-emerald-500/50 bg-emerald-500/10' : absent ? 'border-rose-500/40 bg-rose-500/10' : 'border-border bg-card/60'
        }`}
      >
        <div className="text-sm font-bold capitalize text-muted-foreground">{dayName(today)}</div>
        <div className={`my-3 font-mono text-5xl font-black tracking-wider ${open ? 'text-emerald-300' : 'text-foreground'}`}>{hms(total)}</div>
        <div className="mb-4 text-sm">
          {open ? (
            <span className="font-bold text-emerald-300">🟢 Trabajando desde las {time(open.started_at)}</span>
          ) : absent ? (
            <span className="font-bold text-rose-300">🚫 Hoy no asistís{absent.note ? `: ${absent.note}` : ''}</span>
          ) : todayRows.length ? (
            <span className="font-bold">✅ Jornada terminada · {hm(total)}</span>
          ) : (
            <span className="text-muted-foreground">Todavía no marcaste tu asistencia</span>
          )}
        </div>

        {open ? (
          <button type="button" className="w-full rounded-2xl bg-rose-600 py-4 text-lg font-black text-white disabled:opacity-50" disabled={busy} onClick={() => void act('stop')}>
            ⏹ Marcar salida
          </button>
        ) : (
          <button type="button" className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-black text-white disabled:opacity-50" disabled={busy} onClick={() => void act('start')}>
            ▶ {todayRows.some((r) => r.started_at) ? 'Volver a marcar entrada' : 'Marcar entrada'}
          </button>
        )}

        {!open && !todayRows.some((r) => r.started_at) && (
          absent ? (
            <button type="button" className="mt-3 text-xs text-muted-foreground underline" disabled={busy} onClick={() => void act('undo_absent')}>
              Me equivoqué, sí voy a trabajar
            </button>
          ) : (
            <button
              type="button"
              className="mt-3 w-full rounded-2xl border border-rose-500/40 py-3 text-sm font-bold text-rose-300 disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                const note = window.prompt('🚫 ¿Por qué no asistís hoy? (opcional)', '');
                if (note !== null) void act('absent', note);
              }}
            >
              🚫 No asistiré hoy
            </button>
          )
        )}

        {todayRows.filter((r) => r.started_at).length > 0 && (
          <div className="mt-4 space-y-1 text-left text-xs text-muted-foreground">
            {todayRows
              .filter((r) => r.started_at)
              .map((r, i) => (
                <div key={r.id}>
                  Tramo {i + 1}: {time(r.started_at)} → {r.ended_at ? time(r.ended_at) : 'ahora'}
                </div>
              ))}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="mx-auto mt-5 max-w-md">
          <div className="mb-1 text-sm font-bold">Últimos días</div>
          <div className="divide-y divide-border rounded-2xl border border-border">
            {history.map(([day, list]) => {
              const no = list.find((r) => r.status === 'NO_ASISTE');
              return (
                <div key={day} className="flex justify-between px-3 py-2 text-sm">
                  <span className="capitalize">{dayName(day)}</span>
                  <b className={no ? 'text-rose-300' : ''}>{no ? '🚫 No asistió' : hm(worked(list, now))}</b>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function TeamAttendance({ userId, now }: { userId: string; now: number }) {
  const [day, setDay] = useState(pyToday());
  const [rows, setRows] = useState<Row[]>([]);
  const [deliveries, setDeliveries] = useState<Person[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: ur } = await supabase.from('user_roles').select('user_id').eq('role', 'DELIVERY').eq('approved', true);
      const ids = (ur || []).map((r: any) => r.user_id);
      if (ids.length) {
        const { data: pr } = await supabase.from('profiles').select('email, name').in('user_id', ids);
        setDeliveries(
          ((pr || []) as any[])
            .filter((p) => p.email)
            .map((p) => ({ email: lc(p.email), name: p.name || p.email }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      if (userId) {
        const { data } = await (supabase as any).from('profiles').select('favorite_deliveries').eq('user_id', userId).maybeSingle();
        setFavorites(((data?.favorite_deliveries || []) as string[]).map(lc));
      }
    })();
  }, [userId]);

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('delivery_attendance').select('*').eq('day', day).order('started_at', { ascending: true });
    setRows((data || []) as Row[]);
  }, [day]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const toggleFavorite = async (email: string) => {
    const next = favorites.includes(email) ? favorites.filter((e) => e !== email) : [...favorites, email];
    setFavorites(next);
    const { error } = await (supabase as any).from('profiles').update({ favorite_deliveries: next }).eq('user_id', userId);
    if (error) toast.error(error.message);
  };

  const useFavorites = onlyMine && favorites.length > 0;
  const list = useMemo(() => {
    const base = useFavorites ? deliveries.filter((d) => favorites.includes(d.email)) : deliveries;
    return base.map((d) => {
      const mine = rows.filter((r) => lc(r.delivery_email) === d.email);
      const open = mine.find((r) => r.status === 'TRABAJANDO' && !r.ended_at);
      const absent = mine.find((r) => r.status === 'NO_ASISTE');
      const sessions = mine.filter((r) => r.started_at);
      const state = open ? 'working' : absent ? 'absent' : sessions.length ? 'done' : 'none';
      return { d, open, absent, sessions, state, ms: worked(mine, now) };
    });
  }, [deliveries, favorites, useFavorites, rows, now]);

  const order = { working: 0, done: 1, absent: 2, none: 3 } as const;
  const sorted = [...list].sort((a, b) => order[a.state as keyof typeof order] - order[b.state as keyof typeof order] || a.d.name.localeCompare(b.d.name));
  const count = (s: string) => list.filter((x) => x.state === s).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" className="app-input !w-auto" value={day} max={pyToday()} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <div className="inline-flex overflow-hidden rounded-full border border-border text-xs">
          <button type="button" className={`px-3 py-1.5 font-bold ${onlyMine ? 'bg-amber-500 text-black' : 'text-muted-foreground'}`} onClick={() => setOnlyMine(true)}>
            ⭐ Mis deliverys{favorites.length ? ` (${favorites.length})` : ''}
          </button>
          <button type="button" className={`px-3 py-1.5 font-bold ${!onlyMine ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setOnlyMine(false)}>
            Todos
          </button>
        </div>
        <button type="button" className="nav-btn ml-auto !py-1.5 !text-xs" onClick={() => setShowConfig((v) => !v)}>
          ⚙️ Configuración
        </button>
      </div>

      {onlyMine && !favorites.length && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          Todavía no elegiste tus deliverys: se muestran todos. Tocá <b>⚙️ Configuración</b> y marcá los tuyos.
        </div>
      )}

      {showConfig && (
        <div className="mb-4 rounded-2xl border border-border bg-background p-3">
          <div className="mb-2 text-sm font-black">⚙️ Mis deliverys</div>
          <p className="mb-2 text-xs text-muted-foreground">Marcá ⭐ los deliverys que trabajan con vos: con «Mis deliverys» sólo ves su información y su asistencia. Se guarda solo.</p>
          <div className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {deliveries.map((d) => {
              const fav = favorites.includes(d.email);
              return (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => void toggleFavorite(d.email)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${fav ? 'border-amber-400/60 bg-amber-500/10' : 'border-border'}`}
                >
                  <span className="text-lg">{fav ? '⭐' : '☆'}</span>
                  <span className="min-w-0 truncate">
                    <b>{d.name}</b> <span className="text-xs text-muted-foreground">{d.email}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['🟢 Trabajando', count('working'), 'text-emerald-300'],
          ['✅ Terminaron', count('done'), 'text-sky-300'],
          ['🚫 No asisten', count('absent'), 'text-rose-300'],
          ['⚪ Sin marcar', count('none'), 'text-muted-foreground'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="kpi-card">
            <div className="mb-1 text-xs text-muted-foreground">{label}</div>
            <div className={`text-[22px] font-extrabold ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-auto">
        <table className="app-table min-w-[720px]">
          <thead>
            <tr>
              <th>Delivery</th>
              <th>Estado</th>
              <th>Entrada</th>
              <th>Salida</th>
              <th className="text-right">Horas</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ d, open, absent, sessions, state, ms }) => (
              <tr key={d.email}>
                <td className="text-sm">
                  <b>{d.name}</b>
                  <div className="text-[11px] text-muted-foreground">{d.email}</div>
                </td>
                <td className="text-sm">
                  {state === 'working' ? (
                    <span className="font-bold text-emerald-300">🟢 Trabajando</span>
                  ) : state === 'done' ? (
                    <span className="font-bold text-sky-300">✅ Terminó</span>
                  ) : state === 'absent' ? (
                    <span className="font-bold text-rose-300" title={absent?.note || ''}>
                      🚫 No asiste{absent?.note ? `: ${absent.note}` : ''}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">⚪ Sin marcar</span>
                  )}
                </td>
                <td className="text-sm">{sessions.length ? time(sessions[0].started_at) : '—'}</td>
                <td className="text-sm">{open ? 'en curso' : sessions.length ? time(sessions[sessions.length - 1].ended_at) : '—'}</td>
                <td className={`text-right font-mono text-sm font-bold ${open ? 'text-emerald-300' : ''}`}>{sessions.length ? (open ? hms(ms) : hm(ms)) : '—'}</td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No hay deliverys para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
