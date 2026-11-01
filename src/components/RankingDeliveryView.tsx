import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { pyDaysAgo, pyToday, pyStart, pyEnd } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

export default function RankingDeliveryView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const [orders, setOrders] = useState<any[]>([]);
  const [dateFrom, setDateFrom] = useState(() => pyDaysAgo(7));
  const [dateTo, setDateTo] = useState(() => pyToday());

  const load = async () => {
    const { data } = await supabase.from('orders').select('*')
      .not('assigned_delivery', 'is', null)
      .gte('assigned_at', pyStart(dateFrom))
      .lte('assigned_at', pyEnd(dateTo));
    setOrders(data || []);
  };

  useEffect(() => { load(); }, []);

  // Build ranking
  const map = new Map<string, { name: string; entregados: number; encomiendas: number; cancelados: number; total: number }>();
  orders.forEach(o => {
    const email = o.assigned_delivery || '';
    if (!map.has(email)) map.set(email, { name: email, entregados: 0, encomiendas: 0, cancelados: 0, total: 0 });
    const entry = map.get(email)!;
    entry.total++;
    if (o.status === 'ENTREGADO') entry.entregados++;
    else if (o.status === 'ENCOMIENDA ENTREGADA') entry.encomiendas++;
    else if (o.status === 'CANCELADO') entry.cancelados++;
  });

  const ranking = Array.from(map.values())
    .map(r => ({ ...r, efectividad: r.total > 0 ? Math.round((r.entregados + r.encomiendas) / r.total * 100) : 0 }))
    .sort((a, b) => b.entregados - a.entregados);

  const totalDelivery = ranking.length;
  const avgEntregados = totalDelivery > 0 ? Math.round(ranking.reduce((s, r) => s + r.entregados, 0) / totalDelivery) : 0;
  const avgEfect = totalDelivery > 0 ? Math.round(ranking.reduce((s, r) => s + r.efectividad, 0) / totalDelivery) : 0;
  const bestEfect = ranking.length > 0 ? Math.max(...ranking.map(r => r.efectividad)) : 0;
  const totalPedidos = orders.length;

  const myRank = role === 'DELIVERY' ? ranking.findIndex(r => r.name.toLowerCase() === profile?.email?.toLowerCase()) : -1;
  const myData = myRank >= 0 ? ranking[myRank] : null;

  const positionClass = (pos: number) => {
    if (pos === 0) return 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black';
    if (pos === 1) return 'bg-gradient-to-br from-gray-300 to-gray-400 text-black';
    if (pos === 2) return 'bg-gradient-to-br from-amber-700 to-amber-800 text-foreground';
    return 'bg-secondary text-foreground';
  };

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">🏆 Ranking de Delivery</h3>

      <div className="flex flex-wrap gap-2 mb-3">
        <label className="app-label !mt-0">Desde</label>
        <input type="date" className="app-input !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <label className="app-label !mt-0">Hasta</label>
        <input type="date" className="app-input !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="nav-btn active" onClick={load}>Actualizar</button>
      </div>

      <div className="grid-kpi mb-4">
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Total Delivery</div><div className="text-[22px] font-extrabold">{totalDelivery}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Promedio Entregados</div><div className="text-[22px] font-extrabold">{avgEntregados}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Promedio Efectividad</div><div className="text-[22px] font-extrabold">{avgEfect}%</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Mejor Efectividad</div><div className="text-[22px] font-extrabold">{bestEfect}%</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Total Pedidos</div><div className="text-[22px] font-extrabold">{totalPedidos}</div></div>
      </div>

      {/* Personal ranking for DELIVERY */}
      {role === 'DELIVERY' && myData && (
        <div className="app-card mb-4" style={{ background: 'linear-gradient(135deg, hsl(240 18% 11%), hsl(240 14% 16%))' }}>
          <h4 className="text-brand font-bold mb-2">🎯 Mi Posición en el Ranking</h4>
          <div className="flex items-center gap-5">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${positionClass(myRank)}`}>
              {myRank + 1}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">Mi Efectividad:</span><span className="font-bold">{myData.efectividad}%</span></div>
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">Mis Entregados:</span><span className="font-bold">{myData.entregados}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Full ranking table */}
      <div className="flex flex-wrap gap-5 mt-4">
        <div className="flex-1 min-w-[400px]">
          <h4 className="font-bold mb-2">Top 10 Delivery</h4>
          <table className="app-table">
            <thead><tr><th>Pos</th><th>Delivery</th><th>ENT</th><th>ENC</th><th>CAN</th><th>Efect.</th></tr></thead>
            <tbody>
              {ranking.slice(0, 10).map((r, i) => (
                <tr key={r.name}>
                  <td><div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${positionClass(i)}`}>{i + 1}</div></td>
                  <td className="text-sm">{r.name}</td>
                  <td className="text-sm font-bold">{r.entregados}</td>
                  <td className="text-sm">{r.encomiendas}</td>
                  <td className="text-sm">{r.cancelados}</td>
                  <td className="text-sm font-bold">{r.efectividad}%</td>
                </tr>
              ))}
              {ranking.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground py-4">Sin datos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
