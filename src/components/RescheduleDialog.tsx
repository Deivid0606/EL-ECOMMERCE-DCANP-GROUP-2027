import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { addDaysKey, pyToday } from '@/lib/pyTime';

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Próximo día hábil (viernes → lunes, sábado → lunes), igual que el fin de día. */
export const nextBusinessDay = (day: string) => {
  const dow = new Date(`${day}T12:00:00-03:00`).getUTCDay();
  return addDaysKey(day, dow === 5 ? 3 : dow === 6 ? 2 : 1);
};

export const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00-03:00`);
  return `${DAYS[d.getUTCDay()]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
};

/**
 * 📅 REAGENDADO con calendario obligatorio. Si la fecha no es el próximo día hábil,
 * el proveedor tiene que desasignar el pedido y vuelve a Despacho en esa fecha.
 */
export function useRescheduleDialog(onDone: () => void) {
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const today = pyToday();
  const nbd = nextBusinessDay(today);
  const max = addDaysKey(today, 60);

  const ask = (ids: string[]) => {
    setOrderIds(ids.filter(Boolean));
    setDate('');
    setNote('');
  };
  const close = () => !saving && setOrderIds([]);

  const save = async () => {
    if (!date || date <= today) {
      toast.error('Elegí la fecha del reagendado (a partir de mañana)');
      return;
    }
    setSaving(true);
    let ok = 0;
    let release = 0;
    for (const id of orderIds) {
      const { data, error } = await (supabase as any).rpc('reschedule_order', { p_order_id: id, p_date: date, p_note: note.trim() || null });
      if (error) {
        toast.error(error.message);
        continue;
      }
      ok++;
      if (data?.needs_release) release++;
    }
    setSaving(false);
    if (!ok) return;
    toast.success(
      release
        ? `📅 ${ok} reagendado(s) para el ${dayLabel(date)}. No es el próximo día hábil: el proveedor lo desasigna y vuelve a Despacho ese día.`
        : `📅 ${ok} reagendado(s) para el ${dayLabel(date)}. Sigue en tu ruta.`,
      { duration: 9000 },
    );
    setOrderIds([]);
    onDone();
  };

  const quick = [
    { label: `Próximo día hábil (${dayLabel(nbd)})`, value: nbd },
    { label: 'En 1 semana', value: addDaysKey(today, 7) },
  ];

  const modal =
    orderIds.length > 0 &&
    createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-3" onClick={close}>
        <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <h4 className="mb-1 text-lg font-black">📅 Reagendar {orderIds.length > 1 ? `${orderIds.length} pedidos` : 'pedido'}</h4>
          <p className="mb-3 text-xs text-muted-foreground">¿Para qué fecha pidió el cliente la entrega?</p>

          <input
            type="date"
            className="app-input"
            min={addDaysKey(today, 1)}
            max={max}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q.value}
                type="button"
                className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${date === q.value ? 'border-primary bg-primary/10' : 'border-border'}`}
                onClick={() => setDate(q.value)}
              >
                {q.label}
              </button>
            ))}
          </div>

          {date && (
            <div
              className={`mt-3 rounded-xl border p-2 text-xs ${date <= nbd ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}
            >
              {date <= nbd ? (
                <>
                  ✅ <b>{dayLabel(date)}</b>: el pedido sigue con el delivery y pasa a ese día al finalizar el día.
                </>
              ) : (
                <>
                  ↩️ <b>{dayLabel(date)}</b> no es el próximo día hábil: el proveedor lo <b>desasigna</b> y el pedido vuelve a{' '}
                  <b>Despacho</b> recién ese día para aprobar el despacho de nuevo.
                </>
              )}
            </div>
          )}

          <label className="app-label">Nota (opcional)</label>
          <input className="app-input" placeholder="Ej. cobra el viernes, llamar antes" value={note} onChange={(e) => setNote(e.target.value)} />

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="nav-btn" onClick={close} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="nav-btn active" onClick={() => void save()} disabled={saving || !date}>
              {saving ? 'Guardando…' : '📅 Reagendar'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return { ask, modal };
}
