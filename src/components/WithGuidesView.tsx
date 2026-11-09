import { useState, useEffect, useMemo, useRef } from 'react';
import { useProviderScope } from '@/lib/providerScope';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyToday, pyStart, pyEnd } from '@/lib/pyTime';
import { useOrderEditTools } from '@/components/OrderEditTools';
import { dayLabel, nextBusinessDay } from '@/components/RescheduleDialog';

declare global {
  interface Window {
    QRCode: any;
  }
}

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

const todayISO = () => pyToday();

const normalizeClientName = (value: any): string => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Celular comparable: sólo dígitos, sin 595 / 0 inicial (0981 123 456 = +595 981123456).
const normalizePhone = (value: any): string => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('595')) digits = digits.slice(3);
  digits = digits.replace(/^0+/, '');
  return digits.length >= 6 ? digits.slice(-9) : '';
};

// Mismo cliente = mismo nombre y apellido (sin acentos, mayúsculas ni signos) + mismo celular.
const clientKey = (name: any, phone: any): string => {
  const n = normalizeClientName(name).replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();
  const p = normalizePhone(phone);
  return n && p ? `${n}|${p}` : '';
};

const displayClientName = (value: any): string => {
  return String(value || '').replace(/\s+/g, ' ').trim() || 'SIN NOMBRE';
};

type StockProduct = { id: string; sku: string | null; title: string | null; stock: number | null; real_stock: number | null; provider_email: string | null; created_at: string; image_url?: string | null };
type StockLedgerRow = { order_id: string; qty_delivery: number; qty_global: number };

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

// Igual que order_item_product() en la base de datos: id, SKU o (si el SKU cambió) el nombre exacto,
// desempatando por proveedor y título.
const findItemProduct = (item: any, products: StockProduct[]) => {
  const id = String(item?.product_id || item?.id || '');
  const sku = lc(item?.sku);
  const title = lc(item?.title);
  const candidates = products.filter(p => (id && p.id === id) || (sku && lc(p.sku) === sku) || (title && lc(p.title) === title));
  const score = (p: StockProduct) =>
    (id && p.id === id ? 16 : 0) +
    (sku && lc(p.sku) === sku ? 8 : 0) +
    (lc(p.provider_email) === lc(item?.provider_email) ? 2 : 0) +
    (lc(p.title) === title ? 1 : 0);
  return candidates.sort((a, b) => score(b) - score(a) || a.created_at.localeCompare(b.created_at))[0];
};

