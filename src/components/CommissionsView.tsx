import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyDaysAgo, pyToday, pyStart, pyEnd } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

const normalizar = (v: any) => String(v || '').toUpperCase().trim();

const cleanPhoneForWhatsApp = (phone: any) => {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = '595' + p.slice(1);
  if (!p.startsWith('595')) p = '595' + p;
  return p;
};

const isComisionNeta = (estado1: any, commissionPaid: any) => {
  const e1 = normalizar(estado1);
  return (
    (e1 === 'ENTREGADO' ||
      e1 === 'ENCOMIENDA ENTREGADA' ||
      e1 === 'GUIA GENERADA') &&
    !commissionPaid
  );
};

const isDisponible = (estado1: any, status2: any, commissionPaid: any) => {
  const e1 = normalizar(estado1);
  const s2 = normalizar(status2);
  return (
    (e1 === 'ENTREGADO' || e1 === 'ENCOMIENDA ENTREGADA') &&
    s2 === 'RENDIDO' &&
    !commissionPaid
  );
};

const isYaSolicitado = (estado1: any, status2: any, commissionPaid: any) => {
  const e1 = normalizar(estado1);
  const s2 = normalizar(status2);
  return (
    (e1 === 'ENTREGADO' || e1 === 'ENCOMIENDA ENTREGADA') &&
    s2 === 'RENDIDO' &&
    !!commissionPaid
  );
};

const isElegible = (estado1: any, status2: any) => {
  const e1 = normalizar(estado1);
  const s2 = normalizar(status2);
  return (e1 === 'ENTREGADO' || e1 === 'ENCOMIENDA ENTREGADA') && s2 === 'RENDIDO';
};

