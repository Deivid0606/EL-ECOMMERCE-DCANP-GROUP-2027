import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyDaysAgo, pyToday, pyStart, pyEnd } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

const isElegible = (estado1: any, status2: any) => {
  const e1 = String(estado1 || '').toUpperCase().trim();
  const s2 = String(status2 || '').toUpperCase().trim();
  return (e1 === 'ENTREGADO' || e1 === 'ENCOMIENDA ENTREGADA') && s2 === 'RENDIDO';
};

export default function CommissionRequestsView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const myEmail = profile?.email || '';

  const [requests, setRequests] = useState<any[]>([]);
  const [paymentRequestId, setPaymentRequestId] = useState<string | null>(null);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [providers, setProviders] = useState<{ email: string; name: string }[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [newProvider, setNewProvider] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newFrom, setNewFrom] = useState(() => pyDaysAgo(30));
  const [newTo, setNewTo] = useState(() => pyToday());
  // Perfil completo (datos, cobro, cédula y selfie) para poder pedir el cobro.
  const [payout, setPayout] = useState<{ ready: boolean; missing: string[] } | null>(null);
  useEffect(() => {
    (supabase as any).rpc('my_payout_status').then(({ data }: any) => {
      if (data) setPayout({ ready: Boolean(data.ready), missing: data.missing || [] });
    });
  }, []);

  const load = async () => {
    const [reqRes, profRes, prodRes] = await Promise.all([
      supabase.from('commission_requests').select('*').order('requested_at', { ascending: false }),
      supabase.from('profiles').select('email, name'),
      supabase.from('products').select('sku, provider_email, provider_price_gs, real_cost_gs'),
    ]);
    setRequests(reqRes.data || []);
    setProviders((profRes.data || []).map(p => ({ email: p.email, name: p.name || p.email })));
    setProducts(prodRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const loadBalanceOrders = async () => {
    const { data } = await supabase.from('orders').select('*')
      .gte('created_at', pyStart(newFrom))
      .lte('created_at', pyEnd(newTo))
      .eq('created_by', myEmail);
    
    const rendidos = (data || []).filter(o => {
      return isElegible(o.status, o.status2);
    });
    
    setOrders(rendidos);
  };

  useEffect(() => { 
    if (showForm && role === 'VENDEDOR') loadBalanceOrders(); 
  }, [showForm, newFrom, newTo]);

  const skuProviderMap = useMemo(() => {
    const map: Record<string, string> = {};
    products.forEach(p => {
      if (p.sku && p.provider_email) {
        map[p.sku.trim()] = p.provider_email.toLowerCase().trim();
      }
    });
    return map;
  }, [products]);

  // Solo PAGADO o pagos históricos APROBADO descuentan del saldo.
  // Las aprobaciones nuevas se registran con PAGADO tras el comprobante.
  const approvedRequests = useMemo(() => {
    return requests.filter(r => 
      r.vendor_email?.toLowerCase() === myEmail.toLowerCase() && 
      r.status === 'APROBADO'
    );
  }, [requests, myEmail]);

  // Obtener solicitudes PENDIENTES (bloquean saldo)
  const pendingRequests = useMemo(() => {
    return requests.filter(r => 
      r.vendor_email?.toLowerCase() === myEmail.toLowerCase() && 
      r.status === 'PENDIENTE'
    );
  }, [requests, myEmail]);

  const balances = useMemo(() => {
    const providerCommissions: Record<string, { 
      total: number;      // Total de comisiones RENDIDAS no pagadas
      paidRequested: number;    // Ya pagadas (solicitudes APROBADAS)
      pendingRequested: number; // En solicitud PENDIENTE
      orderIds: string[] 
    }> = {};
    
    // Primero, calcular todas las comisiones de órdenes RENDIDAS
    orders.forEach(order => {
      if (!isElegible(order.status, order.status2)) return;

      const commission = Number(order.commission_gs || 0);
      if (commission <= 0) return;
      
      const providerSet = new Set<string>();
      
      try {
        const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items_json || []);
        items.forEach((item: any) => {
          const sku = String(item.sku || '').trim();
          const provider = skuProviderMap[sku];
          if (provider) providerSet.add(provider);
        });
      } catch (e) {}
      
      if (providerSet.size === 0 && order.provider_emails_list) {
        const emails = order.provider_emails_list.split(',').map((e: string) => e.trim().toLowerCase());
        emails.forEach(e => {
          if (e) providerSet.add(e);
        });
      }
      
      const providersList = Array.from(providerSet);
      if (providersList.length === 0) return;
      
      const perProvider = commission / providersList.length;
      
      providersList.forEach(prov => {
        if (!providerCommissions[prov]) {
          providerCommissions[prov] = { total: 0, paidRequested: 0, pendingRequested: 0, orderIds: [] };
        }
        
        // Siempre sumar al total si la orden NO está pagada
        if (!order.commission_paid) {
          providerCommissions[prov].total += perProvider;
          
          if (!providerCommissions[prov].orderIds.includes(order.id)) {
            providerCommissions[prov].orderIds.push(order.id);
          }
        }
      });
    });

    // Sumar solicitudes APROBADAS (ya pagadas)
    approvedRequests.forEach(req => {
      if (req.provider_email) {
        const providerEmail = req.provider_email.toLowerCase();
        const amount = Number(req.amount_gs || 0);
        
        if (providerCommissions[providerEmail]) {
          providerCommissions[providerEmail].paidRequested += amount;
        } else {
          providerCommissions[providerEmail] = { 
            total: 0, paidRequested: amount, pendingRequested: 0, orderIds: [] 
          };
        }
      }
    });

    // Sumar solicitudes PENDIENTES (bloquean saldo)
    pendingRequests.forEach(req => {
      if (req.provider_email) {
        const providerEmail = req.provider_email.toLowerCase();
        const amount = Number(req.amount_gs || 0);
        
        if (providerCommissions[providerEmail]) {
          providerCommissions[providerEmail].pendingRequested += amount;
        } else {
          providerCommissions[providerEmail] = { 
            total: 0, paidRequested: 0, pendingRequested: amount, orderIds: [] 
          };
        }
      }
    });

    const result = Object.entries(providerCommissions).map(([providerEmail, data]) => {
      const totalGross = data.total;
      const alreadyPaid = data.paidRequested;
      const alreadyRequested = data.pendingRequested;
      const available = totalGross - alreadyRequested; // No restamos alreadyPaid porque esas ya están fuera del total
      
      return {
        provider: providerEmail,
        grossRendido: totalGross + alreadyPaid, // Mostrar total histórico
        paid: alreadyPaid,
        requested: alreadyRequested,
        available: Math.max(0, available),
        orderIds: data.orderIds,
      };
    });
    
    return result;
  }, [orders, skuProviderMap, approvedRequests, pendingRequests]);

  const filtered = requests.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (role === 'VENDEDOR' && r.vendor_email?.toLowerCase() !== myEmail.toLowerCase()) return false;
    if (role === 'PROVEEDOR' && r.provider_email?.toLowerCase() !== myEmail.toLowerCase()) return false;
    return true;
  });

  const kpis = useMemo(() => ({
    total: filtered.length,
    pendientes: filtered.filter(r => r.status === 'PENDIENTE').length,
    aprobados: filtered.filter(r => r.status === 'APROBADO').length,
    sumAprobados: filtered.filter(r => r.status === 'APROBADO').reduce((s, r) => s + Number(r.amount_gs || 0), 0),
    sumPendientes: filtered.filter(r => r.status === 'PENDIENTE').reduce((s, r) => s + Number(r.amount_gs || 0), 0),
  }), [filtered]);

  const createRequest = async () => {
    if (!newProvider) { toast.error('Elegí un proveedor'); return; }
    if (payout && !payout.ready) {
      toast.error(`Para cobrar completá tu perfil: ${payout.missing.join(', ')}`, { duration: 9000 });
      return;
    }

    const balance = balances.find(b => b.provider === newProvider);
    const available = balance?.available || 0;

    if (available <= 0) {
      toast.error('No tenés saldo disponible para este proveedor.');
      return;
    }

    if (!balance?.orderIds?.length) {
      toast.error('No hay pedidos disponibles para solicitar');
      return;
    }

    const { error } = await supabase.from('commission_requests').insert({
      vendor_email: myEmail,
      provider_email: newProvider,
      amount_gs: available,
      note: newNote,
      range_from: newFrom,
      range_to: newTo,
      requested_by: myEmail,
      status: 'PENDIENTE',
      meta_json: {
        order_ids: balance.orderIds,
        gross: balance.grossRendido,
      },
    });

    if (error) { toast.error(error.message); return; }

    toast.success(`Solicitud creada por Gs ${nf(available)}`);
    setShowForm(false);
    setNewProvider('');
    setNewNote('');
    await load();
    if (showForm && role === 'VENDEDOR') await loadBalanceOrders();
  };

  const approve = (id: string) => {
    setPaymentRequestId(id);
    setPaymentFile(null);
    setPaymentNote('');
  };

  const confirmPayment = async () => {
    if (!paymentRequestId || !paymentFile) { toast.error('Adjuntá el comprobante'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(paymentFile.type) || paymentFile.size > 8 * 1024 * 1024) {
      toast.error('Usá JPG, PNG, WEBP o PDF de hasta 8 MB'); return;
    }
    setPaymentBusy(true);
    const ext = paymentFile.type === 'application/pdf' ? 'pdf' : paymentFile.type === 'image/png' ? 'png' : paymentFile.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `commission/${paymentRequestId}/${crypto.randomUUID()}.${ext}`;
    try {
      const { error: uploadError } = await supabase.storage.from('financial-receipts').upload(path, paymentFile, { upsert: false, contentType: paymentFile.type });
      if (uploadError) throw uploadError;
      const { error } = await supabase.rpc('pay_commission_with_receipt', { p_request_id: paymentRequestId, p_receipt_path: path, p_note: paymentNote });
      if (error) throw error;
      toast.success('Comisión pagada con comprobante registrado');
      setPaymentRequestId(null); setPaymentFile(null);
      await load();
    } catch (error: any) { toast.error(error?.message || 'No se pudo registrar el pago'); }
    finally { setPaymentBusy(false); }
  };

  const viewReceipt = async (path: string) => {
    const { data, error } = await supabase.storage.from('financial-receipts').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { toast.error(error?.message || 'No se pudo abrir el comprobante'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const reject = async (id: string) => {
    const note = prompt('Motivo del rechazo:') || '';
    const { error } = await supabase.from('commission_requests').update({
      status: 'RECHAZADO', 
      rejected_at: new Date().toISOString(),
      rejected_by: myEmail, 
      approval_note: note,
    }).eq('id', id);
    
    if (error) {
      toast.error(error.message);
    } else { 
      toast.success('Solicitud rechazada');
      await load();
      if (showForm && role === 'VENDEDOR') await loadBalanceOrders();
    }
  };

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">Solicitud de comisiones</h3>
      {paymentRequestId && (role === 'ADMIN' || role === 'PROVEEDOR') && (
        <div className="rounded-xl border border-border p-4 mb-4 space-y-3 bg-card">
          <h4 className="font-bold">💳 Aprobar y registrar pago</h4>
          <p className="text-sm">Solicitud: {paymentRequestId} — Gs {nf(Number(requests.find(r => r.id === paymentRequestId)?.amount_gs || 0))}</p>
          <label className="text-sm block">Comprobante de transferencia (obligatorio)
            <input className="app-input w-full mt-1" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setPaymentFile(e.target.files?.[0] || null)} />
          </label>
          <textarea className="app-input w-full" placeholder="Nota (opcional)" value={paymentNote} onChange={e => setPaymentNote(e.target.value)} />
          <div className="flex gap-2">
            <button className="nav-btn active" disabled={!paymentFile || paymentBusy} onClick={confirmPayment}>{paymentBusy ? 'Guardando...' : '✅ Confirmar pago'}</button>
            <button className="nav-btn" disabled={paymentBusy} onClick={() => setPaymentRequestId(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">Total solicitudes</div>
          <div className="text-[22px] font-extrabold">{kpis.total}</div>
        </div>
        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">Pendientes</div>
          <div className="text-[22px] font-extrabold">{kpis.pendientes}</div>
          <div className="text-xs text-muted-foreground">Gs {nf(kpis.sumPendientes)}</div>
        </div>
        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">Aprobados</div>
          <div className="text-[22px] font-extrabold">{kpis.aprobados}</div>
          <div className="text-xs text-muted-foreground">Gs {nf(kpis.sumAprobados)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="app-input !w-auto min-w-[180px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todas</option>
          <option value="PENDIENTE">Pendientes</option>
          <option value="APROBADO">Aprobadas</option>
          <option value="RECHAZADO">Rechazadas</option>
        </select>
        <button className="nav-btn active" onClick={load}>Actualizar</button>
        {role === 'VENDEDOR' && (
          <button className="nav-btn active" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Nueva solicitud'}
          </button>
        )}
      </div>

      {showForm && role === 'VENDEDOR' && (
        <div className="app-card !p-4 mb-4">
          <h4 className="font-bold mb-3">Nueva solicitud de comisión</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="app-label">Desde</label>
              <input type="date" className="app-input" value={newFrom} onChange={e => setNewFrom(e.target.value)} />
            </div>
            <div>
              <label className="app-label">Hasta</label>
              <input type="date" className="app-input" value={newTo} onChange={e => setNewTo(e.target.value)} />
            </div>
            <div>
              <label className="app-label">Proveedor</label>
              <select className="app-input" value={newProvider} onChange={e => { setNewProvider(e.target.value); }}>
                <option value="">-- Elegir --</option>
                {balances.filter(b => b.available > 0).map(b => {
                  const providerName = providers.find(p => p.email.toLowerCase() === b.provider)?.name || b.provider;
                  return (
                    <option key={b.provider} value={b.provider}>
                      {providerName} — Disponible: Gs {nf(b.available)}
                    </option>
                  );
                })}
                {balances.filter(b => b.available <= 0).length > 0 && (
                  <option disabled>--- Sin saldo disponible ---</option>
                )}
              </select>
            </div>
          </div>
          {newProvider && (() => {
            const bal = balances.find(b => b.provider === newProvider);
            return (
              <div className="mb-3 p-3 rounded-xl border border-border bg-secondary/50">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>📊 Total rendido: Gs {nf(bal?.grossRendido || 0)}</div>
                  <div>✅ Ya pagado: Gs {nf(bal?.paid || 0)}</div>
                  {bal && bal.requested > 0 && (
                    <div className="text-orange-600">⏳ Pendiente de aprobación: Gs {nf(bal.requested)}</div>
                  )}
                </div>
                <div className={`text-sm font-bold mt-2 ${(bal?.available || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {bal && bal.available > 0 
                    ? `💰 Disponible para solicitar: Gs ${nf(bal.available)}`
                    : `❌ No hay saldo disponible`
                  }
                </div>
              </div>
            );
          })()}
          {payout && !payout.ready ? (
            <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <b className="text-amber-300">⚠️ Todavía no podés cobrar.</b> Completá en <b>Perfil</b>: {payout.missing.join(' · ')}
            </div>
          ) : (
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
              ✅ Tus datos de cobro del perfil se envían solos con la solicitud.
            </div>
          )}
          <div className="mb-3">
            <label className="app-label">Nota (opcional)</label>
            <input className="app-input" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Nota para el proveedor" />
          </div>
          <button 
            className="nav-btn active" 
            onClick={createRequest}
            disabled={!newProvider || (payout !== null && !payout.ready) || (balances.find(b => b.provider === newProvider)?.available || 0) <= 0}
          >
            Enviar solicitud
          </button>
        </div>
      )}

      <div className="overflow-auto">
        <table className="app-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Vendedor</th>
              <th>Proveedor</th>
              <th className="text-right">Monto (Gs)</th>
              <th>Rango</th>
              <th>Nota</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="text-xs whitespace-nowrap">{r.requested_at ? new Date(r.requested_at).toLocaleDateString('es-PY') : ''}</td>
                <td className="text-xs">
                  {r.vendor_email}
                  {(role === 'ADMIN' || role === 'PROVEEDOR') && r.meta_json?.payout && (() => {
                    const p = r.meta_json.payout;
                    const line = p.method === 'wallet'
                      ? `📱 ${p.wallet_provider} · ${p.wallet_number} · ${p.wallet_holder}`
                      : `🏦 ${p.bank_name} · ${p.bank_type} · N° ${p.bank_num} · ${p.bank_holder} (CI ${p.bank_holder_ci})`;
                    return (
                      <button
                        type="button"
                        className="mt-1 block max-w-[260px] truncate rounded-md bg-secondary/60 px-1.5 py-0.5 text-left text-[10px]"
                        title={`${line} — tocá para copiar`}
                        onClick={() => { void navigator.clipboard?.writeText(line); toast.success('Datos de cobro copiados'); }}
                      >
                        {line}
                      </button>
                    );
                  })()}
                </td>
                <td className="text-xs">{r.provider_email}</td>
                <td className="text-right text-xs font-bold">{nf(Number(r.amount_gs || 0))}</td>
                <td className="text-xs whitespace-nowrap">{r.range_from} — {r.range_to}</td>
                <td className="text-xs max-w-[200px] truncate">{r.note || r.approval_note || '—'}</td>
                <td>
                  <span className={`badge-status ${(r.status === 'APROBADO' || r.status === 'PAGADO') ? 'badge-entregado' : r.status === 'RECHAZADO' ? 'badge-cancelado' : 'badge-pendiente'}`}>
                    {r.status}
                  </span>
                </td>
                <td>
                  {r.status === 'PENDIENTE' && (role === 'ADMIN' || role === 'PROVEEDOR') && (
                    <div className="flex gap-1">
                      <button className="nav-btn active text-xs !py-1 !px-2" onClick={() => approve(r.id)}>💳 Aprobar y pagar</button>
                      <button className="nav-btn text-xs !py-1 !px-2" onClick={() => reject(r.id)}>❌ Rechazar</button>
                    </div>
                  )}
                  {r.receipt_path && <button className="nav-btn text-xs !py-1 !px-2" onClick={() => viewReceipt(r.receipt_path)}>📄 Ver comprobante</button>}
                  {r.status !== 'PENDIENTE' && (
                    <span className="text-[10px] text-muted-foreground">{r.approved_by || r.rejected_by || ''}</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted-foreground py-8">Sin solicitudes</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
