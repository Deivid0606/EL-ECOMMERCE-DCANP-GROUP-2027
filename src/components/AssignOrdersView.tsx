import { useState, useEffect, useMemo } from 'react';
import { orderProviderEmails, useProviderScope } from '@/lib/providerScope';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyFirstOfMonth, pyToday, pyStart, pyEnd } from '@/lib/pyTime';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

export default function AssignOrdersView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const { isAdmin, favorites, active, wantActive, setActive, toggleFavorite, orderInScope } = useProviderScope();
  const [orders, setOrders] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignDelivery, setAssignDelivery] = useState('');
  const [search, setSearch] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [providerSearch, setProviderSearch] = useState('');
  const [providersOpen, setProvidersOpen] = useState(false);
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState(() => pyFirstOfMonth());
  const [dateTo, setDateTo] = useState(() => pyToday());
  const [idsInput, setIdsInput] = useState('');
  const [filterBy, setFilterBy] = useState<'created_at' | 'assigned_at'>('created_at');
  const [autoAssignProcessing, setAutoAssignProcessing] = useState(false);
  // Delivery: proveedores que el admin le habilitó (vacío = ve todos, como antes).
  const [allowedProviders, setAllowedProviders] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);

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
          .select('id, assigned_delivery, assigned_at, order_number, customer_name')
          .eq('id', pendingQrId)
          .maybeSingle();
        orderData = result.data;
        findError = result.error;
      } else {
        console.log('🔍 Buscando por order_number...');
        const result = await supabase
          .from('orders')
          .select('id, assigned_delivery, assigned_at, order_number, customer_name')
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
    if (role !== 'DELIVERY' || !profile?.email) return;
    (supabase as any)
      .from('delivery_providers')
      .select('provider_email')
      .then(({ data }: any) => setAllowedProviders((data || []).map((r: any) => String(r.provider_email || '').toLowerCase())));
  }, [role, profile?.email]);

  useEffect(() => {
    if (role === 'ADMIN' || role === 'PROVEEDOR') {
      supabase.from('profiles').select('email, name').eq('approved', true).then(({ data }) => setDeliveries(data || []));
    }
  }, [role]);

  const load = async () => {
    // Esta pantalla no solicita teléfonos ni datos de contacto innecesarios.
    let query = supabase.from('orders').select('id, order_number, created_at, assigned_at, customer_name, city, status, assigned_delivery, provider_email, provider_emails_list, supplier_email, items_json')
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

      // Una consulta para todos los deliveries, en vez de una por cada email.
      if (emails.length) {
        const { data: deliveryProfiles, error: profilesError } = await supabase
          .from('profiles')
          .select('email, name')
          .in('email', emails);
        if (profilesError) console.warn('No se pudieron cargar nombres de deliveries:', profilesError);
        (deliveryProfiles || []).forEach(p => {
          if (p.email) deliveryNamesMap[p.email] = p.name || p.email;
        });
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

  // Combina proveedores de los pedidos de este período con los favoritos guardados.
  const providerEmails = useMemo(() => {
    const emails = new Set<string>([...favorites, ...Object.keys(providerNames)]);
    orders.forEach(o => orderProviderEmails(o).forEach(email => emails.add(email)));
    return [...emails].filter(Boolean).sort((a, b) =>
      (providerNames[a] || a).localeCompare(providerNames[b] || b, 'es')
    );
  }, [orders, favorites, providerNames]);

  useEffect(() => {
    if (!isAdmin && role !== 'PROVEEDOR') return;
    let canceled = false;
    void (async () => {
      const { data, error } = await supabase.from('profiles')
        .select('email, name').eq('role', 'PROVEEDOR').eq('approved', true);
      if (error || canceled) return;
      const names: Record<string, string> = {};
      (data || []).forEach((p: any) => {
        const email = String(p.email || '').trim().toLowerCase();
        if (email) names[email] = String(p.name || p.email);
      });
      setProviderNames(names);
    })();
    return () => { canceled = true; };
  }, [isAdmin, role]);

  const filteredProviders = providerEmails.filter(email => {
    const q = providerSearch.trim().toLowerCase();
    return !q || email.includes(q) || (providerNames[email] || '').toLowerCase().includes(q);
  });

  const baseFiltered = orders.filter(o => {
    if (isAdmin && !orderInScope(o)) return false;
    const emails = orderProviderEmails(o);
    // Delivery con proveedores habilitados: sólo ve pedidos libres de esos proveedores (los suyos siempre).
    if (role === 'DELIVERY' && allowedProviders.length && !o.assigned_delivery && !emails.some(e => allowedProviders.includes(e))) return false;
    if (selectedProviders.size && !emails.some(email => selectedProviders.has(email))) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (o.customer_name || '').toLowerCase().includes(q) ||
      (o.order_number || '').toLowerCase().includes(q) ||
      (o.city || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q);
  });

  // 📦 Pedidos libres para tomar, por ciudad y producto.
  const isAvailable = (o: any) => !o.assigned_delivery && ['', 'PENDIENTE', 'REAGENDADO'].includes(String(o.status || '').toUpperCase());
  const itemsOf = (o: any): { name: string; qty: number }[] => {
    try {
      const raw = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : o.items_json;
      return (Array.isArray(raw) ? raw : []).map((it: any) => ({
        name: String(it?.title || it?.name || it?.sku || 'Producto').trim(),
        qty: Number(it?.qty || it?.quantity || 1) || 1,
      }));
    } catch {
      return [];
    }
  };
  const cityLabel = (o: any) => String(o.city || 'Sin ciudad').trim() || 'Sin ciudad';
  const availableSummary = useMemo(() => {
    const byCity = new Map<string, { orders: number; products: Map<string, number> }>();
    for (const o of baseFiltered) {
      if (!isAvailable(o)) continue;
      const c = cityLabel(o);
      const entry = byCity.get(c) || { orders: 0, products: new Map<string, number>() };
      entry.orders++;
      for (const it of itemsOf(o)) entry.products.set(it.name, (entry.products.get(it.name) || 0) + it.qty);
      byCity.set(c, entry);
    }
    return [...byCity.entries()]
      .map(([city, v]) => ({ city, orders: v.orders, products: [...v.products.entries()].sort((a, b) => b[1] - a[1]) }))
      .sort((a, b) => b.orders - a.orders);
  }, [baseFiltered]);
  const availableTotal = availableSummary.reduce((s, c) => s + c.orders, 0);
  const availableUnits = availableSummary.reduce((s, c) => s + c.products.reduce((t, [, q]) => t + q, 0), 0);

  const filtered = baseFiltered.filter(o => {
    if (cityFilter && cityLabel(o) !== cityFilter) return false;
    if (productFilter && !itemsOf(o).some(it => it.name === productFilter)) return false;
    return true;
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

        <input className="app-input flex-1 min-w-[200px]" placeholder="🔎 Buscar cliente, ID o ciudad..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className="nav-btn active" onClick={load}>Filtrar</button>
      </div>

      <div className="mb-3 rounded-xl border border-border bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-sm">⭐ Proveedores</span>
          <button type="button" className="nav-btn !px-3 !py-1 !text-xs"
            onClick={() => setProvidersOpen(open => !open)}>
            {providersOpen ? 'Cerrar' : 'Filtrar proveedores'}{selectedProviders.size ? ` (${selectedProviders.size})` : ''}
          </button>
          {selectedProviders.size > 0 && (
            <button type="button" className="nav-btn !px-3 !py-1 !text-xs"
              onClick={() => setSelectedProviders(new Set())}>Limpiar filtro</button>
          )}
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <button type="button" className={`rounded-lg px-2 py-1 font-bold ${wantActive ? 'bg-amber-500 text-black' : 'bg-secondary'}`}
                onClick={() => setActive(true)}>⭐ Solo favoritos ({favorites.length})</button>
              <button type="button" className={`rounded-lg px-2 py-1 font-bold ${!wantActive ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}
                onClick={() => setActive(false)}>Todos</button>
            </div>
          )}
        </div>
        {isAdmin && active && <p className="mt-1 text-xs text-amber-500">Filtro de favoritos activo. Se comparte con las demás pestañas.</p>}
        {providersOpen && (
          <div className="mt-3 space-y-2">
            <input className="app-input w-full" placeholder="🔎 Buscar proveedor por nombre o email…"
              value={providerSearch} onChange={e => setProviderSearch(e.target.value)} />
            <div className="grid max-h-60 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {filteredProviders.map(email => {
                const checked = selectedProviders.has(email);
                const fav = favorites.includes(email);
                return (
                  <div key={email} className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2 py-2 text-sm">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={checked} onChange={() => setSelectedProviders(prev => {
                        const next = new Set(prev);
                        if (next.has(email)) next.delete(email);
                        else next.add(email);
                        return next;
                      })} />
                      <span className="min-w-0 truncate" title={email}>{providerNames[email] || email}</span>
                    </label>
                    {isAdmin && <button type="button" aria-label={fav ? `Quitar favorito ${email}` : `Marcar favorito ${email}`}
                      title={fav ? 'Quitar favorito' : 'Marcar favorito'} className="text-lg"
                      onClick={() => void toggleFavorite(email)}>{fav ? '⭐' : '☆'}</button>}
                  </div>
                );
              })}
              {!filteredProviders.length && <div className="text-xs text-muted-foreground p-2">No se encontraron proveedores.</div>}
            </div>
          </div>
        )}
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

      {availableTotal > 0 && (
        <section className="relative mb-4 overflow-hidden rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/15 via-slate-900/60 to-violet-500/15 p-4 shadow-2xl md:p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/80">Pedidos disponibles para tomar</div>
              <div className="mt-1 text-4xl font-black leading-none text-white md:text-5xl">{availableTotal}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                <span className="rounded-full border border-white/10 bg-slate-950/50 px-2.5 py-1 text-slate-300">📍 {availableSummary.length} ciudad(es)</span>
                <span className="rounded-full border border-white/10 bg-slate-950/50 px-2.5 py-1 text-slate-300">📦 {availableUnits} unidad(es)</span>
                {role === 'DELIVERY' && allowedProviders.length > 0 && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">🏢 {allowedProviders.length} proveedor(es) habilitado(s)</span>
                )}
              </div>
            </div>
            <button type="button" className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-bold text-slate-200" onClick={() => setSummaryOpen(v => !v)}>
              {summaryOpen ? '▾ Ocultar' : '▸ Ver por ciudad'}
            </button>
          </div>

          {summaryOpen && (
            <>
              {(cityFilter || productFilter) && (
                <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-400">Filtrando la lista por:</span>
                  <span className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 font-bold text-cyan-200">
                    {[cityFilter && `📍 ${cityFilter}`, productFilter && `📦 ${productFilter}`].filter(Boolean).join('  ·  ')}
                  </span>
                  <button type="button" className="rounded-full border border-white/10 bg-slate-950/60 px-2.5 py-1 font-bold text-slate-200" onClick={() => { setCityFilter(''); setProductFilter(''); }}>
                    ✖ Quitar
                  </button>
                </div>
              )}
              <div className="relative mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {availableSummary.map(c => {
                  const activeCity = cityFilter === c.city;
                  const pct = Math.round((c.orders / Math.max(1, availableSummary[0]?.orders || 1)) * 100);
                  return (
                    <div
                      key={c.city}
                      className={`rounded-2xl border p-3 transition ${activeCity ? 'border-cyan-400/70 bg-cyan-500/15 shadow-lg shadow-cyan-500/10' : 'border-white/10 bg-slate-950/50 hover:border-white/25'}`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => { setCityFilter(activeCity ? '' : c.city); setProductFilter(''); }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-extrabold text-white">📍 {c.city}</span>
                          <span className="shrink-0 rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs font-black text-cyan-200">{c.orders} pedido{c.orders === 1 ? '' : 's'}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {c.products.map(([name, qty]) => {
                          const activeProduct = activeCity && productFilter === name;
                          return (
                            <button
                              type="button"
                              key={name}
                              title={name}
                              className={`max-w-full rounded-lg border px-2 py-1 text-[11px] font-semibold ${activeProduct ? 'border-violet-400/70 bg-violet-500/25 text-white' : 'border-white/10 bg-slate-900/70 text-slate-300 hover:border-white/25'}`}
                              onClick={() => { setCityFilter(c.city); setProductFilter(activeProduct ? '' : name); }}
                            >
                              <span className="inline-block max-w-[11rem] truncate align-bottom">{name}</span>
                              <b className="ml-1 text-violet-300">×{qty}</b>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="relative mt-3 text-[11px] text-slate-400">Según las fechas elegidas arriba. Tocá una ciudad o un producto para filtrar la lista de abajo.</p>
            </>
          )}
        </section>
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
                <td colSpan={role === 'ADMIN' || role === 'PROVEEDOR' ? 8 : 7} className="text-center text-muted-foreground py-8">
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
