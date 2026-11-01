import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { pyToday, pyStart, pyEnd } from '@/lib/pyTime';
import { useOrderEditTools } from '@/components/OrderEditTools';

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

type StockProduct = { id: string; sku: string | null; title: string | null; stock: number | null; real_stock: number | null; provider_email: string | null; created_at: string };
type StockLedgerRow = { order_id: string; qty_delivery: number; qty_global: number };

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

// Igual que order_item_product() en la base de datos: id, o SKU desempatando por proveedor y título.
const findItemProduct = (item: any, products: StockProduct[]) => {
  const id = String(item?.product_id || item?.id || '');
  const sku = lc(item?.sku);
  const candidates = products.filter(p => (id && p.id === id) || (sku && lc(p.sku) === sku));
  const score = (p: StockProduct) =>
    (id && p.id === id ? 4 : 0) +
    (lc(p.provider_email) === lc(item?.provider_email) ? 2 : 0) +
    (lc(p.title) === lc(item?.title) ? 1 : 0);
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
  const [orders, setOrders] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [providerSearch, setProviderSearch] = useState('');
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [guideText, setGuideText] = useState('');
  const [guideId, setGuideId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deliveryOptions, setDeliveryOptions] = useState<{user_id:string;email:string;name:string}[]>([]);
  const [deliveryQuery, setDeliveryQuery] = useState('');
  const [targetDelivery, setTargetDelivery] = useState('');
  const [assigningBulk, setAssigningBulk] = useState(false);
  const canAssignFromGuides = role === 'ADMIN' || role === 'PROVEEDOR';
  const canApplyStock = role === 'ADMIN' || role === 'DESPACHANTE' || role === 'PROVEEDOR';

  // STOCK: productos, stock por delivery y descuentos vigentes por pedido.
  const [stockProducts, setStockProducts] = useState<StockProduct[]>([]);
  const [deliveryStock, setDeliveryStock] = useState<Map<string, number>>(new Map());
  const [stockLedger, setStockLedger] = useState<Map<string, StockLedgerRow[]>>(new Map());
  const [applyingStockId, setApplyingStockId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [guidesTodayCount, setGuidesTodayCount] = useState(0);
  const [deliveredTodayCount, setDeliveredTodayCount] = useState(0);
  
  // FILTROS EXISTENTES
  const [status2Filter, setStatus2Filter] = useState<string>('PENDIENTES');
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
        ...String(o.provider_emails_list||'').toLowerCase().split(/[,;\\s]+/),
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

    try {
      // Sin límite práctico de filas: trae los pedidos en páginas de 1.000
      // pedidas en paralelo.
      const { data: allRows, error } = await fetchAllRows('orders', (query) => {
        let q = query.order('created_at', { ascending: false });
        if (search && search.trim()) q = q.ilike('order_number', `%${search.trim()}%`);
        if (status2Filter === 'PENDIENTES') q = q.or('status2.is.null,status2.eq.--');
        else if (status2Filter === 'CON_GUIA') q = q.eq('status2', 'GUIA GENERADA');
        return q;
      });

      if (error) {
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
          .select('*')
          .eq('status2', 'GUIA GENERADA')
          .gte('updated_at', pyStart(today))
          .lte('updated_at', pyEnd(today)),
        supabase
          .from('orders')
          .select('*')
          .in('status', ['ENTREGADO', 'ENCOMIENDA ENTREGADA'])
          .gte('delivered_at', pyStart(today))
          .lte('delivered_at', pyEnd(today)),
      ]);

      const roleFilter = (o: any) => {
        if (role === 'PROVEEDOR') {
          const providerList = o.provider_emails_list || '';
          return providerList.toLowerCase().includes(myEmail.toLowerCase());
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
      supabase.from('products').select('id, sku, title, stock, real_stock, provider_email, created_at'),
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
  };

  const applyStock = async (o: any) => {
    const items = getOrderItems(o);
    const summary = items.map((it: any) => `• ${it.title || it.sku} x${it.qty || it.quantity || 1}`).join('\n');
    if (!window.confirm(`¿Bajar el stock de este pedido?\n\n${summary}\n\nSi el delivery asignado tiene stock propio se descuenta del suyo; si no, del stock global (visible y real). Si el pedido vuelve a DEVUELTO A DEPÓSITO, el stock se repone.`)) return;

    setApplyingStockId(o.id);
    const { data, error } = await supabase.rpc('apply_order_stock' as any, { p_order_id: o.id });
    setApplyingStockId(null);

    if (error) {
      toast.error(error.message);
      return;
    }
    const result = (data || {}) as { ok?: boolean; already?: boolean; missing?: string[]; lines?: { delivery: number; global: number }[] };
    if (result.already) toast.info('Este pedido ya tenía el stock descontado.');
    else if (result.ok) {
      const fromDelivery = (result.lines || []).reduce((n, l) => n + l.delivery, 0);
      const fromGlobal = (result.lines || []).reduce((n, l) => n + l.global, 0);
      toast.success(`📦 Stock descontado: ${[fromDelivery ? `${fromDelivery} del delivery` : '', fromGlobal ? `${fromGlobal} del global` : ''].filter(Boolean).join(' + ')}`);
    } else toast.error('No se encontró el producto del pedido en el catálogo.');
    if (result.missing?.length) toast.warning(`Sin producto en catálogo: ${result.missing.join(', ')}`);
    await loadStock(orders);
  };

  useEffect(() => { 
    load(); 
  }, [status2Filter]);

  useEffect(() => {
    if (search && search.trim()) {
      load();
    }
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
  const productFilterBaseOrders = useMemo(() => {
    return orders.filter(o => {
      if (role === 'PROVEEDOR') {
        const providerList = o.provider_emails_list || '';
        const myEmailLower = myEmail.toLowerCase();
        const isMine = providerList.toLowerCase().includes(myEmailLower);
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
  // ✏️ Editar productos / 🔗 fusionar pedidos del mismo cliente.
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
  const printThermal = (ordersOverride?: any[]) => {
    const selected = ordersOverride ?? getSelectedOrders();
    if (selected.length === 0) {
      toast.error('Seleccioná pedidos primero');
      return;
    }

    let allTicketsHtml = '';

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

      allTicketsHtml += `
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
      `;
    }

    const thermalHtml = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Guías Térmicas</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        @page {
          size: 80mm auto;
          margin: 0mm;
        }
        
        @media print {
          html, body {
            margin: 0;
            padding: 0;
            width: 80mm;
            background: white;
          }
          .thermal-ticket {
            page-break-after: always;
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
            width: 80mm;
            margin: 0 auto 10px auto;
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
                    new QRCode(el, { text: url, width: 120, height: 120 });
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
    toast.success(`${selected.length} ticket(s) listos para imprimir en térmica`);
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
              <div key={i} className="rounded-xl border border-amber-500/20 bg-black/20 p-3">
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
        <select className={pillInputCls + " !w-auto min-w-[150px]"} value={status2Filter} onChange={e => setStatus2Filter(e.target.value)}>
          <option value="PENDIENTES">📋 Pendientes</option>
          <option value="CON_GUIA">✅ Con guía generada</option>
          <option value="TODOS">📦 Todos</option>
        </select>
        
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
              ✏️ Editar productos
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
          </>
        )}
      </div>

      {/* Tabla */}
      <div className="overflow-auto rounded-2xl border border-slate-700/80 bg-[#101827] shadow-2xl">
        <table className="w-full min-w-[1740px] text-sm [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3">
          <thead className="bg-[#070b18] sticky top-0 z-10">
            <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-700/80">
              <th className="w-[40px] text-center">
                <input type="checkbox" checked={selectedIds.size === visibleOrders.length && visibleOrders.length > 0}
                  onChange={() => selectedIds.size === visibleOrders.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(visibleOrders.map(o => o.id)))} />
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
              <th>Estado 2</th>
              <th>Guía</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {visibleOrders.map(o => (
              <tr key={o.id} className="hover:bg-slate-800/45 transition-colors">
                <td className="text-center">
                  <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                 </td>
                <td className="text-xs whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('es-PY')}</td>
                <td className="text-xs font-bold">{o.order_number || o.id.slice(0, 8)}</td>
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
                        ) : canApplyStock ? (
                          <button
                            className="nav-btn !px-2 !py-1 !text-[11px] !bg-orange-500/20 !text-orange-200 border border-orange-400/40"
                            disabled={applyingStockId === o.id}
                            onClick={() => void applyStock(o)}
                          >
                            {applyingStockId === o.id ? 'Bajando...' : '📦 Bajar stock'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-amber-300">Stock sin descontar</span>
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
                <td className="text-xs">
                  <select className="bg-[#070b18] border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-blue-400" value={o.status2 || '--'}
                    onChange={e => updateStatus2(o.id, e.target.value)}>
                    {state2Opts.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                 </td>
                <td className="text-xs">
                  <div className="flex gap-1">
                    <button className="nav-btn px-2 py-1 text-[10px]" onClick={() => orderTools.openEditor(o)} title="Editar productos, cantidades y precios">✏️</button>
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
                <td colSpan={14} className="text-center text-muted-foreground py-8">Sin pedidos para mostrar</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
