import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyFirstOfMonth, pyToday, pyStart, pyEnd } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

export default function AssignOrdersView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const [orders, setOrders] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignDelivery, setAssignDelivery] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(() => pyFirstOfMonth());
  const [dateTo, setDateTo] = useState(() => pyToday());
  const [idsInput, setIdsInput] = useState('');
  const [filterBy, setFilterBy] = useState<'created_at' | 'assigned_at'>('created_at');
  const [autoAssignProcessing, setAutoAssignProcessing] = useState(false);

  // ─── NUEVO: estado intermedio para QR ────────────────────────────────────
  const [pendingQrId, setPendingQrId] = useState<string | null>(null);

  // Función para obtener parámetros del hash (para HashRouter)
  const getHashParams = () => {
    const hash = window.location.hash;
    const queryString = hash.split('?')[1];
    if (!queryString) return {};
    const params = new URLSearchParams(queryString);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  };

  // Función auxiliar para obtener el nombre de un delivery por email
  const getDeliveryName = async (email: string): Promise<string> => {
    if (!email) return email;
    const { data } = await supabase
      .from('profiles')
      .select('name')
      .eq('email', email)
      .single();
    return data?.name || email;
  };

  // Función auxiliar para formatear fecha de asignación
  const formatAssignedDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'fecha desconocida';
    return new Date(dateStr).toLocaleString('es-PY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  // ─── EFECTO 1: Solo captura el ?id= del hash al montar ───────────────────
  // Corre una sola vez. No depende de role ni profile.
  useEffect(() => {
    const params = getHashParams();
    const orderValue = params.id;
    if (orderValue) {
      console.log('🔍 QR detectado al montar - Valor:', orderValue);
      setPendingQrId(orderValue);
      // Limpiar la URL de inmediato para que no persista
      window.location.hash = '/asignar-pedidos';
    }
  }, []);

  // ─── EFECTO 2: Procesa el QR cuando role Y pendingQrId están disponibles ─
  // Se re-dispara cuando role carga (caso Android: llega undefined primero)
  useEffect(() => {
    if (!pendingQrId || !role || autoAssignProcessing) return;

    console.log('🚀 Procesando QR con role disponible:', role, '| ID:', pendingQrId);
    setAutoAssignProcessing(true);

    const selectOrder = async () => {
      let orderData = null;
      let findError = null;

      // Determinar si es UUID (tiene guiones y longitud > 30) o número de orden
      const isUUID = pendingQrId.includes('-') && pendingQrId.length > 30;
      console.log('🔍 Es UUID?', isUUID);

      if (isUUID) {
        console.log('🔍 Buscando por ID (UUID)...');
        const result = await supabase
          .from('orders')
          .select('id, assigned_delivery, assigned_at, order_number, customer_name, phone')
          .eq('id', pendingQrId)
          .maybeSingle();
        orderData = result.data;
        findError = result.error;
      } else {
        console.log('🔍 Buscando por order_number...');
        const result = await supabase
          .from('orders')
          .select('id, assigned_delivery, assigned_at, order_number, customer_name, phone')
          .eq('order_number', pendingQrId)
          .maybeSingle();
        orderData = result.data;
        findError = result.error;
      }

      console.log('📦 Resultado de búsqueda:', orderData);

      if (findError) {
        console.error('❌ Error de Supabase:', findError);
        toast.error(`❌ Error: ${findError.message}`);
        setPendingQrId(null);
        setAutoAssignProcessing(false);
        return;
      }

      if (!orderData) {
        toast.error(`❌ Pedido ${pendingQrId} no encontrado`);
        setPendingQrId(null);
        setAutoAssignProcessing(false);
        return;
      }

      console.log('✅ Pedido encontrado:', orderData);
      const displayId = orderData.order_number || orderData.id.substring(0, 8);

      // Verificar si ya está asignado a alguien distinto
      if (orderData.assigned_delivery && orderData.assigned_delivery !== profile?.email) {
        const deliveryName = await getDeliveryName(orderData.assigned_delivery);
        const fechaAsignacion = formatAssignedDate(orderData.assigned_at);
        toast.error(`❌ El pedido ${displayId} está asignado a ${deliveryName} desde el ${fechaAsignacion}`, { duration: 6000 });
        setPendingQrId(null);
        setAutoAssignProcessing(false);
        return;
      }

      // ── ROL DELIVERY: asignar automáticamente ──────────────────────────
      if (role === 'DELIVERY') {
        const deliveryEmail = profile?.email || '';
        const deliveryName = profile?.name || deliveryEmail;

        // Doble verificación antes de asignar
        const { data: freshOrder } = await supabase
          .from('orders')
          .select('assigned_delivery, assigned_at')
          .eq('id', orderData.id)
          .single();

        if (freshOrder?.assigned_delivery && freshOrder.assigned_delivery !== deliveryEmail) {
          const otherDeliveryName = await getDeliveryName(freshOrder.assigned_delivery);
          const fechaAsignacion = formatAssignedDate(freshOrder.assigned_at);
          toast.error(`❌ El pedido ${displayId} está asignado a ${otherDeliveryName} desde el ${fechaAsignacion}`, { duration: 6000 });
          setPendingQrId(null);
          setAutoAssignProcessing(false);
          return;
        }

        const { error } = await supabase
          .from('orders')
          .update({
            assigned_delivery: deliveryEmail,
            assigned_at: new Date().toISOString(),
            status: 'EN RUTA',
          })
          .eq('id', orderData.id);

        if (error) {
          toast.error('❌ Error al asignar: ' + error.message);
        } else {
          toast.success(`✅ Pedido ${displayId} asignado correctamente a ${deliveryName}`);
          load();
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        }

        setPendingQrId(null);
        setAutoAssignProcessing(false);
      }
      // ── ROL ADMIN / PROVEEDOR: seleccionar el pedido ───────────────────
      else if (role === 'ADMIN' || role === 'PROVEEDOR') {
        if (orderData.assigned_delivery) {
          const deliveryName = await getDeliveryName(orderData.assigned_delivery);
          toast.warning(`⚠️ El pedido ${displayId} ya está asignado a ${deliveryName}. No se puede seleccionar.`);
        } else {
          toast.info(`📦 Pedido ${displayId} está libre para asignar`);
          setSelected(prev => {
            const next = new Set(prev);
            if (next.has(orderData.id)) {
              next.delete(orderData.id);
              toast.info(`📦 Pedido ${displayId} deseleccionado`);
            } else {
              next.add(orderData.id);
              toast.success(`✅ Pedido ${displayId} seleccionado`);
            }
            return next;
          });

          setIdsInput(prev => {
            const currentIds = prev.split(/[,\s\n]+/).filter(i => i.trim());
            if (!currentIds.includes(displayId)) {
              return prev.trim() ? prev + ', ' + displayId : displayId;
            }
            return prev;
          });
        }

        setPendingQrId(null);
        setAutoAssignProcessing(false);
      }
    };

    selectOrder();
  }, [pendingQrId, role, profile?.email, profile?.name]);

  useEffect(() => {
    if (role === 'ADMIN' || role === 'PROVEEDOR') {
      supabase.from('profiles').select('email, name').then(({ data }) => setDeliveries(data || []));
    }
  }, [role]);

  const load = async () => {
    let query = supabase.from('orders').select('*')
      .gte(filterBy, pyStart(dateFrom))
      .lte(filterBy, pyEnd(dateTo))
      .order(filterBy, { ascending: false }).limit(500);

    if (role === 'DELIVERY') {
      query = query.or(`assigned_delivery.is.null,assigned_delivery.eq.${profile?.email}`);
    }

    const { data } = await query;

    // Enriquecer los pedidos con los nombres de los deliveries asignados
    if (data && data.length > 0) {
      const emails = [...new Set(data.map(o => o.assigned_delivery).filter(Boolean))];
      const deliveryNamesMap: Record<string, string> = {};

      for (const email of emails) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('name')
          .eq('email', email)
          .single();
        deliveryNamesMap[email] = profileData?.name || email;
      }

      const enrichedData = data.map(order => ({
        ...order,
        assigned_delivery_name: order.assigned_delivery ? deliveryNamesMap[order.assigned_delivery] : null,
      }));
      setOrders(enrichedData);
    } else {
      setOrders(data || []);
    }
  };

  useEffect(() => { load(); }, [filterBy, dateFrom, dateTo]);

  const filtered = orders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (o.customer_name || '').toLowerCase().includes(q) ||
      (o.order_number || '').toLowerCase().includes(q) ||
      (o.city || '').toLowerCase().includes(q) ||
      (o.phone || '').includes(q) ||
      (o.id || '').toLowerCase().includes(q);
  });

  const toggleSelect = async (id: string) => {
    const order = orders.find(o => o.id === id);
    if (order && order.assigned_delivery && order.assigned_delivery !== profile?.email) {
      const deliveryName = order.assigned_delivery_name || await getDeliveryName(order.assigned_delivery);
      toast.error(`❌ No puedes seleccionar este pedido porque pertenece a ${deliveryName}`);
      return;
    }

    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const selectableOrders = filtered.filter(o => {
      if (role === 'DELIVERY') {
        return !o.assigned_delivery || o.assigned_delivery === profile?.email;
      }
      return true;
    });

    if (selected.size === selectableOrders.length && selectableOrders.length > 0) {
      setSelected(new Set());
    } else {
      const allIds = selectableOrders.map(o => o.id);
      setSelected(new Set(allIds));
      if (role === 'DELIVERY' && selectableOrders.length < filtered.length) {
        const assignedCount = filtered.length - selectableOrders.length;
        toast.info(`Se seleccionaron ${selectableOrders.length} pedidos disponibles (${assignedCount} ya pertenecen a otros deliveries)`);
      }
    }
  };

  const assignSelected = async () => {
    if (selected.size === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    let deliveryEmail = '';
    let deliveryName = '';

    if (role === 'DELIVERY') {
      deliveryEmail = profile?.email || '';
      deliveryName = profile?.name || deliveryEmail;
    } else if ((role === 'ADMIN' || role === 'PROVEEDOR') && assignDelivery) {
      deliveryEmail = assignDelivery;
      const selectedDelivery = deliveries.find(d => d.email === assignDelivery);
      deliveryName = selectedDelivery?.name || assignDelivery;
    }

    if (!deliveryEmail) {
      toast.error('Seleccioná un delivery primero');
      return;
    }

    const loadingToast = toast.loading(`Verificando ${selected.size} pedido(s)...`);

    let successCount = 0;
    let errorCount = 0;
    let alreadyAssignedCount = 0;
    const alreadyAssignedDetails: string[] = [];

    for (const id of selected) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('assigned_delivery, assigned_at, order_number')
        .eq('id', id)
        .single();

      if (orderData?.assigned_delivery && orderData.assigned_delivery !== deliveryEmail) {
        const otherDeliveryName = await getDeliveryName(orderData.assigned_delivery);
        const fechaAsignacion = formatAssignedDate(orderData.assigned_at);
        const displayId = orderData.order_number || id.substring(0, 8);
        alreadyAssignedDetails.push(`${displayId} → ${otherDeliveryName} (${fechaAsignacion})`);
        alreadyAssignedCount++;
        continue;
      }

      const { error } = await supabase
        .from('orders')
        .update({
          assigned_delivery: deliveryEmail,
          assigned_at: new Date().toISOString(),
          status: 'EN RUTA',
        })
        .eq('id', id);

      if (error) {
        errorCount++;
        console.error(`Error asignando pedido ${id}:`, error);
      } else {
        successCount++;
      }
    }

    toast.dismiss(loadingToast);

    if (successCount > 0) {
      toast.success(`✅ ${successCount} pedido(s) asignado(s) a ${deliveryName}`);
    }
    if (alreadyAssignedCount > 0) {
      const detailsMessage = alreadyAssignedDetails.slice(0, 3).join(', ');
      const moreCount = alreadyAssignedCount > 3 ? ` y ${alreadyAssignedCount - 3} más` : '';
      toast.warning(`⚠️ ${alreadyAssignedCount} pedido(s) ya pertenecen a otros deliveries: ${detailsMessage}${moreCount}`);
    }
    if (errorCount > 0) {
      toast.error(`❌ Error en ${errorCount} pedido(s)`);
    }

    setSelected(new Set());
    setIdsInput('');
    load();
  };

  const assignByIds = async () => {
    let deliveryEmail = '';
    let deliveryName = '';

    if (role === 'DELIVERY') {
      deliveryEmail = profile?.email || '';
      deliveryName = profile?.name || deliveryEmail;
    } else if ((role === 'ADMIN' || role === 'PROVEEDOR') && assignDelivery) {
      deliveryEmail = assignDelivery;
      const selectedDelivery = deliveries.find(d => d.email === assignDelivery);
      deliveryName = selectedDelivery?.name || assignDelivery;
    }

    if (!deliveryEmail) {
      toast.error('Seleccioná un delivery primero');
      return;
    }

    const ids = idsInput.split(/[,\s\n]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (ids.length === 0) {
      toast.error('Ingresá al menos un ID');
      return;
    }

    if (ids.length > 35) {
      toast.error('Máximo 35 IDs por carga');
      return;
    }

    const loadingToast = toast.loading(`Procesando ${ids.length} ID(s)...`);
    let count = 0;
    let notFound = 0;
    let alreadyAssigned = 0;
    const alreadyAssignedDetails: string[] = [];

    for (const id of ids) {
      const { data } = await supabase
        .from('orders')
        .select('id, assigned_delivery, assigned_at, order_number')
        .eq('order_number', id)
        .limit(1);

      if (data && data[0]) {
        if (data[0].assigned_delivery && data[0].assigned_delivery !== deliveryEmail) {
          const otherDeliveryName = await getDeliveryName(data[0].assigned_delivery);
          const fechaAsignacion = formatAssignedDate(data[0].assigned_at);
          alreadyAssignedDetails.push(`${id} → ${otherDeliveryName} (${fechaAsignacion})`);
          alreadyAssigned++;
          continue;
        }

        const { error } = await supabase
          .from('orders')
          .update({
            assigned_delivery: deliveryEmail,
            assigned_at: new Date().toISOString(),
            status: 'EN RUTA',
          })
          .eq('id', data[0].id);

        if (!error) {
          count++;
        }
      } else {
        notFound++;
      }
    }

    toast.dismiss(loadingToast);

    if (count > 0) {
      toast.success(`✅ ${count} pedido(s) asignado(s) a ${deliveryName}`);
    }
    if (alreadyAssigned > 0) {
      const detailsMessage = alreadyAssignedDetails.slice(0, 3).join(', ');
      const moreCount = alreadyAssigned > 3 ? ` y ${alreadyAssigned - 3} más` : '';
      toast.warning(`⚠️ ${alreadyAssigned} pedido(s) ya pertenecen a otros deliveries: ${detailsMessage}${moreCount}`);
    }
    if (notFound > 0) {
      toast.warning(`❓ ${notFound} ID(s) no encontrados`);
    }

    setIdsInput('');
    load();
  };

  const assignSingle = async (orderId: string, deliveryEmail: string) => {
    if (!deliveryEmail) {
      toast.error('Seleccioná un delivery');
      return;
    }

    const deliveryName = deliveries.find(d => d.email === deliveryEmail)?.name || deliveryEmail;
    const order = orders.find(o => o.id === orderId);
    const displayId = order?.order_number || orderId.substring(0, 8);

    const { data: orderData } = await supabase
      .from('orders')
      .select('assigned_delivery, assigned_at')
      .eq('id', orderId)
      .single();

    if (orderData?.assigned_delivery && orderData.assigned_delivery !== deliveryEmail) {
      const otherDeliveryName = await getDeliveryName(orderData.assigned_delivery);
      const fechaAsignacion = formatAssignedDate(orderData.assigned_at);
      toast.error(`❌ El pedido ${displayId} está asignado a ${otherDeliveryName} desde el ${fechaAsignacion}`, { duration: 6000 });
      return;
    }

    const { error } = await supabase
      .from('orders')
      .update({
        assigned_delivery: deliveryEmail,
        assigned_at: new Date().toISOString(),
        status: 'EN RUTA',
      })
      .eq('id', orderId);

    if (error) {
      toast.error('Error al asignar delivery');
      console.error(error);
    } else {
      toast.success(`✅ Pedido ${displayId} asignado correctamente a ${deliveryName}`);
      load();
    }
  };

  const clearSelection = () => {
    setSelected(new Set());
    toast.info('Selección limpiada');
  };

  const clearIdsInput = () => {
    setIdsInput('');
    toast.info('Lista de IDs limpiada');
  };

  const selectedCount = selected.size;
  const idsCount = idsInput.split(/[,\s\n]+/).filter(i => i.trim()).length;

  const selectableOrdersCount = filtered.filter(o => {
    if (role === 'DELIVERY') {
      return !o.assigned_delivery || o.assigned_delivery === profile?.email;
    }
    return true;
  }).length;

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">Asignar Pedidos</h3>

      {autoAssignProcessing && (
        <div className="mb-3 p-2 bg-blue-100 text-blue-800 rounded-lg text-sm text-center">
          ⏳ Procesando QR...
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <label className="app-label !mt-0">Desde</label>
        <input type="date" className="app-input !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <label className="app-label !mt-0">Hasta</label>
        <input type="date" className="app-input !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />

        <select className="app-input !w-auto" value={filterBy} onChange={e => setFilterBy(e.target.value as any)}>
          <option value="created_at">📅 Fecha de venta</option>
          <option value="assigned_at">🚚 Fecha de asignación</option>
        </select>

        <input className="app-input flex-1 min-w-[200px]" placeholder="🔎 Buscar cliente, ID, ciudad, teléfono..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className="nav-btn active" onClick={load}>Filtrar</button>
      </div>

      {(role === 'ADMIN' || role === 'PROVEEDOR') && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <span className="text-sm font-bold text-green-600 mr-2">
            ✅ {selectedCount} pedido(s) seleccionado(s)
          </span>
          <select className="app-input !w-auto min-w-[200px]" value={assignDelivery} onChange={e => setAssignDelivery(e.target.value)}>
            <option value="">Seleccionar delivery...</option>
            {deliveries.map(d => <option key={d.email} value={d.email}>{d.name || d.email}</option>)}
          </select>
          <button
            className="nav-btn active"
            onClick={assignSelected}
            disabled={selectedCount === 0 || !assignDelivery}
            style={{ background: '#10b981', color: 'white' }}
          >
            📦 Asignar seleccionados ({selectedCount})
          </button>
          {selectedCount > 0 && (
            <button className="nav-btn !bg-gray-500" onClick={clearSelection}>
              ✖ Limpiar
            </button>
          )}
        </div>
      )}

      {role === 'DELIVERY' && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <span className="text-sm font-bold text-green-600 mr-2">
            ✅ {selectedCount} de {selectableOrdersCount} disponible(s) seleccionado(s)
          </span>
          {selectedCount > 0 && (
            <>
              <button
                className="nav-btn active bg-green-600 hover:bg-green-700"
                onClick={assignSelected}
              >
                ✅ Asignarme estos {selectedCount} pedido(s)
              </button>
              <button className="nav-btn !bg-gray-500" onClick={clearSelection}>
                ✖ Limpiar selección
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-auto">
        <table className="app-table">
          <thead>
            <tr>
              {(role === 'ADMIN' || role === 'PROVEEDOR' || role === 'DELIVERY') && (
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedCount === selectableOrdersCount && selectableOrdersCount > 0}
                    onChange={handleSelectAll}
                    className="accent-brand"
                    disabled={selectableOrdersCount === 0}
                  />
                </th>
              )}
              <th>{filterBy === 'created_at' ? 'Fecha venta' : 'Fecha asignación'}</th>
              <th>ID</th>
              <th>Ciudad</th>
              <th>Cliente</th>
              <th>Teléfono</th>
              <th>Estado</th>
              <th>Asignado a</th>
              {(role === 'ADMIN' || role === 'PROVEEDOR') && <th>Acción</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const isAssignedToOther = o.assigned_delivery && o.assigned_delivery !== profile?.email;
              const assignedToName = o.assigned_delivery_name || o.assigned_delivery;
              const isSelectable = !isAssignedToOther;

              return (
                <tr key={o.id} className={`${selected.has(o.id) ? 'bg-green-100' : ''} ${isAssignedToOther ? 'opacity-60 bg-gray-100' : ''}`}>
                  {(role === 'ADMIN' || role === 'PROVEEDOR' || role === 'DELIVERY') && (
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                        className="accent-brand"
                        disabled={!isSelectable}
                        title={!isSelectable ? `Pedido pertenece a ${assignedToName}` : ''}
                      />
                    </td>
                  )}
                  <td className="text-xs whitespace-nowrap">
                    {filterBy === 'created_at'
                      ? new Date(o.created_at).toLocaleDateString('es-PY')
                      : o.assigned_at
                        ? new Date(o.assigned_at).toLocaleDateString('es-PY')
                        : '—'}
                  </td>
                  <td className="text-xs font-bold">{o.order_number || o.id.slice(0, 8)}</td>
                  <td className="text-xs">{o.city || '—'}</td>
                  <td className="text-xs">{o.customer_name || '—'}</td>
                  <td className="text-xs">{o.phone || '—'}</td>
                  <td className="text-xs">
                    <span className={`badge-status ${o.status === 'ENTREGADO' ? 'badge-entregado' : o.status === 'CANCELADO' ? 'badge-cancelado' : 'badge-pendiente'}`}>
                      {o.status || 'PENDIENTE'}
                    </span>
                  </td>
                  <td className="text-xs">
                    {o.assigned_delivery === profile?.email ? (
                      <span className="text-green-600 font-bold">✓ Vos</span>
                    ) : o.assigned_delivery ? (
                      <span className="text-orange-600 font-bold" title={`Asignado a: ${assignedToName}`}>
                        👤 {assignedToName}
                      </span>
                    ) : (
                      <span className="text-gray-400">— Libre —</span>
                    )}
                  </td>
                  {(role === 'ADMIN' || role === 'PROVEEDOR') && (
                    <td className="text-xs">
                      <select
                        className="app-input !w-auto !py-1 !px-2 text-xs"
                        value={o.assigned_delivery || ''}
                        onChange={(e) => assignSingle(o.id, e.target.value)}
                      >
                        <option value="">Sin asignar</option>
                        {deliveries.map((d) => (
                          <option key={d.email} value={d.email}>
                            {d.name || d.email} {o.assigned_delivery === d.email ? '✓' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={role === 'ADMIN' || role === 'PROVEEDOR' ? 9 : 8} className="text-center text-muted-foreground py-8">
                  {role === 'DELIVERY' ? 'No hay pedidos disponibles para asignarte' : 'Sin pedidos en este rango de fechas'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {role === 'DELIVERY' && selectedCount > 0 && (
        <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-sm font-bold text-green-800">✅ {selectedCount} pedido(s) seleccionado(s)</span>
              <p className="text-xs text-green-600 mt-1">Se asignarán automáticamente a tu cuenta</p>
            </div>
            <button
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700"
              onClick={assignSelected}
            >
              Asignarme todo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
