import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyDaysAgo, pyToday } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

export default function RendicionesPagadasView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const myEmail = profile?.email || '';

  const [rendiciones, setRendiciones] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<{ email: string; name: string }[]>([]);
  const [filterDelivery, setFilterDelivery] = useState('');
  const [dateFrom, setDateFrom] = useState(() => pyDaysAgo(30));
  const [dateTo, setDateTo] = useState(() => pyToday());

  // New rendicion form
  const [showForm, setShowForm] = useState(false);
  const [newDelivery, setNewDelivery] = useState('');
  const [newFecha, setNewFecha] = useState(() => pyToday());
  const [newMonto, setNewMonto] = useState(0);
  const [newNota, setNewNota] = useState('');

  const loadDeliveries = async () => {
    const [profRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('email, name, user_id'),
      supabase.from('user_roles').select('user_id, role').eq('role', 'DELIVERY'),
    ]);
    const deliveryIds = new Set((rolesRes.data || []).map(r => r.user_id));
    setDeliveries((profRes.data || []).filter(p => deliveryIds.has(p.user_id)).map(p => ({ email: p.email, name: p.name || p.email })));
  };

  const load = async () => {
    let query = supabase.from('rendiciones_pagadas').select('*').order('pagado_en', { ascending: false });
    if (filterDelivery) query = query.eq('delivery_email', filterDelivery);
    const { data } = await query;
    setRendiciones(data || []);
  };

  useEffect(() => { loadDeliveries(); load(); }, []);

  const filtered = useMemo(() => {
    return rendiciones.filter(r => {
      if (dateFrom && r.fecha_rendicion && r.fecha_rendicion < dateFrom) return false;
      if (dateTo && r.fecha_rendicion && r.fecha_rendicion > dateTo) return false;
      return true;
    });
  }, [rendiciones, dateFrom, dateTo]);

  const kpis = useMemo(() => ({
    total: filtered.length,
    sumTotal: filtered.reduce((s, r) => s + Number(r.monto_total || 0), 0),
  }), [filtered]);

  const createRendicion = async () => {
    if (!newDelivery) { toast.error('Seleccioná un delivery'); return; }
    if (!newMonto || newMonto <= 0) { toast.error('Monto inválido'); return; }
    const { error } = await supabase.from('rendiciones_pagadas').insert({
      delivery_email: newDelivery,
      fecha_rendicion: newFecha,
      monto_total: newMonto,
      nota: newNota,
      marcado_por: myEmail,
      marcado_en: new Date().toISOString(),
      pagado_en: new Date().toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Rendición marcada como pagada');
    setShowForm(false);
    setNewDelivery('');
    setNewMonto(0);
    setNewNota('');
    load();
  };

  const deleteRendicion = async (id: string) => {
    if (!confirm('¿Desmarcar esta rendición?')) return;
    // We can't delete due to RLS, but admin can manage
    const { error } = await supabase.from('rendiciones_pagadas').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Rendición desmarcada'); load(); }
  };

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">Rendiciones pagadas</h3>

      <div className="grid-kpi mb-4" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Total rendiciones</div><div className="text-[22px] font-extrabold">{kpis.total}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Monto total (Gs)</div><div className="text-[22px] font-extrabold">{nf(kpis.sumTotal)}</div></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="app-input !w-auto min-w-[260px]" value={filterDelivery} onChange={e => setFilterDelivery(e.target.value)}>
          <option value="">Todos los delivery</option>
          {deliveries.map(d => <option key={d.email} value={d.email}>{d.name}</option>)}
        </select>
        <label className="app-label !mt-0">Desde</label>
        <input type="date" className="app-input !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <label className="app-label !mt-0">Hasta</label>
        <input type="date" className="app-input !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="nav-btn active" onClick={load}>Actualizar</button>
        {role === 'ADMIN' && (
          <button className="nav-btn active" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Marcar rendición pagada'}
          </button>
        )}
      </div>

      {showForm && role === 'ADMIN' && (
        <div className="app-card !p-4 mb-4">
          <h4 className="font-bold mb-3">Marcar rendición como pagada</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="app-label">Delivery</label>
              <select className="app-input" value={newDelivery} onChange={e => setNewDelivery(e.target.value)}>
                <option value="">-- Elegir --</option>
                {deliveries.map(d => <option key={d.email} value={d.email}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="app-label">Fecha rendición</label>
              <input type="date" className="app-input" value={newFecha} onChange={e => setNewFecha(e.target.value)} />
            </div>
            <div>
              <label className="app-label">Monto total (Gs)</label>
              <input type="number" className="app-input" value={newMonto} onChange={e => setNewMonto(Number(e.target.value))} />
            </div>
            <div>
              <label className="app-label">Nota</label>
              <input className="app-input" value={newNota} onChange={e => setNewNota(e.target.value)} />
            </div>
          </div>
          <button className="nav-btn active" onClick={createRendicion}>Guardar</button>
        </div>
      )}

      <div className="overflow-auto">
        <table className="app-table min-w-[900px]">
          <thead>
            <tr>
              <th>Delivery</th><th>Fecha</th><th className="text-right">Monto Total (Gs)</th>
              <th>Nota</th><th>Marcado por</th><th>Marcado en</th><th>Pagado en</th>
              {role === 'ADMIN' && <th>Acción</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const deliveryName = deliveries.find(d => d.email === r.delivery_email)?.name || r.delivery_email;
              return (
                <tr key={r.id}>
                  <td className="text-xs">{deliveryName}</td>
                  <td className="text-xs">{r.fecha_rendicion}</td>
                  <td className="text-right text-xs font-bold">{nf(Number(r.monto_total || 0))}</td>
                  <td className="text-xs">{r.nota || '—'}</td>
                  <td className="text-xs">{r.marcado_por}</td>
                  <td className="text-xs">{r.marcado_en ? new Date(r.marcado_en).toLocaleString('es-PY') : ''}</td>
                  <td className="text-xs">{r.pagado_en ? new Date(r.pagado_en).toLocaleString('es-PY') : ''}</td>
                  {role === 'ADMIN' && (
                    <td>
                      <button className="nav-btn !px-2 !py-1 !text-[10px] !bg-destructive/20 hover:!bg-destructive/40"
                        onClick={() => deleteRendicion(r.id)}>Desmarcar</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={role === 'ADMIN' ? 8 : 7} className="text-center text-muted-foreground py-8">Sin rendiciones</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
