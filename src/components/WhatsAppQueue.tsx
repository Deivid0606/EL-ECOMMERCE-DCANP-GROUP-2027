import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { customerMessageVariant } from '@/lib/waMessages';

type QueueItem = {
  id: string;
  orderNumber: string;
  name: string;
  phone: string;
  url: string;
  state: 'pending' | 'sent' | 'skipped';
};
type Queue = { items: QueueItem[]; index: number; nextAt: number; minutes: number; paused: boolean };

const KEY = 'dcanp_wa_queue';
const save = (q: Queue | null) => {
  try {
    if (q) localStorage.setItem(KEY, JSON.stringify(q));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin storage */
  }
};
const restore = (): Queue | null => {
  try {
    const q = JSON.parse(localStorage.getItem(KEY) || 'null');
    return q && Array.isArray(q.items) && q.index < q.items.length ? q : null;
  } catch {
    return null;
  }
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const beep = () => {
  try {
    navigator.vibrate?.([200, 100, 200]);
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* sin sonido */
  }
};

/**
 * 📲 Escribir a todos los clientes seleccionados: un WhatsApp por cliente, cada
 * mensaje distinto, con una espera entre uno y otro. WhatsApp no deja que una
 * página envíe sola: la app abre cada chat con el mensaje listo y el delivery
 * toca «Enviar».
 */
export function useWhatsAppQueue(opts: {
  getPhone: (o: any) => string;
  normalizePhone: (p: string) => string;
  onSent: (orderId: string) => void;
}) {
  const [queue, setQueue] = useState<Queue | null>(() => restore());
  const [setup, setSetup] = useState<any[] | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [now, setNow] = useState(Date.now());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const alerted = useRef<number>(-1);

  useEffect(() => save(queue), [queue]);
  useEffect(() => {
    if (!queue) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queue]);

  const current = queue ? queue.items[queue.index] : null;
  const wait = queue ? queue.nextAt - now : 0;
  const due = Boolean(queue && !queue.paused && current && wait <= 0);

  // Aviso (vibra / suena) cuando le toca al siguiente.
  useEffect(() => {
    if (due && queue && alerted.current !== queue.index) {
      alerted.current = queue.index;
      if (queue.index > 0) beep();
    }
  }, [due, queue]);

  const start = useCallback((orders: any[]) => {
    if (!orders.length) {
      toast.error('Seleccioná los pedidos de los clientes a los que querés escribir');
      return;
    }
    setSetup(orders);
  }, []);

  const confirmStart = () => {
    if (!setup) return;
    const { getPhone, normalizePhone } = optsRef.current;
    const items: QueueItem[] = setup.map((o, i) => {
      const raw = getPhone(o);
      const phone = normalizePhone(raw);
      return {
        id: o.id,
        orderNumber: o.order_number || String(o.id).slice(0, 8),
        name: o.customer_name || '',
        phone: raw,
        url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(customerMessageVariant(o, raw, i))}` : '',
        state: phone ? 'pending' : 'skipped',
      };
    });
    const first = items.findIndex((it) => it.state === 'pending');
    if (first < 0) {
      toast.error('Ninguno de los pedidos seleccionados tiene teléfono');
      setSetup(null);
      return;
    }
    setQueue({ items, index: first, nextAt: Date.now(), minutes, paused: false });
    setSetup(null);
  };

  const advance = (q: Queue, state: QueueItem['state'], waitNext: boolean): Queue | null => {
    const items = q.items.map((it, i) => (i === q.index ? { ...it, state } : it));
    let next = q.index + 1;
    while (next < items.length && items[next].state !== 'pending') next++;
    if (next >= items.length) {
      const sent = items.filter((i) => i.state === 'sent').length;
      toast.success(`✅ Listo: escribiste a ${sent} cliente(s)`, { duration: 8000 });
      return null;
    }
    return { ...q, items, index: next, nextAt: waitNext ? Date.now() + q.minutes * 60_000 : Date.now() };
  };

  const openCurrent = () => {
    if (!queue || !current) return;
    window.open(current.url, '_blank', 'noopener');
    optsRef.current.onSent(current.id);
    setQueue(advance(queue, 'sent', true));
  };
  const skipCurrent = () => queue && setQueue(advance(queue, 'skipped', false));
  const togglePause = () =>
    queue && setQueue({ ...queue, paused: !queue.paused, nextAt: queue.paused ? Math.max(queue.nextAt, Date.now()) : queue.nextAt });
  const stop = () => {
    if (!window.confirm('¿Terminar el envío? Los que faltan no se envían.')) return;
    setQueue(null);
  };

  const sentCount = queue ? queue.items.filter((i) => i.state === 'sent').length : 0;
  const total = queue ? queue.items.length : 0;
  const pct = total ? Math.round(((queue!.index) / total) * 100) : 0;

  const ui = (
    <>
      {setup &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-3" onClick={() => setSetup(null)}>
            <div className="w-full max-w-md rounded-2xl border border-border bg-background p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h4 className="text-lg font-black">📲 Escribir a {setup.length} cliente(s)</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Cada cliente recibe un mensaje <b>distinto</b> con los datos de su pedido (productos, dirección y total). Entre un mensaje y el
                siguiente se espera para que no parezca envío masivo.
              </p>
              <label className="app-label">Espera entre mensajes</label>
              <div className="grid grid-cols-4 gap-2">
                {[2, 3, 5, 10].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`rounded-xl border py-2 text-sm font-bold ${minutes === m ? 'border-primary bg-primary/10' : 'border-border'}`}
                    onClick={() => setMinutes(m)}
                  >
                    {m} min
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                📌 WhatsApp no permite que otra app envíe sola: la app <b>abre cada chat con el mensaje listo</b> y vos tocás <b>Enviar</b>. Después
                volvé a la app: cuando pasa la espera vibra y aparece el botón del siguiente. Tiempo total aprox.:{' '}
                <b>{Math.max(0, setup.length - 1) * minutes} min</b>.
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="nav-btn" onClick={() => setSetup(null)}>
                  Cancelar
                </button>
                <button type="button" className="nav-btn active" onClick={confirmStart}>
                  📲 Empezar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {queue &&
        current &&
        createPortal(
          <div className="fixed inset-x-2 bottom-2 z-[9998] mx-auto max-w-md rounded-2xl border border-emerald-500/40 bg-[#0b1220] p-3 text-white shadow-2xl sm:right-4 sm:left-auto sm:w-[380px]">
            <div className="mb-1 flex items-center justify-between text-xs">
              <b>📲 Enviando mensajes · {sentCount} de {total}</b>
              <button type="button" className="text-slate-400 hover:text-white" onClick={stop} title="Terminar">
                ✕
              </button>
            </div>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-sm">
              Siguiente: <b>{current.name}</b> <span className="text-slate-400">· {current.orderNumber} · {current.phone}</span>
            </div>
            {queue.paused ? (
              <div className="mt-1 text-xs text-amber-300">⏸ En pausa</div>
            ) : due ? (
              <div className="mt-1 text-xs text-emerald-300">✅ Ya podés enviar</div>
            ) : (
              <div className="mt-1 text-xs text-slate-300">
                ⏳ Próximo mensaje en <b className="text-white">{mmss(wait)}</b> (espera de {queue.minutes} min)
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black disabled:opacity-40"
                disabled={!due}
                onClick={openCurrent}
              >
                📲 Abrir WhatsApp
              </button>
              <button type="button" className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold" onClick={togglePause}>
                {queue.paused ? '▶ Seguir' : '⏸ Pausar'}
              </button>
              <button type="button" className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold" onClick={skipCurrent}>
                ⏭ Saltar
              </button>
            </div>
            <div className="mt-2 max-h-24 overflow-y-auto text-[11px] text-slate-400">
              {queue.items.map((it, i) => (
                <div key={it.id} className={i === queue.index ? 'font-bold text-white' : ''}>
                  {it.state === 'sent' ? '✅' : it.state === 'skipped' ? '⏭' : i === queue.index ? '▶' : '•'} {it.name}
                  {!it.url ? ' (sin teléfono)' : ''}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );

  return { start, ui, running: Boolean(queue) };
}