const getOrderItems = (order: any): any[] => {
  try {
    if (Array.isArray(order?.items_json)) return order.items_json;
    if (typeof order?.items_json === 'string') {
      const parsed = JSON.parse(order.items_json || '[]');
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch {
    return [];
  }
};

const normalizeProductKey = (value: any): string => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const getProductEntries = (order: any): { name: string; qty: number; key: string }[] => {
  return getOrderItems(order)
    .map((item: any) => {
      const name = String(item?.title || item?.sku || 'Item').replace(/\s+/g, ' ').trim();
      const rawQty = Number(item?.qty ?? item?.quantity ?? 1);
      const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      return {
        name,
        qty,
        // La clave es SOLO el producto. La cantidad no crea otra opción en el filtro.
        key: normalizeProductKey(name),
      };
    })
    .filter((item: any) => Boolean(item.name && item.key));
};

const getProductNames = (order: any): string[] => {
  return getProductEntries(order).map(item => item.name);
};

const panelCls = "rounded-3xl border border-slate-700/70 bg-[#0b1020]/95 shadow-[0_24px_80px_rgba(0,0,0,.35)] p-4 md:p-6 text-white";
const cardCls = "rounded-2xl border border-slate-700/70 bg-[#101827]/90 shadow-xl";
const kpiBaseCls = "relative overflow-hidden rounded-2xl border p-4 min-h-[96px] shadow-lg";
const pillInputCls = "bg-[#070b18] border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20";
const proBtnCls = "rounded-xl px-4 py-2 text-sm font-black text-white transition hover:scale-[1.02] active:scale-[.98] shadow-lg";


export default function WithGuidesView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const myEmail = profile?.email || '';
  const { orderInScope, productInScope, active: favoritesActive, setActive: setFavoritesActive } = useProviderScope();
const [ordersRaw, setOrders] = useState<any[]>([]);
  const orders = useMemo(() => ordersRaw.filter(orderInScope), [ordersRaw, orderInScope]);
  const [search, setSearch] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [providerSearch, setProviderSearch] = useState('');
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [guideText, setGuideText] = useState('');
  const [guideId, setGuideId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deliveryOptions, setDeliveryOptions] = useState<{user_id:string;email:string;name:string}[]>([]);
  const [assignedDeliveryNames, setAssignedDeliveryNames] = useState<Record<string, string>>({});
  const [deliveryQuery, setDeliveryQuery] = useState('');
  const [targetDelivery, setTargetDelivery] = useState('');
  const [assigningBulk, setAssigningBulk] = useState(false);
  const canAssignFromGuides = role === 'ADMIN' || role === 'PROVEEDOR';

  // STOCK: productos, stock por delivery y descuentos vigentes por pedido.
  const [stockProducts, setStockProducts] = useState<StockProduct[]>([]);
  const [deliveryStock, setDeliveryStock] = useState<Map<string, number>>(new Map());
  const [stockLedger, setStockLedger] = useState<Map<string, StockLedgerRow[]>>(new Map());
  // Guías generadas hoy (para «Stock del día»): producto → { unidades, pedidos }.
  const [guidesToday, setGuidesToday] = useState<any[]>([]);
  const [showStockDay, setShowStockDay] = useState(false);

  const [loading, setLoading] = useState(false);
  const [guidesTodayCount, setGuidesTodayCount] = useState(0);
  const [deliveredTodayCount, setDeliveredTodayCount] = useState(0);
  
  // FILTROS EXISTENTES
  const [status2Filter, setStatus2Filter] = useState<string>('PENDIENTES');
  const [shownRows, setShownRows] = useState(120);
  const [ordersViewMode, setOrdersViewMode] = useState<'cards' | 'table'>('table');
  const [showHistorical, setShowHistorical] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());
  const [citySearch, setCitySearch] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false);

  // FILTRO POR PRODUCTOS
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // FILTRO POR DEPARTAMENTOS
  const [selectedDepartments, setSelectedDepartments] = useState<Set<string>>(new Set());
  const [deptSearch, setDeptSearch] = useState('');
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);

  // Estado para el modal de guía con QR
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [qrLoaded, setQrLoaded] = useState(false);
  const qrDeliveryRef = useRef<HTMLDivElement>(null);

  // Mensajes aleatorios para WhatsApp
  const whatsappMessages = [
    "Buenas le escribo del área del delivery para entregarle su pedido, ¿me podría enviar su ubicación exacta por favor? Desde ya gracias.",
    "Hola, soy su repartidor. Para completar la entrega, necesito su ubicación exacta. Muchas gracias.",
    "¡Buen día! Su pedido está en camino. ¿Podría compartirme su ubicación exacta? Gracias.",
    "Atención: su delivery necesita su ubicación precisa para la entrega. ¿Me la envía por favor? Gracias.",
    "Hola, soy del servicio de delivery. Para entregarle su pedido correctamente, necesito su ubicación exacta. ¡Gracias!"
  ];

  // Cargar librería QR desde CDN
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.QRCode) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      script.async = true;
      script.onload = () => {
        setQrLoaded(true);
      };
      document.body.appendChild(script);
    } else if (window.QRCode) {
      setQrLoaded(true);
    }
  }, []);

  // Generar QR en el modal cuando se abre - MODIFICADO: usa order_number en lugar de id
  useEffect(() => {
    if (showGuideModal && currentOrder && qrLoaded) {
      if (qrDeliveryRef.current) qrDeliveryRef.current.innerHTML = '';
      
      // CAMBIO 1: Modal QR - usar order_number en lugar de id
      const orderNumber = currentOrder.order_number;
      
      if (orderNumber) {
        const cleanOrderNumber = String(orderNumber).trim();
        const deliveryUrl = window.location.origin + '/#/asignar-pedidos?id=' + encodeURIComponent(cleanOrderNumber);
        new window.QRCode(qrDeliveryRef.current, {
          text: deliveryUrl,
          width: 120,
          height: 120,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.L
        });
      } else {
        toast.error('Este pedido no tiene número de orden');
      }
    }
  }, [showGuideModal, currentOrder, qrLoaded]);

  useEffect(() => {
    if (!canAssignFromGuides) return;
    let canceled = false;
    const getDeliveryOptions = async () => {
      const {data:roleRows,error:roleError} = await supabase.from('user_roles')
        .select('user_id').eq('role','DELIVERY').eq('approved',true);
      if (roleError) { toast.error('No se pudieron cargar deliveries: '+roleError.message); return; }
      const ids = [...new Set((roleRows||[]).map((r:any)=>r.user_id))];
      if (!ids.length) { if(!canceled)setDeliveryOptions([]); return; }
      const {data,error} = await supabase.from('profiles').select('user_id,email,name').in('user_id',ids);
      if (error) { toast.error('No se pudieron cargar perfiles de deliveries: '+error.message); return; }
      if(!canceled)setDeliveryOptions((data||[]).filter((d:any)=>d.email));
    };
    void getDeliveryOptions();
    return ()=>{canceled=true};
  },[role]);

  const assignSelectedToDelivery = async () => {
    if(!canAssignFromGuides) return;
    const chosen = deliveryOptions.find(d=>d.email===targetDelivery);
    if(!chosen){toast.error('Elegí un delivery de la lista');return;}
    const selected = visibleOrders.filter(o=>selectedIds.has(o.id));
    if(!selected.length){toast.error('Seleccioná pedidos visibles primero');return;}
    const providerEmail=myEmail.trim().toLowerCase();
    const unauthorized = role==='PROVEEDOR' && selected.some(o=>{
      const emails=[
        ...String(o.provider_emails_list||'').toLowerCase().split(/[,;\s]+/),
        String(o.provider_email||'').toLowerCase(),
        String(o.supplier_email||'').toLowerCase(),
      ];
      return !emails.includes(providerEmail);
    });
    if(unauthorized){toast.error('Solo podés asignar pedidos de tu proveedor');return;}
    const assigned = selected.filter(o=>String(o.assigned_delivery||'').trim());
    if(assigned.length){toast.error(`${assigned.length} pedidos ya tienen delivery. Quitalos de la selección antes de asignar.`);return;}
    if(!confirm(`¿Asignar ${selected.length} pedidos sin delivery a ${chosen.name||chosen.email}? Esta acción es opcional y no genera guías.`))return;
    setAssigningBulk(true);
    try{
      let success=0;
      const errors:string[]=[];
      for(const o of selected){
        const {data,error}=await supabase.from('orders')
          .update({assigned_delivery:chosen.email,assigned_at:new Date().toISOString()})
          .eq('id',o.id)
          .is('assigned_delivery',null)
          .select('id');
        if(error)errors.push(`#${o.order_number||o.id}: ${error.message}`);
        else if(!data?.length) errors.push(`#${o.order_number||o.id}: ya asignado, sin permiso o cambió`);
        else success++;
      }
      if(success){
        toast.success(`${success} pedido(s) asignados a ${chosen.name||chosen.email}`);
        setSelectedIds(new Set());
        await load();
      }
      if(errors.length)toast.error(`${errors.length} pedidos no asignados. ${errors[0]}`);
    } finally {setAssigningBulk(false);}
  };

  const load = async () => {
    setLoading(true);
    setLoadError('');

    try {
      // Sin límite práctico de filas: trae los pedidos en páginas de 1.000
      // pedidas en paralelo.
      const { data: allRows, error } = await fetchAllRows('orders', (query) => {
        // A guide can be created today for an old order, so its creation
        // date must not hide it from today's dispatch results.
        let q = status2Filter === 'CON_GUIA'
          ? query.order('guide_generated_at', { ascending: false, nullsFirst: false })
          : query.order('created_at', { ascending: false });
        if (status2Filter === 'TODOS' && !showHistorical && !search.trim()) {
          q = q.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
        }
        if (search && search.trim()) q = q.ilike('order_number', `%${search.trim()}%`);
        if (status2Filter === 'PENDIENTES') {
          q = q.or('status2.is.null,status2.eq.--');
        } else if (status2Filter === 'CON_GUIA') {
          q = q.eq('status2', 'GUIA GENERADA');
          // Fetch only today's generated guides by default. Older ones are
          // accessible with the explicit historical switch.
          if (!showHistorical) {
            q = q.gte('guide_generated_at', pyStart(pyToday()))
              .lte('guide_generated_at', pyEnd(pyToday()));
          }
        }
        return q;
      });

      if (error) {
        setLoadError(error.message);
        toast.error(error.message);
        return;
      }

      // Despachante: sólo los proveedores que le asignó el admin (sin asignación = todos).
      let rows = allRows;
      if (role === 'DESPACHANTE') {
        const { data: mine } = await (supabase as any).rpc('my_dispatch_providers');
        const allowed: string[] = (mine || []).map((e: string) => String(e).toLowerCase());
        if (allowed.length) {
          rows = allRows.filter((o: any) => {
            const list = `${o.provider_email || ''},${o.provider_emails_list || ''}`.toLowerCase().split(/[,;\s]+/);
            return list.some((e: string) => e && allowed.includes(e));
          });
        }
      }
      setOrders(rows);
      void loadStock(rows);

      const today = todayISO();
      const [guidesTodayRes, deliveredTodayRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, provider_emails_list, provider_email, assigned_delivery')
          .eq('status2', 'GUIA GENERADA')
          .gte('guide_generated_at', pyStart(today))
          .lte('guide_generated_at', pyEnd(today)),
        supabase
          .from('orders')
          .select('id, provider_emails_list, provider_email, assigned_delivery')
          .in('status', ['ENTREGADO', 'ENCOMIENDA ENTREGADA'])
          .gte('delivered_at', pyStart(today))
          .lte('delivered_at', pyEnd(today)),
      ]);

      const roleFilter = (o: any) => {
        if (role === 'PROVEEDOR') {
          const providers = `${o.provider_emails_list || ''},${o.provider_email || ''}`
            .split(/[,;\s]+/).map((email: string) => email.trim().toLowerCase());
          return providers.includes(myEmail.trim().toLowerCase());
        }
        if (role === 'DELIVERY') return (o.assigned_delivery || '').toLowerCase() === myEmail.toLowerCase();
        if (role === 'VENDEDOR') return (o.created_by || '').toLowerCase() === myEmail.toLowerCase();
        return true;
      };

      setGuidesTodayCount((guidesTodayRes.data || []).filter(roleFilter).length);
      setDeliveredTodayCount((deliveredTodayRes.data || []).filter(roleFilter).length);
    } finally {
      setLoading(false);
    }
  };

  const loadStock = async (rows: any[]) => {
    const [productsRes, deliveryRes] = await Promise.all([
      supabase.from('products').select('id, sku, title, stock, real_stock, provider_email, created_at, image_url'),
      supabase.from('delivery_stock' as any).select('delivery_email, product_id, quantity'),
    ]);
    if (!productsRes.error) setStockProducts((productsRes.data || []) as StockProduct[]);
    if (!deliveryRes.error) {
      setDeliveryStock(new Map((deliveryRes.data || []).map((d: any) => [`${lc(d.delivery_email)}|${d.product_id}`, Number(d.quantity || 0)])));
    }

    // Descuentos vigentes sólo de los pedidos con guía (donde se usa el botón).
    const ids = rows.filter(o => o.status2 === 'GUIA GENERADA').map(o => o.id);
    const ledger = new Map<string, StockLedgerRow[]>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase
        .from('order_stock_ledger' as any)
        .select('order_id, qty_delivery, qty_global')
        .is('reverted_at', null)
        .in('order_id', ids.slice(i, i + 200));
      for (const row of (data || []) as unknown as StockLedgerRow[]) {
        ledger.set(row.order_id, [...(ledger.get(row.order_id) || []), row]);
      }
    }
    setStockLedger(ledger);

    const today = pyToday();
    const { data: g } = await supabase
      .from('orders')
      .select('id, items_json, provider_email, provider_emails_list, guide_generated_at')
      .eq('status2', 'GUIA GENERADA')
      .gte('guide_generated_at' as any, pyStart(today))
      .lte('guide_generated_at' as any, pyEnd(today));
    setGuidesToday((g || []) as any[]);
  };

  useEffect(() => { 
    load(); 
  }, [status2Filter, role, myEmail, showHistorical]);

  // Evitar una descarga masiva de pedidos por cada tecla del buscador.
  // Al escribir, se espera una pausa antes de consultar Supabase.
  useEffect(() => {
    if (!search.trim()) return;
    const timer = window.setTimeout(() => { void load(); }, 450);
    return () => window.clearTimeout(timer);
  }, [search]);

  const allProviders = useMemo(() => {
    if (role === 'PROVEEDOR') return [];
    const set = new Set<string>();
    orders.forEach(o => {
      if (o.provider_email && o.provider_email.trim()) {
        set.add(o.provider_email.trim());
      }
      if (o.provider_emails_list) {
        (o.provider_emails_list || '').split(',').forEach((e: string) => {
          const t = e.trim();
          if (t) set.add(t);
        });
      }
    });
    return [...set].sort();
  }, [orders, role]);

  const filteredProviders = useMemo(() => {
    if (!providerSearch.trim()) return allProviders;
    const q = providerSearch.toLowerCase().trim();
    return allProviders.filter(provider => provider.toLowerCase().includes(q));
  }, [allProviders, providerSearch]);

  const toggleProvider = (provider: string) => {
    setSelectedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const selectAllProviders = () => {
    if (allProviders.length === 0) return;

    if (selectedProviders.size === allProviders.length) {
      setSelectedProviders(new Set());
    } else {
      setSelectedProviders(new Set(allProviders));
    }
  };

  const allCities = useMemo(() => {
    const cities = new Set<string>();
    orders.forEach(o => {
      if (o.city && o.city.trim()) {
        cities.add(o.city.trim());
      }
    });
    return Array.from(cities).sort();
  }, [orders]);

  const allDepartments = useMemo(() => {
    const depts = new Set<string>();
    orders.forEach(o => {
      if (o.departamento && o.departamento.trim()) {
        depts.add(o.departamento.trim());
      }
    });
    return Array.from(depts).sort();
  }, [orders]);

  // Pedidos que cumplen TODOS los filtros actuales, excepto el filtro de producto.
  // Esto hace que el desplegable de Productos muestre solamente productos
  // que realmente tienen pedidos dentro del filtro actual.
  // Reagendados: los que ya no tienen delivery aparecen recién en su fecha.
  const todayKey = pyToday();
  const isWaitingDate = (o: any) =>
    Boolean(o.rescheduled_for) && String(o.rescheduled_for) > todayKey && !o.assigned_delivery && (!o.status2 || o.status2 === '--');
  const waitingDateCount = orders.filter(isWaitingDate).length;
  const [showWaiting, setShowWaiting] = useState(false);
  const productFilterBaseOrders = useMemo(() => {
    return orders.filter(o => {
      if (!showWaiting && isWaitingDate(o)) return false;
      if (showWaiting && !isWaitingDate(o)) return false;
      if (role === 'PROVEEDOR') {
        const providerList = `${o.provider_emails_list || ''},${o.provider_email || ''}`;
        const myEmailLower = myEmail.trim().toLowerCase();
        const isMine = providerList.split(/[,;\s]+/).some((email: string) => email.trim().toLowerCase() === myEmailLower);
        if (!isMine) return false;
      }

      if (role !== 'PROVEEDOR' && selectedProviders.size > 0) {
        const orderProviders = [
          ...(o.provider_emails_list || '').split(','),
          o.provider_email || '',
        ]
          .map((provider: string) => provider.trim().toLowerCase())
          .filter(Boolean);

        const matchesSelectedProvider = Array.from(selectedProviders).some(provider =>
          orderProviders.includes(provider.toLowerCase())
        );
        if (!matchesSelectedProvider) return false;
      }

      if (selectedCities.size > 0) {
        if (!o.city || !selectedCities.has(o.city)) return false;
      }

      if (selectedDepartments.size > 0) {
        if (!o.departamento || !selectedDepartments.has(o.departamento)) return false;
      }

      if (search && search.trim()) return true;
      if (!search) return true;

      const q = search.toLowerCase();
      return (o.customer_name || '').toLowerCase().includes(q) ||
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.phone || '').includes(q) ||
        (o.city || '').toLowerCase().includes(q) ||
        (o.departamento || '').toLowerCase().includes(q) ||
        (o.id || '').toLowerCase().includes(q);
    });
  }, [orders, search, selectedProviders, role, myEmail, selectedCities, selectedDepartments]);

  const allProducts = useMemo(() => {
    // Un solo registro por producto y suma automática de todas sus unidades
    // dentro de los pedidos que cumplen los demás filtros activos.
    const products = new Map<string, { key: string; name: string; qty: number }>();

    productFilterBaseOrders.forEach(order => {
      getProductEntries(order).forEach(entry => {
        const existing = products.get(entry.key);
        if (existing) {
          existing.qty += entry.qty;
        } else {
          products.set(entry.key, {
            key: entry.key,
            name: entry.name,
            qty: entry.qty,
          });
        }
      });
    });

    return Array.from(products.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'es')
    );
  }, [productFilterBaseOrders]);

  // Si al cambiar ciudad/departamento/proveedor desaparece un producto del filtro,
  // también lo quitamos automáticamente de la selección para no dejar un filtro invisible.
  useEffect(() => {
    const availableKeys = new Set(allProducts.map(product => product.key));
    setSelectedProducts(prev => {
      const next = new Set(Array.from(prev).filter(key => availableKeys.has(key)));
      if (next.size === prev.size && Array.from(prev).every(key => next.has(key))) return prev;
      return next;
    });
  }, [allProducts]);

  const filteredCities = useMemo(() => {
    if (!citySearch) return allCities;
    return allCities.filter(c => c.toLowerCase().includes(citySearch.toLowerCase()));
  }, [allCities, citySearch]);

  const filteredDepartments = useMemo(() => {
    if (!deptSearch) return allDepartments;
    return allDepartments.filter(d => d.toLowerCase().includes(deptSearch.toLowerCase()));
  }, [allDepartments, deptSearch]);

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return allProducts;
    const q = productSearch.toLowerCase().trim();
    return allProducts.filter(product =>
      product.name.toLowerCase().includes(q) ||
      String(product.qty).includes(q)
    );
  }, [allProducts, productSearch]);

  const toggleCity = (city: string) => {
    setSelectedCities(prev => {
      const next = new Set(prev);
      if (next.has(city)) next.delete(city);
      else next.add(city);
      return next;
    });
  };

  const toggleDepartment = (dept: string) => {
    setSelectedDepartments(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const toggleProduct = (product: string) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(product)) next.delete(product);
      else next.add(product);
      return next;
    });
  };

  const selectAllCities = () => {
    if (selectedCities.size === allCities.length) {
      setSelectedCities(new Set());
    } else {
      setSelectedCities(new Set(allCities));
    }
  };

  const selectAllDepartments = () => {
    if (selectedDepartments.size === allDepartments.length) {
      setSelectedDepartments(new Set());
    } else {
      setSelectedDepartments(new Set(allDepartments));
    }
  };

  const selectAllProducts = () => {
    if (selectedProducts.size === allProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(allProducts.map(product => product.key)));
    }
  };

  const filtered = useMemo(() => {
    if (selectedProducts.size === 0) return productFilterBaseOrders;

    return productFilterBaseOrders.filter(o => {
      const orderProducts = getProductEntries(o);
      return orderProducts.some(product => selectedProducts.has(product.key));
    });
  }, [productFilterBaseOrders, selectedProducts]);


  const pendingGuides = filtered.filter(o => !o.status2 || o.status2 === '--');
  const withGuides = filtered.filter(o => o.status2 === 'GUIA GENERADA');
  const visibleOrders = filtered;
  const pageOrders = useMemo(() => visibleOrders.slice(0, shownRows), [visibleOrders, shownRows]);
  const assignedEmails = useMemo(() => [...new Set(pageOrders
    .map(o => lc(o.assigned_delivery))
    .filter(Boolean))].sort(), [pageOrders]);
  const assignedEmailsKey = assignedEmails.join('|');
  useEffect(() => {
    if (!assignedEmailsKey) return;
    let active = true;
    const fetchNames = async () => {
      const names: Record<string, string> = {};
      // Look up only the deliveries in the currently visible rows, not all historical orders.
      for (let offset = 0; offset < assignedEmails.length; offset += 100) {
        const batch = assignedEmails.slice(offset, offset + 100);
        const {data, error} = await supabase.from('profiles').select('email,name').in('email', batch);
        if (!active) return;
        if (error) { console.error('No se pudieron consultar nombres de deliveries:', error); return; }
        for (const p of data || []) {
          const email = lc(p.email);
          if (email && p.name?.trim()) names[email] = p.name.trim();
        }
      }
      if (active) setAssignedDeliveryNames(prev => ({...prev, ...names}));
    };
    void fetchNames();
    return () => { active = false; };
  }, [assignedEmailsKey]);
  useEffect(() => { setShownRows(120); }, [status2Filter, selectedProviders, selectedProducts, selectedCities, selectedDepartments, search]);

  const repeatedClients = useMemo(() => {
    const map: Record<string, { name: string; count: number; guides: string[]; phones: string[] }> = {};
    visibleOrders.forEach(o => {
      const key = clientKey(o.customer_name, o.phone);
      if (!key) return;
      if (!map[key]) map[key] = { name: displayClientName(o.customer_name), count: 0, guides: [], phones: [] };
      map[key].count += 1;
      map[key].guides.push(o.order_number || o.id?.slice(0, 8) || 'SIN ID');
      if (o.phone && !map[key].phones.includes(o.phone)) map[key].phones.push(o.phone);
    });
    return Object.entries(map)
      .filter(([, item]) => item.count > 1)
      .map(([key, item]) => ({ ...item, key }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [visibleOrders]);

  const repeatedKeys = useMemo(() => new Set(repeatedClients.map(c => c.key)), [repeatedClients]);

  const repeatedClientsCount = repeatedClients.length;
  const repeatedGuidesCount = repeatedClients.reduce((sum, item) => sum + item.count, 0);

  const state2Opts = ['--', 'GUIA GENERADA', 'FUERA DE COBERTURA', 'CANCELADO', 'REPETIDO', 'RENDIDO'];

  const updateStatus2 = async (orderId: string, status2: string) => {
    const val = status2 === '--' ? null : status2;
    const { error } = await supabase.from('orders').update({ status2: val, updated_at: new Date().toISOString() }).eq('id', orderId);
    if (error) toast.error(error.message);
    else {
      toast.success('Estado 2 actualizado');
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status2: val } : o));
      void loadStock(orders);
      if (val === 'GUIA GENERADA') {
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }
    }
  };

  const buildGuideText = (o: any) => {
    const items = typeof o.items_json === 'string'
      ? JSON.parse(o.items_json || '[]')
      : (o.items_json || []);

    const itemsText = items.map((it: any, i: number) =>
      `${i + 1}. ${it.title || it.sku || 'Item'} x${it.qty || it.quantity || 1} —`
    ).join('\n');

    const separator = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

    return [
      `GUÍA DE ENVÍO — ${o.order_number || o.id.slice(0, 8)}`,
      separator,
      `Cliente: ${o.customer_name || ''}`,
      `Teléfono: ${o.phone || ''}`,
      `Email: ${o.email || ''}`,
      `Departamento: ${o.departamento || ''}`,
      `Ciudad: ${o.city || ''}`,
      `Dirección: ${o.street || ''} ${o.district ? '- ' + o.district : ''}`.trimEnd(),
      '',
      'Productos:',
      '',
      itemsText,
      '',
      `Total: Gs ${nf(Number(o.total_gs || 0))}`,
      o.obs ? `Observación: ${o.obs}` : '',
      separator,
      `Vendedor: ${o.created_by || ''}`,
      `Proveedor: ${o.provider_emails_list || o.provider_email || '—'}`,
    ].filter(line => line !== null && line !== undefined).join('\n');
  };

  const getWhatsAppUrl = (order: any) => {
    if (!order.phone) return '#';
    const randomMessage = whatsappMessages[Math.floor(Math.random() * whatsappMessages.length)];
    let phoneNumber = order.phone.replace(/\D/g, '');
    if (phoneNumber.startsWith('595')) {
      phoneNumber = phoneNumber;
    } else if (phoneNumber.startsWith('0')) {
      phoneNumber = '595' + phoneNumber.substring(1);
    } else if (phoneNumber.length === 9) {
      phoneNumber = '595' + phoneNumber;
    } else {
      phoneNumber = '595' + phoneNumber;
    }
    return 'https://wa.me/' + phoneNumber + '?text=' + encodeURIComponent(randomMessage);
  };

  const openGuideModal = (order: any) => {
    setCurrentOrder(order);
    setShowGuideModal(true);
  };

  const copyGuide = () => {
    if (currentOrder) {
      const text = buildGuideText(currentOrder);
      navigator.clipboard.writeText(text);
      toast.success('Guía copiada al portapapeles');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getSelectedOrders = () => visibleOrders.filter(o => selectedIds.has(o.id));

  // 📦 Stock del día: stock real y cuánto se usó hoy en guías.
  const usedToday = useMemo(() => {
    const m = new Map<string, { units: number; orders: number }>();
    for (const o of guidesToday) {
      for (const it of getOrderItems(o)) {
        const p = findItemProduct(it, stockProducts);
        if (!p) continue;
        const cur = m.get(p.id) || { units: 0, orders: 0 };
        cur.units += Number(it.qty || it.quantity || 1);
        cur.orders += 1;
        m.set(p.id, cur);
      }
    }
    return m;
  }, [guidesToday, stockProducts]);
  // La guía no consume stock; la disponibilidad efectiva se valida al ENTREGAR.
  const [stockSearch, setStockSearch] = useState('');
  const [stockView, setStockView] = useState<'todos' | 'usados' | 'bajos' | 'agotados'>('todos');
  const stockDayBase = useMemo(() => {
    let list = stockProducts.filter(productInScope);
    if (role === 'PROVEEDOR') list = list.filter(p => lc(p.provider_email) === lc(myEmail));
    // Filtro de proveedor de Despacho: sólo los productos del proveedor filtrado.
    else if (selectedProviders.size > 0) {
      const sel = new Set(Array.from(selectedProviders).map(lc));
      list = list.filter(p => sel.has(lc(p.provider_email)));
    }
    return list
      .map(p => {
        const used = usedToday.get(p.id) || { units: 0, orders: 0 };
        const real = Number(p.real_stock || 0);
        return { p, used, real, left: real - used.units };
      })
      .filter(r => r.real > 0 || r.used.units > 0);
  }, [stockProducts, productInScope, usedToday, role, myEmail, selectedProviders]);
  const stockDayRows = useMemo(() => {
    const t = stockSearch.trim().toLowerCase();
    return stockDayBase
      .filter(r => !t || `${r.p.title || ''} ${r.p.sku || ''} ${r.p.provider_email || ''}`.toLowerCase().includes(t))
      .filter(r => stockView === 'todos' || (stockView === 'usados' ? r.used.units > 0 : stockView === 'bajos' ? r.left > 0 && r.left <= 3 : r.left <= 0))
      .sort((a, b) => b.used.units - a.used.units || a.left - b.left || (a.p.title || '').localeCompare(b.p.title || ''));
  }, [stockDayBase, stockSearch, stockView]);
  const stockKpis = useMemo(() => ({
    products: stockDayBase.length,
    real: stockDayBase.reduce((n, r) => n + Math.max(0, r.real), 0),
    usedUnits: stockDayBase.reduce((n, r) => n + r.used.units, 0),
    usedOrders: new Set(guidesToday.filter(o => stockDayBase.some(r => getOrderItems(o).some((it: any) => findItemProduct(it, stockProducts)?.id === r.p.id))).map(o => o.id)).size,
    low: stockDayBase.filter(r => r.left > 0 && r.left <= 3).length,
    out: stockDayBase.filter(r => r.left <= 0).length,
  }), [stockDayBase, guidesToday, stockProducts]);

  // 🗑️ Admin: eliminar en lote pedidos de UN vendedor.
  const [deleteSeller, setDeleteSeller] = useState('');
  const [deletingBulk, setDeletingBulk] = useState(false);
  const sellerOptions = useMemo(() => {
    const m = new Map<string, number>();
    visibleOrders.forEach(o => {
      const e = String(o.created_by || '').toLowerCase().trim();
      if (e) m.set(e, (m.get(e) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleOrders]);
  const sellerOrders = useMemo(
    () => (deleteSeller ? visibleOrders.filter(o => String(o.created_by || '').toLowerCase().trim() === deleteSeller) : []),
    [visibleOrders, deleteSeller],
  );
  const sellerSelected = sellerOrders.filter(o => selectedIds.has(o.id));
  const deleteSellerOrders = async () => {
    if (!deleteSeller || !sellerSelected.length) { toast.error('Elegí el vendedor y seleccioná sus pedidos'); return; }
    const other = selectedIds.size - sellerSelected.length;
    if (!window.confirm(
      `🗑️ ELIMINAR ${sellerSelected.length} pedido(s) de ${deleteSeller}?\n\n` +
      sellerSelected.slice(0, 15).map(o => `${o.order_number} · ${o.customer_name}`).join('\n') +
      (sellerSelected.length > 15 ? `\n… y ${sellerSelected.length - 15} más` : '') +
      (other > 0 ? `\n\n(${other} seleccionado(s) de otros vendedores NO se tocan)` : '') +
      '\n\nNo se puede deshacer. Si alguno bajó stock, vuelve al stock.'
    )) return;
    if (window.prompt('Para confirmar escribí ELIMINAR') !== 'ELIMINAR') { toast.info('Cancelado'); return; }
    setDeletingBulk(true);
    const { data, error } = await (supabase as any).rpc('admin_delete_seller_orders', {
      p_seller_email: deleteSeller,
      p_order_ids: sellerSelected.map(o => o.id),
    });
    setDeletingBulk(false);
    if (error) { toast.error(error.message); return; }
    const skipped = (data?.skipped || []) as { order_number: string; why: string }[];
    toast.success(`🗑️ ${data?.deleted || 0} pedido(s) eliminados de ${deleteSeller}`, { duration: 8000 });
    if (skipped.length) {
      toast.warning(`No se eliminaron ${skipped.length}: ` + skipped.slice(0, 6).map(x => `${x.order_number} (${x.why})`).join(', '), { duration: 12000 });
    }
    setSelectedIds(new Set());
    void load();
  };
  // ✏️ Editar pedido completo / 🔗 fusionar pedidos del mismo cliente.
  const viewPaymentProof = async (o: any) => {
    if (!o.payment_proof_path) { toast.error('Sin comprobante'); return; }
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(o.payment_proof_path, 600);
    if (error || !data?.signedUrl) { toast.error(error?.message || 'No se pudo abrir el comprobante'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const reviewPayment = async (o: any, approve: boolean) => {
    let note: string | null = null;
    if (!approve) {
      note = window.prompt(`❌ Rechazar comprobante de ${o.order_number}\nMotivo (lo ve el vendedor):`);
      if (!note || !note.trim()) return;
    } else if (!window.confirm(`✅ Aprobar el comprobante de pago de ${o.order_number} (${o.customer_name})?`)) return;
    const { error } = await (supabase as any).rpc('review_order_payment', { p_order_id: o.id, p_approve: approve, p_note: note });
    if (error) { toast.error(error.message); return; }
    toast.success(approve ? '✅ Pago aprobado: ya se puede generar la guía' : '❌ Comprobante rechazado');
    void load();
  };

  const orderTools = useOrderEditTools(() => {
    setSelectedIds(new Set());
    void load();
  });

  const bulkCopyGuides = () => {
    const selected = getSelectedOrders();
    if (selected.length === 0) { toast.error('Seleccioná pedidos primero'); return; }
    const allText = selected.map(o => buildGuideText(o)).join('\n\n');
    navigator.clipboard.writeText(allText);
    toast.success(`${selected.length} guías copiadas`);
  };

  const bulkMarkAsGuiaGenerada = async () => {
    const selected = getSelectedOrders();
    
    if (selected.length === 0) {
      toast.error('Seleccioná pedidos primero');
      return;
    }
    const toastId = toast.loading(`Actualizando ${selected.length} pedido${selected.length > 1 ? 's' : ''}...`);
    
    try {
      const updates = selected.map(order => 
        supabase.from('orders').update({ 
          status2: 'GUIA GENERADA', 
          updated_at: new Date().toISOString() 
        }).eq('id', order.id)
      );
      
      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      
      if (errors.length > 0) {
        toast.error(`${errors.length} error${errors.length > 1 ? 'es' : ''} al actualizar`, { id: toastId });
      } else {
        toast.success(`${selected.length} pedido${selected.length > 1 ? 's' : ''} marcado${selected.length > 1 ? 's' : ''} como GUIA GENERADA`, { id: toastId });
        
        setOrders(prev => prev.map(o => 
          selectedIds.has(o.id) ? { ...o, status2: 'GUIA GENERADA' } : o
        ));
        
        setSelectedIds(new Set());
      }
      void loadStock(orders);
    } catch (error) {
      toast.error('Error al actualizar los pedidos', { id: toastId });
    }
  };

  const selectAllPending = () => {
    const allPendingIds = pendingGuides.map(o => o.id);
    if (allPendingIds.length === 0) {
      toast.error('No hay pedidos pendientes');
      return;
    }
    setSelectedIds(new Set(allPendingIds));
    toast.success(`${allPendingIds.length} pedido${allPendingIds.length > 1 ? 's' : ''} pendiente${allPendingIds.length > 1 ? 's' : ''} seleccionado${allPendingIds.length > 1 ? 's' : ''}`);
  };

  const clearSelection = () => {
    if (selectedIds.size === 0) return;
    setSelectedIds(new Set());
    toast.success('Selección limpiada');
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadTxt = () => {
    const selected = getSelectedOrders();
    if (selected.length === 0) { toast.error('Seleccioná pedidos primero'); return; }
    const content = selected.map(o => buildGuideText(o)).join('\n\n');
    downloadFile(content, `guias_${pyToday()}.txt`, 'text/plain');
    toast.success(`${selected.length} guías descargadas en TXT`);
  };

  // IMPRESIÓN PDF NORMAL - CAMBIO 2: PDF con QR usa order_number
  const printWithQR = (ordersOverride?: any[]) => {
    const selected = ordersOverride ?? getSelectedOrders();
    if (selected.length === 0) { 
      toast.error('Seleccioná pedidos primero'); 
      return; 
    }

    let allGuidesHtml = '';
    
    for (const order of selected) {
      const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items_json || []);
      let itemsHtml = '';
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        itemsHtml += `
          <tr>
            <td style="padding: 4px 0;">${i + 1}</td>
            <td style="padding: 4px 0;">${(it.title || it.sku || 'Item').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
            <td style="padding: 4px 0; text-align: center;">${it.qty || 1}</td>
          </tr>
        `;
      }

      // CAMBIO 2: usar order_number en lugar de id
      const orderNumber = order.order_number
        ? String(order.order_number).trim()
        : '';

      const deliveryUrl = orderNumber
        ? window.location.origin + '/#/asignar-pedidos?id=' + encodeURIComponent(orderNumber)
        : '#';

      const deliveryQrId = `qr-delivery-${order.id.replace(/-/g, '')}`;

      allGuidesHtml += `
        <div class="guide-page" style="page-break-after: always;">
          <h3 style="color: #7c5cff; margin: 0 0 10px 0;">GUÍA DE ENVÍO — ${order.order_number || order.id.slice(0, 8)}</h3>
          
          <table style="width: 100%; font-size: 12px; margin-bottom: 12px;">
            <tbody className="divide-y divide-slate-800/80">
              <tr><td style="width: 100px; padding: 2px 0; color: #666;">Cliente:</td><td style="font-weight: bold;">${(order.customer_name || '').replace(/</g, '&lt;')}</td></tr>
              <tr><td style="padding: 2px 0; color: #666;">Teléfono:</td><td style="font-weight: bold;">${order.phone || ''}</td></tr>
              <tr><td style="padding: 2px 0; color: #666;">Email:</td><td style="font-weight: bold;">${(order.email || '').replace(/</g, '&lt;')}</td></tr>
              <tr><td style="padding: 2px 0; color: #666;">Departamento:</td><td style="font-weight: bold;">${order.departamento || ''}</td></tr>
              <tr><td style="padding: 2px 0; color: #666;">Ciudad:</td><td style="font-weight: bold;">${order.city || ''}</td></tr>
              <tr><td style="padding: 2px 0; color: #666;">Dirección:</td><td style="font-weight: bold;">${(order.street || '').replace(/</g, '&lt;')} ${order.district ? '- ' + order.district : ''}</td></tr>
            </tbody>
          </table>
          
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="background: #f0f0f0; border-bottom: 1px solid #ddd;">
                <th style="text-align: left; padding: 6px 4px;">#</th>
                <th style="text-align: left; padding: 6px 4px;">Producto</th>
                <th style="text-align: center; padding: 6px 4px;">Cant.</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
            <tfoot>
              <tr style="border-top: 1px solid #ddd;">
                <td colspan="2" style="text-align: right; padding: 8px 4px;"><strong>Total:</strong></td>
                <td style="text-align: right; padding: 8px 4px;"><strong>Gs ${nf(Number(order.total_gs || 0))}</strong></td>
              </tr>
            </tfoot>
          </table>
          
          ${order.obs ? `<div style="margin-top: 8px; font-size: 11px; color: #666;">Observación: ${order.obs.replace(/</g, '&lt;')}</div>` : ''}
          
          <div style="margin-top: 8px; font-size: 10px; color: #666; border-top: 1px solid #eee; padding-top: 8px;">
            Vendedor: ${order.created_by || ''} | Proveedor: ${order.provider_emails_list || order.provider_email || '—'}
          </div>
          
          <div style="display: flex; justify-content: center; align-items: center; margin-top: 20px; padding-top: 15px; border-top: 2px dashed #ccc; width: 100%;">
            <div style="text-align: center; width: 100%;">
              <div style="font-size: 12px; font-weight: bold; color: #F97316; margin-bottom: 8px;">🚚 QR DELIVERY - Asignar Pedido</div>
              <div id="${deliveryQrId}" data-url="${deliveryUrl}" style="width: 120px; height: 120px; margin: 0 auto; display: flex; justify-content: center; align-items: center;"></div>
              <div style="font-size: 9px; color: #666; margin-top: 6px; text-align: center;">Escanea para asignar este pedido</div>
            </div>
          </div>
        </div>
      `;
    }

    const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Guías de Envío con QR</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @media print { body { margin: 0; padding: 0; } .guide-page { page-break-after: always; page-break-inside: avoid; } }
        @media screen { body { margin: 0; padding: 20px; background: #f5f5f5; font-family: Arial, sans-serif; } .guide-page { background: white; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); } }
        .guide-page { padding: 20px; font-family: Arial, sans-serif; border: 1px solid #ddd; max-width: 800px; margin: 0 auto 20px auto; }
        table { border-collapse: collapse; width: 100%; }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    </head>
    <body>
      ${allGuidesHtml}
      <script>
        (function() {
          function generateAllQRCodes() {
            if (typeof QRCode === 'undefined') { setTimeout(generateAllQRCodes, 500); return; }
            document.querySelectorAll('[id^="qr-delivery-"]').forEach(function(el) {
              if (el.children.length === 0) {
                var url = el.getAttribute('data-url');
                if (url && url !== '#') {
                  try { new QRCode(el, { text: url, width: 120, height: 120, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L }); } catch(e) { el.innerHTML = '<div style="color: red; font-size: 10px;">Error QR</div>'; }
                } else if (url === '#') { el.innerHTML = '<div style="color: orange; font-size: 10px;">Sin número de orden</div>'; }
              }
            });
          }
          if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function() { setTimeout(generateAllQRCodes, 200); }); } else { setTimeout(generateAllQRCodes, 200); }
        })();
      </script>
    </body>
    </html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 1500);
    }
    toast.success(`${selected.length} guías con QR listas para imprimir`);
  };

  // IMPRESIÓN PARA IMPRESORA TÉRMICA - CAMBIO 3: QR con order_number
  const printThermal = (ordersOverride?: any[], paper: 'thermal' | 'a4' = 'thermal') => {
    const selected = ordersOverride ?? getSelectedOrders();
    if (selected.length === 0) {
      toast.error('Seleccioná pedidos primero');
      return;
    }

    const ticketTemplates: string[] = [];

    for (const order of selected) {
      const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items_json || []);
      let itemsHtml = '';
      
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const productName = String(it.title || it.sku || 'Item');
        const qty = it.qty || it.quantity || 1;
        
        itemsHtml += `
          <div class="product-row">
            <span class="product-name">${i+1}. ${productName}</span>
            <span class="product-qty">x${qty}</span>
          </div>
        `;
      }

      const total = Number(order.total_gs || 0);
      // CAMBIO 3: usar order_number en lugar de id
      const orderNumber = order.order_number
        ? String(order.order_number).trim()
        : '';

      const deliveryUrl = orderNumber
        ? window.location.origin + '/#/asignar-pedidos?id=' + encodeURIComponent(orderNumber)
        : '#';

      const timestamp = Date.now();
      const deliveryQrId = `qr-delivery-thermal-${timestamp}-${order.id.slice(0, 8)}`;

      ticketTemplates.push(`
        <div class="thermal-ticket">
          <div class="header">
            <div class="title">GUÍA DE ENVÍO</div>
            <div class="order-number">#${order.order_number || order.id.slice(0, 8)}</div>
            <div class="date">${new Date(order.created_at).toLocaleDateString('es-PY')} - ${new Date(order.created_at).toLocaleTimeString('es-PY')}</div>
          </div>

          <div class="divider"></div>

          <div class="section">
            <div class="section-label">CLIENTE</div>
            <div class="customer-name">${(order.customer_name || '').toUpperCase()}</div>
            <div class="customer-phone">📞 ${order.phone || 'Sin teléfono'}</div>
            ${order.email ? `<div class="customer-email">✉️ ${order.email}</div>` : ''}
          </div>

          <div class="divider"></div>

          <div class="section">
            <div class="section-label">ENTREGA</div>
            <div class="address-line">${order.departamento || ''} - ${order.city || ''}</div>
            <div class="address-line">${order.street || ''} ${order.district ? '- ' + order.district : ''}</div>
          </div>

          <div class="divider"></div>

          <div class="section">
            <div class="section-label">PRODUCTOS</div>
            <div class="products-header">
              <span class="col-product">PRODUCTO</span>
              <span class="col-qty">CANT</span>
            </div>
            <div class="products-list">
              ${itemsHtml}
            </div>
          </div>

          <div class="total-box">
            <span class="total-label">TOTAL</span>
            <span class="total-amount">Gs ${nf(total)}</span>
          </div>

          ${order.obs ? `
            <div class="obs-box">
              📝 OBSERVACIÓN: ${order.obs}
            </div>
          ` : ''}

          <div class="divider"></div>

          <!-- QR DELIVERY ÚNICO Y CENTRADO -->
          <div class="qr-section">
            <div class="qr-item">
              <div class="qr-label">🚚 QR DELIVERY</div>
              <div id="${deliveryQrId}" data-url="${deliveryUrl}" class="qr-code"></div>
              <div class="qr-hint">Escanea para asignar este pedido</div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="footer">
            <div>VENDEDOR: ${order.created_by || ''}</div>
            <div>PROVEEDOR: ${order.provider_emails_list ? order.provider_emails_list.substring(0, 35) : order.provider_email || '—'}</div>
          </div>

          <div class="cut-line">- - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>
        </div>
      `);
    }

    // Hasta 9 tickets por hoja A4. Para pedidos extensos, menos tarjetas para darles espacio.
    const sheets: string[] = [];
    if (paper === 'a4') {
      let offset = 0;
      while (offset < selected.length) {
        const next = selected.slice(offset, offset + 9);
        const lengthy = next.some((o: any) => getOrderItems(o).length > 3 || String(o.obs || '').length > 90);
        const veryLengthy = next.some((o: any) => getOrderItems(o).length > 6 || String(o.obs || '').length > 200);
        const slots = veryLengthy ? 4 : lengthy ? 6 : 9;
        const count = Math.min(slots, selected.length - offset);
        sheets.push(`<div class="a4-sheet slots-${slots}">${ticketTemplates.slice(offset, offset + count).join('')}</div>`);
        offset += count;
      }
    }
    const allTicketsHtml = paper === 'a4' ? sheets.join('') : ticketTemplates.join('');

    const thermalHtml = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${paper === 'a4' ? 'Guías A4 - Hasta 9 por hoja' : 'Guías Térmicas'}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        @page {
          size: ${paper === 'a4' ? 'A4 portrait' : '80mm auto'};
          margin: ${paper === 'a4' ? '5mm' : '0mm'};
        }
        
        @media print {
          html, body {
            margin: 0;
            padding: 0;
            width: ${paper === 'a4' ? 'auto' : '80mm'};
            background: white;
          }
          .thermal-ticket {
            page-break-after: ${paper === 'a4' ? 'auto' : 'always'};
            width: 100%;
            padding: 3mm;
            font-family: 'Courier New', 'Courier', monospace;
            font-size: 12px;
          }
        }
        
        @media screen {
          body {
            background: #e0e0e0;
            padding: 10px;
          }
          .thermal-ticket {
            background: white;
            width: ${paper === 'a4' ? '100%' : '80mm'};
            margin: ${paper === 'a4' ? '0' : '0 auto 10px auto'};
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
          }
        }
        
        .thermal-ticket {
          padding: 3mm;
          font-family: 'Courier New', 'Courier', monospace;
          font-size: 12px;
          line-height: 1.5;
          background: white;
        }
        
        /* TODO EN NEGRITA */
        .thermal-ticket, .thermal-ticket * {
          font-weight: bold;
        }
        
        .header {
          text-align: center;
          margin-bottom: 8px;
        }
        .title {
          font-size: 16px;
          font-weight: bold;
          letter-spacing: 2px;
        }
        .order-number {
          font-size: 13px;
          font-weight: bold;
          margin-top: 4px;
        }
        .date {
          font-size: 10px;
          font-weight: bold;
          margin-top: 3px;
        }
        
        .divider {
          border-top: 1px dashed #000;
          margin: 8px 0;
        }
        
        .section {
          margin: 8px 0;
        }
        .section-label {
          font-size: 11px;
          font-weight: bold;
          background: #f0f0f0;
          display: inline-block;
          padding: 2px 6px;
          margin-bottom: 6px;
          letter-spacing: 1px;
        }
        .customer-name {
          font-size: 14px;
          font-weight: bold;
          margin: 4px 0;
        }
        .customer-phone, .customer-email {
          font-size: 11px;
          font-weight: bold;
          margin: 2px 0;
        }
        .address-line {
          font-size: 11px;
          font-weight: bold;
          margin: 3px 0;
        }
        
        .products-header {
          display: flex;
          font-weight: bold;
          font-size: 10px;
          border-bottom: 1px solid #000;
          padding-bottom: 4px;
          margin: 8px 0 4px 0;
        }
        .col-product {
          flex: 3;
        }
        .col-qty {
          flex: 1;
          text-align: center;
        }
        
        .products-list {
          margin: 4px 0;
        }
        .product-row {
          display: flex;
          font-size: 11px;
          font-weight: bold;
          margin: 4px 0;
        }
        .product-name {
          flex: 3;
        }
        .product-qty {
          flex: 1;
          text-align: center;
        }
        
        .total-box {
          display: flex;
          justify-content: space-between;
          font-weight: bold;
          font-size: 15px;
          margin: 10px 0;
          padding-top: 6px;
          border-top: 2px solid #000;
        }
        .total-label {
          font-weight: bold;
        }
        .total-amount {
          font-weight: bold;
          font-size: 16px;
        }
        
        .obs-box {
          font-size: 10px;
          font-weight: bold;
          margin: 8px 0;
          padding: 5px;
          background: #f5f5f5;
          border-left: 3px solid #ff9800;
        }
        
        /* QR DELIVERY ÚNICO Y CENTRADO */
        .qr-section {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          margin: 15px 0;
        }
        .qr-item {
          text-align: center;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .qr-label {
          font-size: 11px;
          font-weight: bold;
          margin-bottom: 8px;
          background: #f0f0f0;
          padding: 4px 8px;
          display: inline-block;
          border-radius: 4px;
        }
        .qr-code {
          width: 120px;
          height: 120px;
          margin: 0 auto;
        }
        .qr-hint {
          font-size: 8px;
          font-weight: bold;
          margin-top: 6px;
          color: #555;
        }
        
        .footer {
          font-size: 9px;
          font-weight: bold;
          text-align: center;
          margin: 8px 0;
        }
        
        .cut-line {
          text-align: center;
          font-size: 10px;
          font-weight: bold;
          letter-spacing: 3px;
          margin: 10px 0 3px 0;
        }
        ${paper === 'a4' ? `
          html, body { background: white; width: auto; }
          .a4-sheet { width: 200mm; height: 287mm; margin: 0 auto;
            display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
            grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 1.4mm;
            break-after: page; page-break-after: always; box-sizing: border-box; background: white; }
          .a4-sheet:last-child { break-after: auto; page-break-after: auto; }
          .a4-sheet.slots-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); }
          .a4-sheet.slots-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
          .a4-sheet .thermal-ticket { width: 100%; height: 100%; min-width: 0; min-height: 0; margin: 0;
            padding: 1.4mm; border: 3px solid #000000; box-shadow: none; font-size: 8px; line-height: 1.15;
            overflow: hidden; overflow-wrap: anywhere; page-break-after: auto !important; break-inside: avoid; }
          .a4-sheet .header { margin-bottom: 2px; }
          .a4-sheet .title { font-size: 10px; letter-spacing: 0; }
          .a4-sheet .order-number { font-size: 10px; margin-top: 1px; }
          .a4-sheet .date { font-size: 7px; margin-top: 1px; }
          .a4-sheet .divider { margin: 2px 0; }
          .a4-sheet .section { margin: 2px 0; }
          .a4-sheet .section-label { font-size: 7px; letter-spacing: 0; padding: 1px 3px; margin-bottom: 1px; }
          .a4-sheet .customer-name { font-size: 9px; margin: 1px 0; }
          .a4-sheet .customer-phone, .a4-sheet .customer-email, .a4-sheet .address-line { font-size: 7px; margin: 1px 0; }
          .a4-sheet .products-header { font-size: 7px; margin: 2px 0 1px; padding-bottom: 1px; }
          .a4-sheet .products-list { margin: 1px 0; }
          .a4-sheet .product-row { font-size: 7px; margin: 1px 0; gap: 2px; }
          .a4-sheet .total-box { font-size: 9px; margin: 3px 0; padding-top: 2px; }
          .a4-sheet .total-amount { font-size: 10px; }
          .a4-sheet .obs-box { font-size: 7px; margin: 2px 0; padding: 2px; }
          .a4-sheet .qr-section { margin: 2px 0; }
          .a4-sheet .qr-label { font-size: 7px; margin-bottom: 2px; padding: 1px 3px; }
          .a4-sheet .qr-code, .a4-sheet .qr-code img, .a4-sheet .qr-code canvas { width: 62px !important; height: 62px !important; }
          .a4-sheet .qr-hint { font-size: 6px; margin-top: 1px; }
          .a4-sheet .footer { font-size: 6px; margin: 2px 0; }
          .a4-sheet .cut-line { display: none; }
          .a4-sheet.slots-6 .thermal-ticket { padding: 2mm; }
          .a4-sheet.slots-4 .thermal-ticket { padding: 2.5mm; }
          @media screen { body { background: #eee; } .a4-sheet { margin-bottom: 16px; box-shadow: 0 3px 15px rgba(0,0,0,.2); } }
          @media print { html, body { width: auto; margin: 0; padding: 0; } .a4-sheet { width: 200mm; height: 287mm; } }
        ` : ''}
      </style>
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    </head>
    <body>
      ${allTicketsHtml}
      <script>
        (function() {
          function waitForQRCode() {
            if (typeof QRCode === 'undefined') {
              setTimeout(waitForQRCode, 300);
              return;
            }
            
            document.querySelectorAll('[id^="qr-delivery-thermal-"]').forEach(function(el) {
              if (el.children.length === 0) {
                var url = el.getAttribute('data-url');
                if (url && url !== '#') {
                  try {
                    new QRCode(el, { text: url, width: ${paper === 'a4' ? 62 : 120}, height: ${paper === 'a4' ? 62 : 120} });
                  } catch(e) {
                    console.log('QR Delivery error:', e);
                    el.innerHTML = '<div style="font-size:8px;color:red;">Error QR</div>';
                  }
                } else if (url === '#') {
                  el.innerHTML = '<div style="font-size:8px;color:orange;">Sin número de orden</div>';
                }
              }
            });
          }
          
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
              setTimeout(waitForQRCode, 200);
            });
          } else {
            setTimeout(waitForQRCode, 200);
          }
        })();
      </script>
    </body>
    </html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(thermalHtml);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 1500);
    }
    toast.success(paper === 'a4' ? `${selected.length} pedido(s) preparados en A4 (hasta 9 por hoja)` : `${selected.length} ticket(s) listos para imprimir en térmica`);
  };

  return (
    <div className={panelCls}>
      <div className="rounded-3xl border border-slate-700/80 bg-[#101827] px-4 md:px-6 py-4 mb-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-2xl shadow-lg shadow-cyan-500/20">📦</div>
          <div>
            <h3 className="text-2xl md:text-3xl font-black text-white leading-tight">Despacho</h3>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 justify-end">
          <button
            onClick={() => window.open('#/asignar-pedidos', '_blank')}
            className={proBtnCls + " bg-gradient-to-r from-violet-600 to-purple-500"}
          >
            📷 Abrir Lector QR
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-9 gap-3 mb-4">
        <div className={kpiBaseCls + " border-blue-500/40 bg-gradient-to-br from-blue-500/20 to-[#101827]"}>
          <div className="text-xs text-blue-200 mb-1">Guías pendientes</div>
          <div className="text-[24px] font-black text-white">{pendingGuides.length}</div>
        </div>
        <div className={kpiBaseCls + " border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 to-[#101827]"}>
          <div className="text-xs text-emerald-200 mb-1">Con guía generada</div>
          <div className="text-[24px] font-black text-white">{withGuides.length}</div>
        </div>
        <div className={kpiBaseCls + " border-cyan-500/40 bg-gradient-to-br from-cyan-500/20 to-[#101827]"}>
          <div className="text-xs text-cyan-200 mb-1">Guías generadas hoy</div>
          <div className="text-[24px] font-black text-white">{guidesTodayCount}</div>
        </div>
        <div className={kpiBaseCls + " border-violet-500/40 bg-gradient-to-br from-violet-500/20 to-[#101827]"}>
          <div className="text-xs text-violet-200 mb-1">Entregados hoy</div>
          <div className="text-[24px] font-black text-white">{deliveredTodayCount}</div>
        </div>
        <div className={kpiBaseCls + " border-slate-500/40 bg-gradient-to-br from-slate-500/20 to-[#101827]"}>
          <div className="text-xs text-slate-300 mb-1">Total</div>
          <div className="text-[24px] font-black text-white">{filtered.length}</div>
        </div>
        <div className={kpiBaseCls + " border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-[#101827]"}>
          <div className="text-xs text-amber-200 mb-1">Clientes repetidos</div>
          <div className="text-[24px] font-black text-white">{repeatedClientsCount}</div>
          <div className="text-[10px] text-amber-300">{repeatedGuidesCount} guías involucradas</div>
        </div>
        <div className={kpiBaseCls + " border-slate-700/70 bg-[#101827]"}>
          <div className="text-xs text-muted-foreground mb-1">Departamentos</div>
          <div className="text-[22px] font-extrabold">{selectedDepartments.size || 'Todos'}</div>
        </div>
        <div className={kpiBaseCls + " border-slate-700/70 bg-[#101827]"}>
          <div className="text-xs text-muted-foreground mb-1">Ciudades</div>
          <div className="text-[22px] font-extrabold">{selectedCities.size || 'Todas'}</div>
        </div>
        <div className={kpiBaseCls + " border-slate-700/70 bg-[#101827]"}>
          <div className="text-xs text-muted-foreground mb-1">Seleccionados</div>
          <div className="text-[22px] font-extrabold">{selectedIds.size}</div>
        </div>
      </div>

      {repeatedClients.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-[#101827] p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-sm font-black text-amber-200">⚠️ Clientes repetidos detectados</div>
              <div className="text-xs text-slate-300">Repetido = mismo nombre y apellido <b>y</b> mismo celular (sin importar acentos, mayúsculas ni el formato del número), dentro de los filtros visibles.</div>
            </div>
            <button
              className="nav-btn"
              style={{ background: '#f59e0b', color: 'white' }}
              onClick={() => {
                const text = repeatedClients.map(c => `${c.name} — ${c.count} guías: ${c.guides.join(', ')}${c.phones.length ? ' — Tel: ' + c.phones.join(', ') : ''}`).join('\n');
                navigator.clipboard.writeText(text);
                toast.success('Listado de repetidos copiado');
              }}
            >
              📋 Copiar repetidos
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {repeatedClients.slice(0, 9).map((client, i) => (
              <div key={i} className="rounded-xl bg-black/20 p-3" style={{ border: '3px solid #000000', boxShadow: '0 3px 0 #000000' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-white truncate">{client.name}</div>
                  <span className="text-xs font-black text-amber-200 bg-amber-500/20 px-2 py-1 rounded-full">{client.count}x</span>
                </div>
                {client.phones.length > 0 && <div className="text-[11px] text-slate-400 mt-1">Tel: {client.phones.join(', ')}</div>}
                <div className="text-[11px] text-slate-300 mt-1">Guías: {client.guides.join(', ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className={cardCls + " flex flex-wrap items-end gap-2 mb-3 p-3"}>
        <label className="app-label !mt-0">Estado</label>
        <select className={pillInputCls + " !w-auto min-w-[150px]"} value={status2Filter} onChange={e => {
          setStatus2Filter(e.target.value);
          setShowHistorical(false);
          setSelectedProducts(new Set());
          setSelectedCities(new Set());
          setSelectedDepartments(new Set());
          setSelectedProviders(new Set());
          setShowWaiting(false);
        }}>
          <option value="PENDIENTES">📋 Pendientes</option>
          <option value="CON_GUIA">✅ Con guía generada (hoy)</option>
          <option value="TODOS">📦 Todos</option>
        </select>
        {(status2Filter === 'TODOS' || status2Filter === 'CON_GUIA') && (
          <button type="button" className="nav-btn !text-xs"
            onClick={() => setShowHistorical(v => !v)}
            title={status2Filter === 'CON_GUIA'
              ? 'Alternar las guías generadas hoy y las guías anteriores'
              : 'Alternar entre los últimos 30 días y todos los pedidos históricos'}>
            {status2Filter === 'CON_GUIA'
              ? showHistorical ? '📅 Solo guías de hoy' : '📚 Incluir guías anteriores'
              : showHistorical ? '📆 Solo últimos 30 días' : '📚 Incluir históricos'}
          </button>
        )}
        
        {role !== 'PROVEEDOR' && (
          <div className="relative">
            <label className="app-label !mt-0">Proveedor</label>
            <button
              className="nav-btn min-w-[220px]"
              type="button"
              onClick={() => setShowProviderDropdown(!showProviderDropdown)}
              style={{
                background: selectedProviders.size > 0 ? '#3b82f6' : undefined,
                color: selectedProviders.size > 0 ? 'white' : undefined,
              }}
            >
              🏢 Proveedores {selectedProviders.size > 0 ? `(${selectedProviders.size})` : '(Todos)'}
            </button>

            {showProviderDropdown && (
              <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-xl shadow-xl w-96 max-h-96 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-border">
                  <input
                    type="text"
                    className={pillInputCls + " w-full text-sm"}
                    placeholder="🔎 Buscar proveedor..."
                    value={providerSearch}
                    onChange={e => setProviderSearch(e.target.value)}
                  />
                </div>

                <div className="p-2 border-b border-border flex flex-wrap gap-2">
                  <button className="text-xs nav-btn !py-1" type="button" onClick={selectAllProviders}>
                    {selectedProviders.size === allProviders.length && allProviders.length > 0
                      ? 'Deseleccionar todos'
                      : 'Seleccionar todos'}
                  </button>
                  <button
                    className="text-xs nav-btn !py-1"
                    type="button"
                    onClick={() => setSelectedProviders(new Set())}
                  >
                    Limpiar
                  </button>
                </div>

                <div className="overflow-auto max-h-64">
                  {filteredProviders.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      No se encontraron proveedores
                    </div>
                  ) : (
                    filteredProviders.map(provider => (
                      <label
                        key={provider}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-secondary cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProviders.has(provider)}
                          onChange={() => toggleProvider(provider)}
                        />
                        <span className="truncate" title={provider}>{provider}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {orders.filter(o => {
                            const providers = `${o.provider_emails_list || ''},${o.provider_email || ''}`
                              .split(',')
                              .map((value: string) => value.trim().toLowerCase());
                            return providers.includes(provider.toLowerCase());
                          }).length}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {status2Filter === 'CON_GUIA' && !showHistorical && (
        <div className="mb-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-2 text-xs text-cyan-200">
          📅 Mostrando guías generadas hoy en Paraguay, aunque el pedido se haya creado antes.
          {loading ? ' Cargando…' : ` ${orders.length} pedido(s) encontrados.`}
        </div>
      )}
      {/* Filtros segunda línea */}
      <div className={cardCls + " flex flex-wrap gap-2 mb-3 p-3"}>
        <input className={pillInputCls + " flex-1 min-w-[240px]"} placeholder="🔎 Buscar por order_number..."
          value={search} onChange={e => setSearch(e.target.value)} />
        
        <div className="relative">
          <button className="nav-btn" type="button" onClick={() => setShowDeptDropdown(!showDeptDropdown)}
            style={{ background: selectedDepartments.size > 0 ? '#3b82f6' : undefined, color: selectedDepartments.size > 0 ? 'white' : undefined }}>
            🗺️ Departamentos {selectedDepartments.size > 0 ? `(${selectedDepartments.size})` : ''}
          </button>
          {showDeptDropdown && (
            <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-xl shadow-xl w-80 max-h-96 overflow-hidden flex flex-col">
              <div className="p-2 border-b border-border">
                <input type="text" className={pillInputCls + " w-full text-sm"} placeholder="🔎 Buscar departamento..."
                  value={deptSearch} onChange={e => setDeptSearch(e.target.value)} />
              </div>
              <div className="p-2 border-b border-border flex gap-2">
                <button className="text-xs nav-btn !py-1" onClick={selectAllDepartments}>
                  {selectedDepartments.size === allDepartments.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
                <button className="text-xs nav-btn !py-1" onClick={() => setSelectedDepartments(new Set())}>Limpiar</button>
              </div>
              <div className="overflow-auto max-h-64">
                {filteredDepartments.map(dept => (
                  <label key={dept} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary cursor-pointer text-sm">
                    <input type="checkbox" checked={selectedDepartments.has(dept)} onChange={() => toggleDepartment(dept)} />
                    <span>{dept}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{orders.filter(o => o.departamento === dept).length}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="relative">
          <button className="nav-btn" type="button" onClick={() => setShowCityDropdown(!showCityDropdown)}
            style={{ background: selectedCities.size > 0 ? '#3b82f6' : undefined, color: selectedCities.size > 0 ? 'white' : undefined }}>
            🏙️ Ciudades {selectedCities.size > 0 ? `(${selectedCities.size})` : ''}
          </button>
          {showCityDropdown && (
            <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-xl shadow-xl w-80 max-h-96 overflow-hidden flex flex-col">
              <div className="p-2 border-b border-border">
                <input type="text" className={pillInputCls + " w-full text-sm"} placeholder="🔎 Buscar ciudad..."
                  value={citySearch} onChange={e => setCitySearch(e.target.value)} />
              </div>
              <div className="p-2 border-b border-border flex gap-2">
                <button className="text-xs nav-btn !py-1" onClick={selectAllCities}>
                  {selectedCities.size === allCities.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                </button>
                <button className="text-xs nav-btn !py-1" onClick={() => setSelectedCities(new Set())}>Limpiar</button>
              </div>
              <div className="overflow-auto max-h-64">
                {filteredCities.map(city => (
                  <label key={city} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary cursor-pointer text-sm">
                    <input type="checkbox" checked={selectedCities.has(city)} onChange={() => toggleCity(city)} />
                    <span>{city}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{orders.filter(o => o.city === city).length}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button className="nav-btn" type="button" onClick={() => setShowProductDropdown(!showProductDropdown)}
            style={{ background: selectedProducts.size > 0 ? '#3b82f6' : undefined, color: selectedProducts.size > 0 ? 'white' : undefined }}>
            📦 Productos {selectedProducts.size > 0 ? `(${selectedProducts.size})` : '(Todos)'}
          </button>
          {showProductDropdown && (
            <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-xl shadow-xl w-96 max-h-96 overflow-hidden flex flex-col">
              <div className="p-2 border-b border-border">
                <input type="text" className={pillInputCls + " w-full text-sm"} placeholder="🔎 Buscar producto..."
                  value={productSearch} onChange={e => setProductSearch(e.target.value)} />
              </div>
              <div className="p-2 border-b border-border flex gap-2">
                <button className="text-xs nav-btn !py-1" type="button" onClick={selectAllProducts}>
                  {selectedProducts.size === allProducts.length && allProducts.length > 0 ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
                <button className="text-xs nav-btn !py-1" type="button" onClick={() => setSelectedProducts(new Set())}>Limpiar</button>
              </div>
              <div className="overflow-auto max-h-64">
                {filteredProducts.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">No se encontraron productos</div>
                ) : (
                  filteredProducts.map(product => (
                    <label key={product.key} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selectedProducts.has(product.key)}
                        onChange={() => toggleProduct(product.key)}
                      />
                      <span className="truncate" title={product.name}>{product.name}</span>
                      <span className="text-xs font-black text-cyan-300 ml-auto whitespace-nowrap">
                        Cant. {product.qty}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        
        <button className="nav-btn active" onClick={load} disabled={loading}>
          {loading ? 'Cargando...' : 'Filtrar'}
        </button>
      </div>

      {canAssignFromGuides && (
        <section className="mb-4 rounded-3xl border border-cyan-500/30 bg-[#101827] p-4 md:p-5 space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-3">
            <div>
              <h4 className="text-lg font-black text-white">🚚 Asignación masiva de delivery <span className="text-xs text-cyan-300">(opcional)</span></h4>
              <p className="text-xs text-slate-400">Solo ADMIN y PROVEEDOR · No modifica estados de guía ni pedidos ya asignados</p>
            </div>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-sm font-black text-cyan-200">{selectedIds.size} seleccionado(s)</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
            <div className="space-y-2 min-w-0">
              <label className="block text-sm font-bold text-slate-200">🔎 Buscar y seleccionar delivery</label>
              <input className={pillInputCls+" w-full"} placeholder="Buscar por nombre o correo..." value={deliveryQuery} onChange={e=>setDeliveryQuery(e.target.value)}/>
              <select className={pillInputCls+" w-full"} value={targetDelivery} onChange={e=>setTargetDelivery(e.target.value)}>
                <option value="">— Elegir delivery —</option>
                {deliveryOptions.filter(d=>(d.name+" "+d.email).toLowerCase().includes(deliveryQuery.toLowerCase())).map(d=>
                  <option key={d.user_id} value={d.email}>{d.name||'DELIVERY'} — {d.email}</option>
                )}
              </select>
              {deliveryOptions.length===0 && <p className="text-xs text-amber-300">No hay deliveries aprobados visibles. Revisá permisos o usuarios.</p>}
            </div>
            <button type="button" className={proBtnCls+" bg-gradient-to-r from-cyan-600 to-blue-600 disabled:opacity-50"} disabled={assigningBulk||selectedIds.size===0||!targetDelivery} onClick={assignSelectedToDelivery}>
              {assigningBulk?'Asignando...':`Asignar ${selectedIds.size} pedidos`}
            </button>
          </div>
          <p className="text-xs text-slate-400">Primero seleccioná los pedidos de la tabla o usá «Seleccionar todos filtrados». Los que ya tienen delivery asignado se bloquean para evitar reemplazos accidentales.</p>
        </section>
      )}

      {orderTools.modal}

      {waitingDateCount > 0 && (
        <button
          className={`mb-3 rounded-full border px-3 py-1 text-xs font-bold ${showWaiting ? 'border-sky-400 bg-sky-500/20 text-sky-200' : 'border-slate-600 text-slate-300'}`}
          onClick={() => setShowWaiting(v => !v)}
        >
          {showWaiting ? '← Volver a los pedidos de hoy' : `📅 ${waitingDateCount} reagendado(s) esperando su fecha`}
        </button>
      )}

      {(role === 'ADMIN' || role === 'PROVEEDOR') && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
          <b className="text-rose-200">🗑️ Eliminar pedidos de un vendedor</b>
          <select
            className="rounded-lg border border-slate-700 bg-[#070b18] px-2 py-1.5 text-xs text-white"
            value={deleteSeller}
            onChange={e => setDeleteSeller(e.target.value)}
          >
            <option value="">Elegí el correo del vendedor…</option>
            {sellerOptions.map(([email, n]) => (
              <option key={email} value={email}>{email} ({n})</option>
            ))}
          </select>
          {deleteSeller && (
            <>
              <button
                className="nav-btn !px-3 !py-1.5 !text-xs"
                onClick={() => setSelectedIds(new Set(sellerOrders.map(o => o.id)))}
              >
                ☑️ Seleccionar sus {sellerOrders.length} pedidos
              </button>
              <button
                className="nav-btn !px-3 !py-1.5 !text-xs !bg-rose-600 !text-white disabled:opacity-40"
                disabled={deletingBulk || !sellerSelected.length}
                onClick={() => void deleteSellerOrders()}
              >
                {deletingBulk ? 'Eliminando…' : `🗑️ Eliminar ${sellerSelected.length} seleccionado(s)`}
              </button>
              <span className="text-slate-400">Sólo se eliminan los de este vendedor{role === 'PROVEEDOR' ? ' y de tus productos' : ''}. Entregados, rendidos, en cierre o con comisión pagada no se borran.</span>
            </>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          className={`rounded-full border px-4 py-1.5 text-xs font-black ${showStockDay ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200' : 'border-slate-600 text-slate-200'}`}
          onClick={() => setShowStockDay(v => !v)}
        >
          📦 Stock del día {showStockDay ? '▲' : '▼'}
        </button>
      </div>
      {showStockDay && (
        <div className="mb-4 rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-[#0d1626] to-[#080d18] p-4 shadow-2xl">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-white">📦 Stock del día</h3>
              <p className="text-xs text-slate-400">
                {pyToday().split('-').reverse().join('/')} · stock real y lo que salió hoy en guías
                {role !== 'PROVEEDOR' && selectedProviders.size > 0 ? ` · ${selectedProviders.size} proveedor(es) filtrado(s)` : ''}
              </p>
            </div>
            <input
              className="w-full max-w-xs rounded-xl border border-slate-700 bg-[#070b18] px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
              placeholder="🔎 Buscar producto o SKU…"
              value={stockSearch}
              onChange={e => setStockSearch(e.target.value)}
            />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { k: 'todos', label: 'Productos', value: stockKpis.products, sub: `${stockKpis.real} u. reales`, tone: 'text-white' },
              { k: 'usados', label: 'Usados hoy', value: stockKpis.usedUnits, sub: `${stockKpis.usedOrders} pedido(s)`, tone: 'text-sky-300' },
              { k: 'bajos', label: 'Quedan pocos', value: stockKpis.low, sub: '3 o menos', tone: 'text-amber-300' },
              { k: 'agotados', label: 'Agotados', value: stockKpis.out, sub: 'no se imprimen', tone: 'text-rose-400' },
            ].map(c => (
              <button
                key={c.k}
                onClick={() => setStockView(c.k as typeof stockView)}
                className={`rounded-2xl border p-3 text-left transition ${stockView === c.k ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'}`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{c.label}</div>
                <div className={`text-2xl font-black ${c.tone}`}>{c.value}</div>
                <div className="text-[10px] text-slate-500">{c.sub}</div>
              </button>
            ))}
            <div className="col-span-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-3 sm:col-span-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Uso del stock hoy</div>
              <div className="text-2xl font-black text-emerald-300">
                {stockKpis.real ? Math.round((stockKpis.usedUnits / stockKpis.real) * 100) : 0}%
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, stockKpis.real ? (stockKpis.usedUnits / stockKpis.real) * 100 : 0)}%` }} />
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {stockDayRows.map(({ p, used, real, left }) => {
              const pct = real > 0 ? Math.min(100, (used.units / real) * 100) : 100;
              const tone = left <= 0 ? 'rose' : left <= 3 ? 'amber' : 'emerald';
              return (
                <div key={p.id} className={`flex gap-3 rounded-2xl border p-3 ${left <= 0 ? 'border-rose-500/40 bg-rose-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-800">
                    {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <span className="text-lg">📦</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-white" title={p.title || ''}>{p.title || p.sku}</div>
                    <div className="truncate text-[10px] text-slate-500">{p.sku}{role !== 'PROVEEDOR' && p.provider_email ? ` · ${p.provider_email}` : ''}</div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Real <b className="text-white">{real}</b> · Hoy <b className="text-sky-300">{used.units}</b>{used.orders ? <span className="text-slate-500"> ({used.orders} ped.)</span> : null}</span>
                      <span className={`rounded-full px-2 py-0.5 font-black ${tone === 'rose' ? 'bg-rose-500/20 text-rose-300' : tone === 'amber' ? 'bg-amber-500/20 text-amber-200' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {left <= 0 ? '⛔ Agotado' : `Quedan ${left}`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {stockDayRows.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm text-slate-500">Sin productos para mostrar con estos filtros.</div>
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-500">
            El stock se descuenta al quedar ENTREGADO / ENCOMIENDA ENTREGADA. Los pedidos de productos agotados no se pueden seleccionar para imprimir (⛔).
          </p>
        </div>
      )}

      {/* Acciones masivas */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl shadow-xl">
          <div className="text-sm font-bold text-green-400 mr-2 self-center">
            ✅ {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}:
          </div>
          <button className="nav-btn" style={{ background: '#10b981', color: 'white' }} onClick={bulkMarkAsGuiaGenerada}>
            🚀 Marcar como GUIA GENERADA
          </button>
          {selectedIds.size >= 2 && (
            <button className="nav-btn" style={{ background: '#f59e0b', color: 'white' }} onClick={() => void orderTools.mergeOrders(getSelectedOrders())}>
              🔗 Fusionar {selectedIds.size} pedidos (un solo delivery)
            </button>
          )}
          {selectedIds.size === 1 && (
            <button className="nav-btn" style={{ background: '#0ea5e9', color: 'white' }} onClick={() => orderTools.openEditor(getSelectedOrders()[0])}>
              ✏️ Editar pedido completo
            </button>
          )}
          <button className="nav-btn" onClick={bulkCopyGuides}>📋 Copiar guías</button>
          <button className="nav-btn active" onClick={downloadTxt}>📥 Descargar TXT</button>
          <button className="nav-btn active" onClick={() => printWithQR()} style={{ background: '#8b5cf6', color: 'white' }}>
            🖨️ Imprimir PDF con QR
          </button>
          <button className="nav-btn" onClick={() => printThermal()} style={{ background: '#1a1a1a', color: 'white', border: '1px solid #333' }}>
            🧾 Imprimir Ticket Térmico (80mm)
          </button>
          <button type="button" className="nav-btn" style={{ background: '#2563eb', color: 'white' }} onClick={() => printThermal(undefined, 'a4')}>
            📄 Imprimir A4 · Hasta 9 pedidos por hoja
          </button>
          <button className="nav-btn" onClick={clearSelection} style={{ background: '#ef4444', color: 'white' }}>
            ✖️ Limpiar selección
          </button>
        </div>
      )}

      <div className={cardCls + " flex flex-wrap gap-2 mb-3 p-3"}>
        <button className="nav-btn" onClick={selectAllPending} style={{ background: '#3b82f6', color: 'white' }}>
          ☑️ Seleccionar todos pendientes ({pendingGuides.length})
        </button>
        {pendingGuides.length > 0 && (
          <button 
            className="nav-btn" 
            onClick={() => {
              setSelectedIds(new Set(pendingGuides.map(o => o.id)));
              printThermal(pendingGuides);
            }} 
            style={{ background: '#1a1a1a', color: 'white' }}
          >
            🧾 Imprimir todos pendientes (Térmica)
          </button>
        )}
        {visibleOrders.length > 0 && (
          <>
            <button
              className="nav-btn"
              onClick={() => setSelectedIds(new Set(visibleOrders.map(o => o.id)))}
              style={{ background: '#0ea5e9', color: 'white' }}
            >
              ☑️ Seleccionar todos filtrados ({visibleOrders.length})
            </button>
            <button
              className="nav-btn"
              onClick={() => printWithQR(visibleOrders)}
              style={{ background: '#8b5cf6', color: 'white' }}
            >
              🖨️ Imprimir todos filtrados PDF ({visibleOrders.length})
            </button>
            <button
              className="nav-btn"
              onClick={() => printThermal(visibleOrders)}
              style={{ background: '#1a1a1a', color: 'white' }}
            >
              🧾 Imprimir todos filtrados Térmica ({visibleOrders.length})
            </button>
            <button type="button" className="nav-btn" style={{ background: '#2563eb', color: 'white' }} onClick={() => printThermal(visibleOrders, 'a4')}>
              📄 Imprimir todos filtrados A4 · Hasta 9 por hoja ({visibleOrders.length})
            </button>
          </>
        )}
      </div>


      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-3">
        <div>
          <p className="text-sm font-black text-white">📦 Vista de pedidos de Despacho</p>
          <p className="text-xs text-slate-400">Tarjetas una al lado de otra, con los mismos filtros y acciones de la tabla.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Vista de Despacho">
          <button type="button" aria-pressed={ordersViewMode === 'cards'}
            className={`nav-btn ${ordersViewMode === 'cards' ? 'active' : ''}`}
            onClick={() => setOrdersViewMode('cards')}>▦ Cuadros</button>
          <button type="button" aria-pressed={ordersViewMode === 'table'}
            className={`nav-btn ${ordersViewMode === 'table' ? 'active' : ''}`}
            onClick={() => setOrdersViewMode('table')}>☷ Tabla</button>
        </div>
      </div>

      {ordersViewMode === 'cards' && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {pageOrders.map(o => {
            const isRepeat = repeatedKeys.has(clientKey(o.customer_name, o.phone));
            const productEntries = getOrderItems(o);
            const deliveryEmail = lc(o.assigned_delivery || o.delivery_email);
            const currentDelivery = assignedDeliveryNames[lc(o.assigned_delivery)] ||
              deliveryOptions.find(d => lc(d.email) === lc(o.assigned_delivery))?.name || o.assigned_delivery;
            return (
              <article key={o.id} className="min-w-0 rounded-2xl bg-[#101827] p-3 text-slate-100"
                style={{ border: '3px solid #000000', boxShadow: '0 4px 0 #000000, 0 8px 16px rgba(0,0,0,.3)' }}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="break-all text-sm">📦 {o.order_number || o.id.slice(0, 8)}</strong>
                    <p className="text-[11px] text-slate-400">{new Date(o.created_at).toLocaleDateString('es-PY')}</p>
                  </div>
                  <input type="checkbox" aria-label={`Seleccionar pedido ${o.order_number || o.id}`}
                    checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {isRepeat && <span className="rounded-full bg-amber-500/20 px-2 py-1 text-[10px] font-black text-amber-300">⚠️ Repetido</span>}
                  {o.rescheduled_for && (!o.status2 || o.status2 === '--') && !o.assigned_delivery &&
                    <span className="rounded-full bg-sky-500/20 px-2 py-1 text-[10px] text-sky-300">📅 Reagendado {dayLabel(String(o.rescheduled_for))}</span>}
                  {o.shipping_type === 'ENCOMIENDA' && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-1 text-[10px] text-amber-300">
                      📮 Pago {o.payment_status || 'PENDIENTE'}
                    </span>
                  )}
                </div>
                <div className="mb-2 rounded-xl bg-slate-900/80 p-2 text-xs">
                  <p className="break-words font-black">{o.customer_name || 'Sin cliente'}</p>
                  <p className="mt-1">📍 {[o.departamento, o.city].filter(Boolean).join(' · ') || 'Sin ciudad'}</p>
                  <p className="mt-1 break-all">📱 {o.phone || '—'}</p>
                  <p className="mt-1 break-all text-slate-400">Vendedor: {o.created_by || '—'}</p>
                  <p className="mt-1 break-all text-slate-400">Proveedor: {o.provider_emails_list || o.provider_email || '—'}</p>
                </div>
                <div className="mb-2 rounded-xl border border-slate-700 p-2 text-xs">
                  <p className="mb-1 font-bold">🛍️ Productos</p>
                  {productEntries.length ? productEntries.map((it: any, i: number) => {
                    const product = findItemProduct(it, stockProducts);
                    const qty = Number(it.qty || it.quantity || 1);
                    const stock = product ? Number(product.stock || 0) : 0;
                    const own = product && deliveryEmail ? deliveryStock.get(`${deliveryEmail}|${product.id}`) || 0 : 0;
                    return <div key={i} className="mb-1 break-words">
                      <span>{it.title || it.sku || 'Producto'} × {qty}</span>
                      <span className={`block text-[10px] ${!product || (own < qty && stock < qty) ? 'text-rose-300' : 'text-slate-400'}`}>
                        {product ? `Stock: ${stock} · Real: ${product.real_stock ?? 0} · Delivery: ${own}` : '⚠️ Producto sin vincular'}
                      </span>
                    </div>;
                  }) : <p className="text-slate-400">Sin productos</p>}
                  <p className="mt-2 border-t border-slate-700 pt-2 font-bold">Total: Gs {nf(Number(o.total_gs || 0))}</p>
                </div>
                <div className="mb-3 space-y-1 text-xs">
                  <p>🚚 {currentDelivery || 'Sin asignar'}</p>
                  <select aria-label="Estado de guía" className="w-full rounded-lg border border-slate-700 bg-[#070b18] px-2 py-2 text-xs text-white"
                    value={o.status2 || '--'} onChange={e => updateStatus2(o.id, e.target.value)}>
                    {state2Opts.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  {o.shipping_type === 'ENCOMIENDA' && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      <button type="button" className="nav-btn !px-2 !py-1 !text-[10px]" onClick={() => void viewPaymentProof(o)}>🧾 Ver comprobante</button>
                      {o.payment_status !== 'APROBADO' &&
                        <button type="button" className="nav-btn !px-2 !py-1 !text-[10px]" onClick={() => void reviewPayment(o, true)}>✅ Aprobar pago</button>}
                      {o.payment_status === 'PENDIENTE' &&
                        <button type="button" className="nav-btn !px-2 !py-1 !text-[10px]" onClick={() => void reviewPayment(o, false)}>❌ Rechazar</button>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-slate-700 pt-2">
                  <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => orderTools.openEditor(o)}>✏️ Editar</button>
                  <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => openGuideModal(o)}>📄 Guía QR</button>
                  <button type="button" className="nav-btn !px-2 !py-1 !text-[11px]" onClick={() => {
                    navigator.clipboard.writeText(buildGuideText(o)).then(() => toast.success('Copiada')).catch(() => toast.error('No se pudo copiar'));
                  }}>📋 Copiar</button>
                </div>
              </article>
            );
          })}
          {pageOrders.length === 0 && (
            <div className="col-span-full rounded-xl border border-slate-700 p-6 text-center text-slate-400">
              {loadError ? 'Error cargando pedidos: ' + loadError : loading ? 'Cargando pedidos…' : 'No hay pedidos con estos filtros.'}
            </div>
          )}
        </div>
      )}

      {/* Tabla clásica opcional */}
      {ordersViewMode === 'table' && <div className="overflow-auto rounded-2xl border border-slate-700/80 bg-[#101827] shadow-2xl">

        <table className="w-full min-w-[1900px] text-sm [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3">
          <thead className="bg-[#070b18] sticky top-0 z-10">
            <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-700/80">
              <th className="w-[40px] text-center">
                <input type="checkbox" checked={selectedIds.size === visibleOrders.length && visibleOrders.length > 0}
                  onChange={() => selectedIds.size > 0 ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleOrders.map(o => o.id)))} />
              </th>
              <th>Fecha</th>
              <th>ID</th>
              <th>Departamento</th>
              <th>Ciudad</th>
              <th>Cliente</th>
              <th>Productos</th>
              <th>Stock</th>
              <th>Repetido</th>
              <th>Teléfono</th>
              <th>Vendedor</th>
              <th>Proveedor</th>
              <th>Asignado a (delivery)</th>
              <th>Estado 2</th>
              <th>Guía</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {pageOrders.map(o => (
              <tr key={o.id} className="hover:bg-slate-800/45 transition-colors">
                <td className="text-center">
                  <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                 </td>
                <td className="text-xs whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('es-PY')}</td>
                <td className="text-xs font-bold">
                  {o.order_number || o.id.slice(0, 8)}
                  {o.rescheduled_for && (!o.status2 || o.status2 === '--') && !o.assigned_delivery && (
                    <div className="mt-1 whitespace-nowrap text-[10px] font-bold text-sky-300">📅 Reagendado {dayLabel(String(o.rescheduled_for))} · aprobar despacho</div>
                  )}
                  {o.shipping_type === 'ENCOMIENDA' && (
                    <div className="mt-1 space-y-1 font-normal">
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        o.payment_status === 'APROBADO' ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : o.payment_status === 'RECHAZADO' ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
                          : 'border-amber-400/40 bg-amber-500/15 text-amber-300'}`}
                        title={o.payment_review_note || ''}>
                        📮 {o.payment_status === 'APROBADO' ? 'Pago aprobado' : o.payment_status === 'RECHAZADO' ? 'Pago rechazado' : 'Pago por aprobar'}
                      </span>
                      <div className="flex gap-1">
                        <button className="nav-btn !px-2 !py-0.5 !text-[10px]" onClick={() => void viewPaymentProof(o)} title="Ver comprobante">🧾 Ver</button>
                        {o.payment_status !== 'APROBADO' && (
                          <button className="nav-btn !px-2 !py-0.5 !text-[10px] !bg-emerald-500/20 !text-emerald-200" onClick={() => void reviewPayment(o, true)}>✅</button>
                        )}
                        {o.payment_status === 'PENDIENTE' && (
                          <button className="nav-btn !px-2 !py-0.5 !text-[10px] !bg-rose-500/20 !text-rose-200" onClick={() => void reviewPayment(o, false)}>❌</button>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                <td className="text-xs">{o.departamento || '—'}</td>
                <td className="text-xs">{o.city || '—'}</td>
                <td className="text-xs font-bold">{o.customer_name}</td>
                <td className="text-xs min-w-[260px] max-w-[380px]">
                  <div className="flex flex-wrap gap-1">
                    {getOrderItems(o).length > 0 ? getOrderItems(o).map((it: any, i: number) => (
                      <span key={i} className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-200">
                        {it.title || it.sku || 'Item'} x{it.qty || it.quantity || 1}
                      </span>
                    )) : <span className="text-slate-500">—</span>}
                  </div>
                </td>
                <td className="text-xs min-w-[190px]">
                  {(() => {
                    const delivery = lc(o.assigned_delivery || o.delivery_email);
                    const applied = stockLedger.get(o.id);
                    return (
                      <div className="space-y-1.5">
                        {getOrderItems(o).map((it: any, i: number) => {
                          const p = findItemProduct(it, stockProducts);
                          const qty = Number(it.qty || it.quantity || 1);
                          if (!p) return <div key={i} className="text-amber-300">⚠️ Sin producto</div>;
                          const own = delivery ? deliveryStock.get(`${delivery}|${p.id}`) || 0 : 0;
                          const low = own < qty && Number(p.stock || 0) < qty;
                          return (
                            <div key={i} className={`whitespace-nowrap ${low ? 'text-rose-300' : 'text-slate-200'}`} title={p.title || ''}>
                              <b>{p.stock ?? 0}</b> <span className="text-slate-400">· real</span> <b>{p.real_stock ?? 0}</b>
                              {own > 0 && <span className="ml-1 text-sky-300">· 🚚 {own}</span>}
                            </div>
                          );
                        })}
                        {o.status2 === 'GUIA GENERADA' && (applied ? (
                          <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                            ✅ Descontado ({applied.reduce((n, r) => n + r.qty_delivery + r.qty_global, 0)})
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Se descuenta al entregar</span>
                        ))}
                      </div>
                    );
                  })()}
                </td>
                <td className="text-xs">
                  {repeatedKeys.has(clientKey(o.customer_name, o.phone)) ? (
                    <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 font-black">Repetido</span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="text-xs">{o.phone}</td>
                <td className="text-xs">{o.created_by}</td>
                <td className="text-xs">{o.provider_emails_list || o.provider_email || '—'}</td>
                <td className="text-xs min-w-[195px]">
                  {o.assigned_delivery ? (
                    <div className="space-y-0.5">
                      <span className="font-bold text-sky-300">🛵 {assignedDeliveryNames[lc(o.assigned_delivery)] || deliveryOptions.find(d => lc(d.email) === lc(o.assigned_delivery))?.name || o.assigned_delivery}</span>
                      {(assignedDeliveryNames[lc(o.assigned_delivery)] || deliveryOptions.some(d => lc(d.email) === lc(o.assigned_delivery) && !!d.name)) && (
                        <div className="text-[10px] text-slate-400 break-all">{o.assigned_delivery}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-amber-300 font-semibold">Sin asignar</span>
                  )}
                </td>
                <td className="text-xs">
                  <select className="bg-[#070b18] border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-blue-400" value={o.status2 || '--'}
                    onChange={e => updateStatus2(o.id, e.target.value)}>
                    {state2Opts.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                 </td>
                <td className="text-xs">
                  <div className="flex gap-1">
                    <button className="nav-btn px-2 py-1 text-[10px]" onClick={() => orderTools.openEditor(o)} title="Editar cliente, dirección, guía, productos, cantidades y precios">✏️</button>
                    <button className="nav-btn px-2 py-1 text-[10px]" onClick={() => openGuideModal(o)} title="Ver guía con QR">📄</button>
                    <button className="nav-btn px-2 py-1 text-[10px]" onClick={() => {
                      const text = buildGuideText(o);
                      navigator.clipboard.writeText(text);
                      toast.success('Copiada');
                    }} title="Copiar guía">📋</button>
                  </div>
                 </td>
              </tr>
            ))}
            {visibleOrders.length === 0 && (
              <tr>
                <td colSpan={15} className="text-center text-muted-foreground py-8">
                  <div className="space-y-2">
                    <p>{loadError ? "Error al cargar pedidos: " + loadError : loading ? "Cargando pedidos…" : "No hay pedidos que coincidan con los filtros actuales."}</p>
                    <button type="button" className="nav-btn active" onClick={() => {
                      setStatus2Filter('TODOS');
                      setSelectedProviders(new Set());
                      setSelectedCities(new Set());
                      setSelectedDepartments(new Set());
                      setSelectedProducts(new Set());
                      setShowWaiting(false);
                      setSearch('');
                      void load();
                    }}>🔄 Ver todos y actualizar</button>
                    {favoritesActive && <button type="button" className="nav-btn" onClick={() => setFavoritesActive(false)}>
                      Mostrar también proveedores fuera de favoritos
                    </button>}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}

      {visibleOrders.length > shownRows && (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-slate-700/80 bg-slate-900/50 p-3 text-sm text-slate-200">
          Mostrando {Math.min(shownRows, visibleOrders.length)} de {visibleOrders.length} pedidos filtrados.
          <button type="button" className="nav-btn active" onClick={() => setShownRows(n => n + 120)}>
            📦 Ver 120 pedidos más
          </button>
        </div>
      )}

      {/* MODAL DE GUÍA CON QR */}
      {showGuideModal && currentOrder && (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4" onClick={() => setShowGuideModal(false)}>
          <div className="bg-[#101827] border border-slate-700 rounded-3xl p-6 w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl text-white" onClick={e => e.stopPropagation()}>
            <h4 className="text-lg font-extrabold mb-3">📦 Guía de Envío</h4>
            
            <div className="space-y-2 text-sm">
              <p><strong>Pedido:</strong> {currentOrder.order_number || currentOrder.id.slice(0, 8)}</p>
              <p><strong>Cliente:</strong> {currentOrder.customer_name || ''}</p>
              <p><strong>Teléfono:</strong> {currentOrder.phone || ''}</p>
              <p><strong>Email:</strong> {currentOrder.email || ''}</p>
              <p><strong>Departamento:</strong> {currentOrder.departamento || ''}</p>
              <p><strong>Ciudad:</strong> {currentOrder.city || ''}</p>
              <p><strong>Dirección:</strong> {currentOrder.street || ''} {currentOrder.district ? '- ' + currentOrder.district : ''}</p>
              
              <div className="border-t border-border my-3"></div>
              
              <p><strong>Productos:</strong></p>
              <div className="pl-4">
                {(() => {
                  const items = typeof currentOrder.items_json === 'string' ? JSON.parse(currentOrder.items_json) : (currentOrder.items_json || []);
                  return items.map((it: any, i: number) => (
                    <p key={i}>{i + 1}. {it.title || it.sku || 'Item'} x{it.qty || it.quantity || 1} —</p>
                  ));
                })()}
              </div>
              
              <p><strong>Total:</strong> Gs {nf(Number(currentOrder.total_gs || 0))}</p>
              
              {currentOrder.obs && <p><strong>Observación:</strong> {currentOrder.obs}</p>}
              
              <div className="border-t border-border my-3"></div>
              
              <p><strong>Vendedor:</strong> {currentOrder.created_by || ''}</p>
              <p><strong>Proveedor:</strong> {currentOrder.provider_emails_list || currentOrder.provider_email || '—'}</p>
            </div>
            
            <div className="border-t border-border my-4 pt-4">
              <p className="font-bold text-center mb-3">Código QR</p>
              <div className="flex justify-center items-center w-full">
                <div className="text-center w-full flex flex-col items-center justify-center">
                  <div className="text-sm font-semibold text-orange-600 mb-2">🚚 QR Delivery</div>
                  <div ref={qrDeliveryRef} style={{ width: 120, height: 120, margin: '0 auto' }}></div>
                  <div className="text-xs text-gray-500 mt-2 text-center">Escanea para asignar pedido</div>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2 justify-end mt-4">
              <button className="nav-btn" onClick={() => setShowGuideModal(false)}>Cerrar</button>
              <button className="nav-btn active" onClick={copyGuide}>📋 Copiar texto</button>
              <button className="nav-btn active" onClick={() => {
                const text = buildGuideText(currentOrder);
                downloadFile(text, `guia_${currentOrder.order_number || currentOrder.id.slice(0, 8)}.txt`, 'text/plain');
              }}>📥 TXT</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
