import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { pyToday, pyStart, pyEnd, pyDateKey } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

export default function EarningsView() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [dateFrom, setDateFrom] = useState(() => pyToday());
  const [dateTo, setDateTo] = useState(() => pyToday());

  const load = async () => {
    const { data: prods } = await supabase.from('products').select('*');
    setProducts(prods || []);

    let query = supabase.from('orders').select('*')
      .in('status', ['ENTREGADO', 'ENCOMIENDA ENTREGADA'])
      .gte('delivered_at', pyStart(dateFrom))
      .lte('delivered_at', pyEnd(dateTo));

    if (profile?.role === 'PROVEEDOR') {
      query = query.ilike('provider_emails_list', `%${profile.email}%`);
    }

    const { data } = await query;
    setOrders(data || []);
  };

  useEffect(() => { load(); }, []);

  // Calculate earnings per product
  const productMap: Record<string, { title: string; price: number; realCost: number; realStock: number; delivered: number; profit: number }> = {};

  orders.forEach(o => {
    const items = Array.isArray(o.items_json) ? o.items_json : [];
    items.forEach((item: any) => {
      if (profile?.role === 'PROVEEDOR' && item.provider_email?.toLowerCase() !== profile?.email?.toLowerCase()) return;
      const key = item.sku || item.title;
      if (!productMap[key]) {
        const prod = products.find(p => p.sku === item.sku);
        productMap[key] = {
          title: item.title || key,
          price: Number(item.provider_price_gs || item.sale_gs || 0),
          realCost: Number(prod?.real_cost_gs || 0),
          realStock: Number(prod?.real_stock || 0),
          delivered: 0,
          profit: 0,
        };
      }
      const qty = Number(item.qty || 1);
      productMap[key].delivered += qty;
      productMap[key].profit += (productMap[key].price - productMap[key].realCost) * qty;
    });
  });

  const rows = Object.values(productMap).sort((a, b) => b.profit - a.profit);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const totalUnits = rows.reduce((s, r) => s + r.delivered, 0);

  const today = pyToday();
  const todayOrders = orders.filter(o => o.delivered_at && pyDateKey(new Date(o.delivered_at)) === today);
  let todayProfit = 0;
  todayOrders.forEach(o => {
    const items = Array.isArray(o.items_json) ? o.items_json : [];
    items.forEach((item: any) => {
      if (profile?.role === 'PROVEEDOR' && item.provider_email?.toLowerCase() !== profile?.email?.toLowerCase()) return;
      const prod = products.find(p => p.sku === item.sku);
      const realCost = Number(prod?.real_cost_gs || 0);
      const price = Number(item.provider_price_gs || item.sale_gs || 0);
      todayProfit += (price - realCost) * Number(item.qty || 1);
    });
  });

  return (
    <div className="app-card">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <h3 className="text-lg font-extrabold">Ganancias</h3>
        <div className="flex flex-wrap gap-2">
          <label className="app-label !mt-0">Desde</label>
          <input type="date" className="app-input !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <label className="app-label !mt-0">Hasta</label>
          <input type="date" className="app-input !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          <button className="nav-btn active" onClick={load}>Filtrar</button>
        </div>
      </div>

      <div className="grid-kpi mb-4">
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Ganancia entregada hoy</div><div className="text-[22px] font-extrabold">{nf(todayProfit)}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Ganancia por fecha de entrega</div><div className="text-[22px] font-extrabold">{nf(totalProfit)}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Unidades entregadas</div><div className="text-[22px] font-extrabold">{totalUnits}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Productos</div><div className="text-[22px] font-extrabold">{rows.length}</div></div>
      </div>

      <table className="app-table">
        <thead>
          <tr><th>Producto</th><th className="text-right">Precio</th><th className="text-right">Mi precio real</th><th className="text-right">Ganancia/u</th><th className="text-right">Stock real</th><th className="text-right">Entregados</th><th className="text-right">Ganancia total</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="text-sm">{r.title}</td>
              <td className="text-right text-sm">{nf(r.price)}</td>
              <td className="text-right text-sm">{nf(r.realCost)}</td>
              <td className="text-right text-sm font-bold">{nf(r.price - r.realCost)}</td>
              <td className="text-right text-sm">{r.realStock}</td>
              <td className="text-right text-sm">{r.delivered}</td>
              <td className="text-right text-sm font-bold">{nf(r.profit)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-8">Sin datos</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