export default function CommissionsView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const myEmail = profile?.email || '';
  
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('PENDIENTE');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterProvider, setFilterProvider] = useState('');
  const [vendors, setVendors] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [commissionRequests, setCommissionRequests] = useState<any[]>([]);
  const [dateFrom, setDateFrom] = useState(() => pyDaysAgo(30));
  const [dateTo, setDateTo] = useState(() => pyToday());

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('email, name, logo_url, phone'),
      supabase.from('products').select('sku, provider_email'),
      supabase.from('commission_requests').select('*'),
    ]).then(([profilesRes, productsRes, requestsRes]) => {
      setVendors(profilesRes.data || []);
      setProviders(profilesRes.data || []);
      setProducts(productsRes.data || []);
      setCommissionRequests(requestsRes.data || []);
    });
  }, []);

  const loadCommissions = async () => {
    let query = supabase.from('orders').select('*')
      .gte('created_at', pyStart(dateFrom))
      .lte('created_at', pyEnd(dateTo))
      .order('created_at', { ascending: false });

    if (role === 'VENDEDOR') {
      query = query.eq('created_by', profile?.email);
    }
    
    if (role === 'PROVEEDOR' && profile?.email) {
      query = query.ilike('provider_emails_list', `%${profile.email}%`);
    }

    const { data } = await query;

    setOrders((data || []).filter(o => {
      const e1 = normalizar(o.status);
      return (
        e1 === 'ENTREGADO' ||
        e1 === 'ENCOMIENDA ENTREGADA' ||
        e1 === 'GUIA GENERADA'
      );
    }));
  };

  useEffect(() => { loadCommissions(); }, [dateFrom, dateTo]);

  const baseFiltered = orders.filter(o => {
    if (filterVendor && o.created_by?.toLowerCase() !== filterVendor.toLowerCase()) return false;
    if (role === 'ADMIN' && filterProvider && !(o.provider_emails_list || '').toLowerCase().includes(filterProvider.toLowerCase())) return false;
    if (search) {
      const q = search.toLowerCase();
      return (o.customer_name || '').toLowerCase().includes(q) ||
        (o.phone || '').includes(q) ||
        (o.order_number || '').toLowerCase().includes(q);
    }
    return true;
  });

  const filtered = baseFiltered.filter(o => {
    if (normalizar(o.status2) !== 'RENDIDO') return false;
    if (filterStatus === 'PENDIENTE' && o.commission_paid) return false;
    if (filterStatus === 'PAGADO' && !o.commission_paid) return false;
    return true;
  });

  const approvedRequestsFiltered = commissionRequests.filter(req => {
    if (req.status !== 'APROBADO') return false;

    if (role === 'VENDEDOR' && req.vendor_email?.toLowerCase() !== myEmail.toLowerCase()) return false;
    if (role === 'PROVEEDOR' && req.provider_email?.toLowerCase() !== myEmail.toLowerCase()) return false;

    if ((role === 'ADMIN' || role === 'PROVEEDOR') && filterVendor && req.vendor_email?.toLowerCase() !== filterVendor.toLowerCase()) return false;
    if (role === 'ADMIN' && filterProvider && req.provider_email?.toLowerCase() !== filterProvider.toLowerCase()) return false;

    const rawDate = req.approved_at || req.requested_at;
    if (!rawDate) return true;

    const d = new Date(rawDate);
    const from = new Date(pyStart(dateFrom));
    const to = new Date(pyEnd(dateTo));

    return d >= from && d <= to;
  });

  const approvedByProvider = useMemo(() => {
    const map: Record<string, number> = {};

    approvedRequestsFiltered.forEach(req => {
      const prov = String(req.provider_email || '').toLowerCase().trim();
      if (!prov) return;
      map[prov] = (map[prov] || 0) + Number(req.amount_gs || 0);
    });

    return map;
  }, [approvedRequestsFiltered]);

  const totalAprobadoSolicitudes = approvedRequestsFiltered.reduce((s, req) => {
    return s + Number(req.amount_gs || 0);
  }, 0);

  // ── CORRECCIÓN: solicitudes PENDIENTES por proveedor (bloquean el disponible) ──
  const pendingByProvider = useMemo(() => {
    const map: Record<string, number> = {};
    commissionRequests
      .filter(r => {
        if (r.status !== 'PENDIENTE') return false;
        // Para VENDEDOR solo las suyas; para ADMIN/PROVEEDOR aplicar filtros activos
        if (role === 'VENDEDOR' && r.vendor_email?.toLowerCase() !== myEmail.toLowerCase()) return false;
        if (role === 'PROVEEDOR' && r.provider_email?.toLowerCase() !== myEmail.toLowerCase()) return false;
        if ((role === 'ADMIN' || role === 'PROVEEDOR') && filterVendor && r.vendor_email?.toLowerCase() !== filterVendor.toLowerCase()) return false;
        if (role === 'ADMIN' && filterProvider && r.provider_email?.toLowerCase() !== filterProvider.toLowerCase()) return false;
        return true;
      })
      .forEach(r => {
        const prov = String(r.provider_email || '').toLowerCase().trim();
        if (!prov) return;
        map[prov] = (map[prov] || 0) + Number(r.amount_gs || 0);
      });
    return map;
  }, [commissionRequests, myEmail, role, filterVendor, filterProvider]);

  const providerBalances = useMemo(() => {
    const skuProvider: Record<string, string> = {};
    products.forEach(p => {
      if (p.sku && p.provider_email) {
        skuProvider[p.sku.trim()] = p.provider_email.toLowerCase().trim();
      }
    });

    const map: Record<string, {
      provider: string;
      totalComision: number;
      rendido: number;
      disponible: number;
      yaSolicitado: number;
      orderIds: string[];
    }> = {};

    baseFiltered.forEach(o => {
      const commission = Number(o.commission_gs || 0);
      if (commission <= 0) return;

      const provSet = new Set<string>();
      try {
        const items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items_json || []);
        items.forEach((it: any) => {
          const sku = String(it.sku || '').trim();
          const prov = skuProvider[sku];
          if (prov) provSet.add(prov);
        });
      } catch {}

      if (provSet.size === 0 && o.provider_emails_list) {
        o.provider_emails_list.split(',').forEach((e: string) => {
          const t = e.trim().toLowerCase();
          if (t) provSet.add(t);
        });
      }

      if (provSet.size === 0) return;
      
      const perProv = commission / provSet.size;
      
      provSet.forEach(prov => {
        if (!map[prov]) {
          map[prov] = {
            provider: prov,
            totalComision: 0,
            rendido: 0,
            disponible: 0,
            yaSolicitado: 0,
            orderIds: [],
          };
        }

        if (isComisionNeta(o.status, o.commission_paid)) {
          map[prov].totalComision += perProv;
        }
        
        if (isDisponible(o.status, o.status2, o.commission_paid)) {
          map[prov].rendido += perProv;
          map[prov].disponible += perProv;

          if (!map[prov].orderIds.includes(o.id)) {
            map[prov].orderIds.push(o.id);
          }
        }

        if (isYaSolicitado(o.status, o.status2, o.commission_paid)) {
          map[prov].yaSolicitado += perProv;
        }
      });
    });

    Object.entries(approvedByProvider).forEach(([prov, amount]) => {
      if (!map[prov]) {
        map[prov] = {
          provider: prov,
          totalComision: 0,
          rendido: 0,
          disponible: 0,
          yaSolicitado: 0,
          orderIds: [],
        };
      }

      map[prov].yaSolicitado = amount;
    });

    return Object.values(map).filter(b =>
      b.totalComision > 0 ||
      b.rendido > 0 ||
      b.disponible > 0 ||
      b.yaSolicitado > 0
    );
  }, [baseFiltered, products, approvedByProvider]);

  const totalEntregado = baseFiltered.reduce((s, o) => {
    const commission = Number(o.commission_gs || 0);
    if (commission > 0 && isComisionNeta(o.status, o.commission_paid)) {
      return s + commission;
    }
    return s;
  }, 0);
  
  const totalRendido = baseFiltered.reduce((s, o) => {
    const commission = Number(o.commission_gs || 0);
    if (commission > 0 && isDisponible(o.status, o.status2, o.commission_paid)) {
      return s + commission;
    }
    return s;
  }, 0);
  
  const totalSolicitado = filterStatus === 'PAGADO'
    ? totalAprobadoSolicitudes
    : providerBalances.reduce((s, b) => s + b.yaSolicitado, 0);

  // ── CORRECCIÓN: disponible total resta solicitudes PENDIENTES ──
  const totalDisponible = providerBalances.reduce((s, b) => {
    const pending = pendingByProvider[b.provider] || 0;
    return s + Math.max(0, b.disponible - pending);
  }, 0);
  
  const sumaComisionNeta = filterStatus === 'PAGADO'
    ? totalAprobadoSolicitudes
    : totalEntregado;

  const saldoDisponible = filterStatus === 'PAGADO'
    ? totalSolicitado
    : totalDisponible;

  const togglePaid = async (orderId: string, paid: boolean) => {
    const { error } = await supabase.from('orders').update({
      commission_paid: paid,
      paid_at: paid ? new Date().toISOString() : null,
    }).eq('id', orderId);
    if (error) toast.error(error.message);
    else { toast.success(paid ? 'Marcado como PAGADO' : 'Desmarcado'); loadCommissions(); }
  };

  const markAllPaid = async () => {
    const pending = baseFiltered.filter(o => isDisponible(o.status, o.status2, o.commission_paid));
    for (const o of pending) {
      await supabase.from('orders').update({ commission_paid: true, paid_at: new Date().toISOString() }).eq('id', o.id);
    }
    toast.success(`${pending.length} comisiones marcadas como PAGADO`);
    loadCommissions();
  };

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">
        {role === 'VENDEDOR' ? '💰 Mis Comisiones' : role === 'PROVEEDOR' ? '💰 Comisiones a Pagar' : '💰 Pago de comisiones'}
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        <label className="app-label !mt-0">Desde</label>
        <input type="date" className="app-input !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <label className="app-label !mt-0">Hasta</label>
        <input type="date" className="app-input !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        
        {(role === 'ADMIN' || role === 'PROVEEDOR') && (
          <select className="app-input !w-auto min-w-[200px]" value={filterVendor} onChange={e => setFilterVendor(e.target.value)}>
            <option value="">Todos los vendedores</option>
            {vendors.map(v => <option key={v.email} value={v.email}>{v.name || v.email}</option>)}
          </select>
        )}
        
        {role === 'ADMIN' && (
          <select className="app-input !w-auto min-w-[200px]" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
            <option value="">Todos los proveedores</option>
            {providers.map(p => <option key={p.email} value={p.email}>{p.name || p.email}</option>)}
          </select>
        )}
        
        <select className="app-input !w-auto min-w-[160px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="PENDIENTE">Pendiente</option>
          <option value="PAGADO">Pagado</option>
          {role === 'ADMIN' && <option value="">Todos</option>}
        </select>
        
        <input className="app-input !w-auto min-w-[240px]" placeholder="🔎 Buscar por cliente, teléfono o ID"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className="nav-btn active" onClick={loadCommissions}>Aplicar</button>
      </div>

      {(role === 'ADMIN') && (
        <div className="mb-3">
          <button className="nav-btn active text-xs" onClick={markAllPaid}>Marcar todos como PAGADO (solo RENDIDO)</button>
        </div>
      )}

      <div className="grid-kpi mb-4">
        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">Pedidos filtrados</div>
          <div className="text-[22px] font-extrabold">{filtered.length}</div>
        </div>

        {(role === 'ADMIN' || role === 'PROVEEDOR') && (
          <div className="kpi-card">
            <div className="text-xs text-muted-foreground mb-1">Suma comisión neta (Gs)</div>
            <div className="text-[22px] font-extrabold">{nf(sumaComisionNeta)}</div>
            <div className="text-[10px] text-muted-foreground">Total comisiones entregadas</div>
          </div>
        )}

        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">Saldo disponible (Gs)</div>
          <div className="text-[22px] font-extrabold">{nf(saldoDisponible)}</div>
          <div className="text-[10px] text-muted-foreground">
            {filterStatus === 'PAGADO' ? 'Total ya cobrado' : 'Solo pedidos en estado RENDIDO'}
          </div>
        </div>
      </div>

      {(role === 'VENDEDOR' || role === 'PROVEEDOR' || role === 'ADMIN') && providerBalances.length > 0 && (
        <div className="mb-4">
          <h4 className="font-bold text-sm mb-2">📊 Desglose por Proveedor</h4>

          {role === 'VENDEDOR' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {providerBalances.map(b => {
                const providerProfile = providers.find(p => p.email?.toLowerCase() === b.provider);
                const providerName = providerProfile?.name || b.provider;
                const providerLogo = providerProfile?.logo_url || '';
                const providerPhone = cleanPhoneForWhatsApp(providerProfile?.phone || '');

                // ── CORRECCIÓN: restar solicitudes PENDIENTES del disponible ──
                const pendingAmount = pendingByProvider[b.provider] || 0;
                const rendido = filterStatus === 'PAGADO' ? b.yaSolicitado : b.rendido;
                const disponible = filterStatus === 'PAGADO'
                  ? 0
                  : Math.max(0, b.disponible - pendingAmount);

                const cardStatus = filterStatus === 'PAGADO'
                  ? 'PAGADO'
                  : disponible > 0
                    ? 'PENDIENTE'
                    : 'AL DÍA';

                const waText = encodeURIComponent(
                  `Hola ${providerName}, soy ${profile?.name || myEmail}. Tengo una consulta sobre mis comisiones.\n\n` +
                  `Estado: ${cardStatus}\n` +
                  `Rendido disponible: Gs ${nf(rendido)}\n` +
                  `Ya solicitado: Gs ${nf(b.yaSolicitado)}\n` +
                  `Disponible para solicitar: Gs ${nf(disponible)}`
                );

                return (
                  <div key={b.provider} className="kpi-card">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {providerLogo ? (
                          <img
                            src={providerLogo}
                            alt={providerName}
                            className="w-10 h-10 rounded-xl object-cover border border-border bg-background shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl border border-border bg-secondary flex items-center justify-center text-sm font-extrabold shrink-0">
                            {String(providerName || '?').slice(0, 1).toUpperCase()}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Proveedor</div>
                          <div className="text-sm font-extrabold leading-tight truncate">{providerName}</div>
                        </div>
                      </div>

                      <span className={`badge-status ${cardStatus === 'PENDIENTE' ? 'badge-pendiente' : 'badge-entregado'} shrink-0`}>
                        {cardStatus}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Rendido disponible</span>
                        <span className="text-sm font-bold text-green-600">Gs {nf(rendido)}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Ya solicitado</span>
                        <span className="text-sm font-bold text-orange-600">Gs {nf(b.yaSolicitado)}</span>
                      </div>

                      {pendingAmount > 0 && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground">⏳ Solicitud pendiente</span>
                          <span className="text-sm font-bold text-orange-500">Gs {nf(pendingAmount)}</span>
                        </div>
                      )}

                      <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
                        <span className="text-xs font-bold">Disponible para solicitar</span>
                        <span className="text-base font-extrabold text-blue-600">Gs {nf(disponible)}</span>
                      </div>

                      {providerPhone && (
                        <a
                          href={`https://wa.me/${providerPhone}?text=${waText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="nav-btn active text-xs !py-2 !px-3 w-full mt-3 flex items-center justify-center gap-2"
                        >
                          <span className="text-base">🟢</span>
                          WhatsApp proveedor
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="app-table text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    {(role === 'ADMIN' || role === 'PROVEEDOR') && (
                      <>
                        <th className="text-left">Proveedor</th>
                        <th className="text-right">Comisión total (Gs)</th>
                      </>
                    )}
                    <th className="text-right">Rendido disponible (Gs)</th>
                    <th className="text-right">Ya solicitado (Gs)</th>
                    <th className="text-right">⏳ Pendiente aprobación (Gs)</th>
                    <th className="text-right">Disponible para solicitar (Gs)</th>
                   </tr>
                </thead>
                <tbody>
                  {providerBalances.map(b => {
                    const providerProfile = providers.find(p => p.email?.toLowerCase() === b.provider);
                    const providerName = providerProfile?.name || b.provider;
                    const providerLogo = providerProfile?.logo_url || '';

                    // ── CORRECCIÓN: restar solicitudes PENDIENTES del disponible ──
                    const pendingAmount = pendingByProvider[b.provider] || 0;
                    const disponibleReal = filterStatus === 'PAGADO'
                      ? 0
                      : Math.max(0, b.disponible - pendingAmount);

                    return (
                      <tr key={b.provider}>
                        {(role === 'ADMIN' || role === 'PROVEEDOR') && (
                          <>
                            <td className="text-xs font-medium">
                              <div className="flex items-center gap-2">
                                {providerLogo ? (
                                  <img
                                    src={providerLogo}
                                    alt={providerName}
                                    className="w-7 h-7 rounded-lg object-cover border border-border bg-background shrink-0"
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-lg border border-border bg-secondary flex items-center justify-center text-[10px] font-extrabold shrink-0">
                                    {String(providerName || '?').slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                                <span>{providerName}</span>
                              </div>
                            </td>
                            <td className="text-right text-xs">{nf(filterStatus === 'PAGADO' ? b.yaSolicitado : b.totalComision)}</td>
                          </>
                        )}
                        <td className="text-right text-xs text-green-600">{nf(filterStatus === 'PAGADO' ? b.yaSolicitado : b.rendido)}</td>
                        <td className="text-right text-xs text-orange-600">{nf(b.yaSolicitado)}</td>
                        <td className="text-right text-xs text-orange-500">{nf(filterStatus === 'PAGADO' ? 0 : pendingAmount)}</td>
                        <td className="text-right text-xs font-bold text-blue-600">{nf(disponibleReal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/30">
                  <tr>
                    {(role === 'ADMIN' || role === 'PROVEEDOR') && (
                      <>
                        <td className="font-bold">TOTAL</td>
                        <td className="text-right font-bold">{nf(sumaComisionNeta)}</td>
                      </>
                    )}
                    <td className="text-right font-bold">{nf(filterStatus === 'PAGADO' ? totalAprobadoSolicitudes : totalRendido)}</td>
                    <td className="text-right font-bold">{nf(totalSolicitado)}</td>
                    <td className="text-right font-bold">
                      {nf(filterStatus === 'PAGADO' ? 0 : providerBalances.reduce((s, b) => s + (pendingByProvider[b.provider] || 0), 0))}
                    </td>
                    <td className="text-right font-bold">{nf(filterStatus === 'PAGADO' ? 0 : saldoDisponible)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="overflow-auto">
        <table className="app-table min-w-[1000px]">
          <thead>
            <tr>
              <th>Fecha</th><th>ID</th><th>Ciudad</th><th>Cliente</th><th>Vendedor</th><th>Delivery</th>
              <th className="text-right">Total (Gs)</th><th className="text-right">Comisión (Gs)</th><th>Estado 1</th><th>Status2</th><th>Pago</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.id} className={isElegible(o.status, o.status2) ? 'bg-green-500/5' : 'opacity-60'}>
                <td className="text-xs whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('es-PY')}</td>
                <td className="text-xs font-bold">{o.order_number || o.id.slice(0, 8)}</td>
                <td className="text-xs">{o.city}</td>
                <td className="text-xs">{o.customer_name}</td>
                <td className="text-xs">{o.created_by}</td>
                <td className="text-xs">{o.assigned_delivery || '—'}</td>
                <td className="text-right text-xs font-bold">{nf(Number(o.total_gs || 0))}</td>
                <td className="text-right text-xs">{nf(Number(o.commission_gs || 0))}</td>
                <td><span className="badge-status badge-entregado">{o.status}</span></td>
                <td>
                  <span className={`badge-status ${o.status2 === 'RENDIDO' ? 'badge-entregado' : 'badge-pendiente'}`}>
                    {o.status2 || 'PENDIENTE'}
                  </span>
                </td>
                <td>
                  {(role === 'ADMIN') ? (
                    <select className="app-input !w-auto !py-1 !px-2 text-xs" value={o.commission_paid ? 'PAGADO' : 'PENDIENTE'}
                      onChange={e => togglePaid(o.id, e.target.value === 'PAGADO')}>
                      <option value="PENDIENTE">PENDIENTE</option>
                      <option value="PAGADO">PAGADO</option>
                    </select>
                  ) : (
                    <span className={`badge-status ${o.commission_paid ? 'badge-entregado' : 'badge-pendiente'}`}>
                      {o.commission_paid ? 'PAGADO' : 'PENDIENTE'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="text-center text-muted-foreground py-8">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
