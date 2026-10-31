import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const nf = (value: number) =>
  new Intl.NumberFormat('es-PY').format(Math.round(Number(value || 0)));

const norm = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const DELIVERED_STATES = new Set(['entregado', 'encomienda entregada']);
const CANCEL_STATES = new Set([
  'cancelado',
  'rechazado',
  'rechazado en el lugar',
  'no desea',
  'cancelo por whatsapp',
]);

const todayPY = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const firstDayOfMonth = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
};

const inRange = (date: string | null | undefined, from: string, to: string) => {
  if (!date) return false;
  const day = String(date).slice(0, 10);
  return day >= from && day <= to;
};

const isDelivered = (order: any) => DELIVERED_STATES.has(norm(order?.status || order?.estado_1));
const isSettled = (order: any) => norm(order?.status2 || order?.estado_2) === 'rendido';
const isCancelled = (order: any) => CANCEL_STATES.has(norm(order?.status || order?.estado_1));

const getSellerEmail = (order: any) =>
  normalizeEmail(
    order?.created_by ||
      order?.seller_email ||
      order?.vendedor_email ||
      order?.created_by_email ||
      order?.user_email,
  );

const getDeliveryEmail = (order: any) =>
  normalizeEmail(
    order?.assigned_delivery ||
      order?.delivery_email ||
      order?.assigned_to ||
      order?.delivery,
  );

const safeItems = (order: any): any[] => {
  try {
    const parsed =
      typeof order?.items_json === 'string'
        ? JSON.parse(order.items_json)
        : order?.items_json;

    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (error) {
    console.error('No se pudo leer items_json:', error);
  }

  return [
    {
      sku:
        order?.sku ||
        order?.product_sku ||
        order?.producto_sku ||
        order?.codigo ||
        order?.product_code ||
        '',
      product_id: order?.product_id || order?.producto_id || order?.productId || '',
      title: order?.product_title || order?.title || 'Producto',
      qty: order?.pack_qty || order?.quantity || order?.qty || order?.cantidad || 1,
      sale_gs: order?.unit_price_gs || order?.price_gs || 0,
    },
  ];
};

const itemQty = (item: any) =>
  Math.max(1, Number(item?.qty || item?.quantity || item?.pack_qty || item?.cantidad || 1));

const itemSku = (item: any) =>
  String(item?.sku || item?.product_sku || item?.producto_sku || item?.codigo || '').trim();

const itemProductId = (item: any) =>
  String(item?.product_id || item?.producto_id || item?.productId || '').trim();


const itemSaleValue = (item: any, product?: ProductRow) => {
  const qty = itemQty(item);
  const unitPrice = Number(
    item?.sale_gs ||
      item?.unit_price_gs ||
      item?.price_gs ||
      item?.precio_unitario ||
      item?.precio ||
      product?.suggested_price_gs ||
      product?.provider_price_gs ||
      0,
  );
  return Math.max(0, unitPrice * qty);
};

interface OrderRow {
  id: string;
  created_at: string;
  assigned_at?: string | null;
  delivered_at?: string | null;
  total_gs?: number | null;
  delivery_gs?: number | null;
  delivery_fee_gs?: number | null;
  commission_gs?: number | null;
  status?: string | null;
  status2?: string | null;
  city?: string | null;
  created_by?: string | null;
  assigned_delivery?: string | null;
  provider_email?: string | null;
  provider_emails_list?: string | null;
  items_json?: any;
  commission_paid?: boolean | null;
  paid_at?: string | null;
}

interface ProductRow {
  id: string;
  title: string;
  sku: string | null;
  image_url: string | null;
  provider_email: string | null;
  provider_price_gs?: number | null;
  suggested_price_gs?: number | null;
  real_cost_gs?: number | null;
}

interface ProfileRow {
  email: string;
  name: string | null;
  logo_url: string | null;
  phone?: string | null;
  role?: string | null;
}

interface DeliveryStockRow {
  id: string;
  delivery_email: string;
  product_id: string;
  quantity: number;
}

interface CommissionRequestRow {
  id: string;
  vendor_email: string | null;
  provider_email: string | null;
  amount_gs: number | null;
  status: string | null;
  requested_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  meta_json?: any;
}

const parseProviderEmailList = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(normalizeEmail).filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(normalizeEmail).filter(Boolean);
    } catch {}

    return value
      .split(',')
      .map(normalizeEmail)
      .filter(Boolean);
  }

  return [];
};

const parseRequestOrderIds = (request: CommissionRequestRow): string[] => {
  const rawMeta = request?.meta_json;
  let meta: any = rawMeta;

  if (typeof rawMeta === 'string') {
    try {
      meta = JSON.parse(rawMeta);
    } catch {
      meta = null;
    }
  }

  const rawIds =
    meta?.order_ids ||
    meta?.orders ||
    (request as any)?.order_ids ||
    (request as any)?.pedido_ids ||
    [];

  if (Array.isArray(rawIds)) {
    return rawIds
      .map((value: any) =>
        typeof value === 'object' ? value?.id || value?.order_id : value,
      )
      .filter(Boolean)
      .map(String);
  }

  if (typeof rawIds === 'string') {
    try {
      const parsed = JSON.parse(rawIds);
      if (Array.isArray(parsed)) {
        return parsed
          .map((value: any) =>
            typeof value === 'object' ? value?.id || value?.order_id : value,
          )
          .filter(Boolean)
          .map(String);
      }
    } catch {}

    return rawIds
      .split(',')
      .map((value: string) => value.trim())
      .filter(Boolean);
  }

  return [];
};

type Tone = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan';

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'blue',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: string;
  tone?: Tone;
}) {
  const tones: Record<Tone, string> = {
    blue: 'from-blue-500/20 to-cyan-500/5 border-blue-500/25',
    emerald: 'from-emerald-500/20 to-teal-500/5 border-emerald-500/25',
    amber: 'from-amber-500/20 to-orange-500/5 border-amber-500/25',
    rose: 'from-rose-500/20 to-red-500/5 border-rose-500/25',
    violet: 'from-violet-500/20 to-fuchsia-500/5 border-violet-500/25',
    cyan: 'from-cyan-500/20 to-blue-500/5 border-cyan-500/25',
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${tones[tone]} p-4 shadow-xl`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            {title}
          </div>
          <div className="mt-2 text-2xl font-black text-white md:text-3xl">{value}</div>
          {subtitle && <div className="mt-2 text-xs font-bold text-slate-400">{subtitle}</div>}
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/50 text-xl">
          {icon}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, logo }: { name: string; logo?: string | null }) {
  if (logo) {
    return <img src={logo} alt={name} className="h-12 w-12 rounded-full border border-white/15 object-cover" />;
  }

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'US';

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-slate-800 font-black text-white">
      {initials}
    </div>
  );
}


const SUPABASE_PAGE_SIZE = 1000;

// Todos los pedidos visibles para el usuario, en páginas pedidas en paralelo.
const fetchAllOrdersPaged = () =>
  fetchAllRows<OrderRow>('orders', (q) => q.order('created_at', { ascending: true }));

const fetchCommissionRequestsPaged = async () => {
  const rows: CommissionRequestRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('commission_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) return { data: rows, error };

    const page = (data || []) as CommissionRequestRow[];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return { data: rows, error: null as any };
};

type DashboardCache = {
  email: string;
  allOrders: OrderRow[];
  products: ProductRow[];
  profiles: ProfileRow[];
  deliveryStocks: DeliveryStockRow[];
  deliveryRates: Record<string, number>;
  commissionRequests: CommissionRequestRow[];
};

// Se conserva mientras la app está abierta: volver al Dashboard muestra los
// datos al instante y se actualizan en segundo plano.
let dashboardCache: DashboardCache | null = null;

export default function Dashboard() {
  const { profile } = useAuth();
  const role = norm(profile?.role).toUpperCase();
  const email = normalizeEmail(profile?.email);

  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(todayPY());
  const cached = dashboardCache?.email === email ? dashboardCache : null;
  const [allOrders, setAllOrders] = useState<OrderRow[]>(cached?.allOrders || []);
  const [products, setProducts] = useState<ProductRow[]>(cached?.products || []);
  const [profiles, setProfiles] = useState<ProfileRow[]>(cached?.profiles || []);
  const [deliveryStocks, setDeliveryStocks] = useState<DeliveryStockRow[]>(cached?.deliveryStocks || []);
  const [deliveryRates, setDeliveryRates] = useState<Record<string, number>>(cached?.deliveryRates || {});
  const [commissionRequests, setCommissionRequests] = useState<CommissionRequestRow[]>(cached?.commissionRequests || []);
  const [loading, setLoading] = useState(false);

  // Pedidos del período (creados, asignados o entregados entre las fechas),
  // calculados desde todos los pedidos: cambiar fechas no vuelve a descargar.
  const orders = useMemo(
    () =>
      allOrders.filter(
        (order: any) =>
          inRange(order.created_at, dateFrom, dateTo) ||
          inRange(order.assigned_at, dateFrom, dateTo) ||
          inRange(order.delivered_at, dateFrom, dateTo)
      ),
    [allOrders, dateFrom, dateTo]
  );

  const isAdmin = role === 'ADMIN' || role === 'ADMINISTRADOR';
  const isProvider = role === 'PROVEEDOR' || role === 'PROVIDER';
  const isSeller = role === 'VENDEDOR' || role === 'SELLER';
  const isDeliveryUser = role === 'DELIVERY' || role === 'REPARTIDOR';
  const canSeeGlobalPanels = isAdmin || isProvider;

  const loadCommissionRequests = async () => {
    const { data, error } = await fetchCommissionRequestsPaged();

    if (error) {
      console.error('Error cargando commission_requests:', error);
      return [] as CommissionRequestRow[];
    }

    return (data || []) as CommissionRequestRow[];
  };

  const loadDashboard = async () => {
    // Con datos en caché se actualiza en segundo plano, sin pantalla de carga.
    const silent = Boolean(dashboardCache?.email === email && dashboardCache.allOrders.length);
    if (!silent) setLoading(true);

    const [
      allOrdersRes,
      productsRes,
      profilesRes,
      stocksRes,
      ratesRes,
      requests,
    ] = await Promise.all([
      // Sin filtro de fecha y SIN límite de 1.000 filas.
      // Se usa para el período elegido, comisiones disponibles y pendientes a rendir.
      fetchAllOrdersPaged(),
      supabase.from('products').select('*'),
      supabase.from('profiles').select('email, name, logo_url, phone, role'),
      supabase.from('delivery_stock').select('*'),
      supabase.from('delivery_fees').select('*'),
      loadCommissionRequests(),
    ]);

    const rateMap: Record<string, number> = {};
    (ratesRes.data || []).forEach((rate: any) => {
      if (rate?.city) rateMap[norm(rate.city)] = Number(rate.fee_gs || 0);
    });

    const errors = [
      allOrdersRes.error,
      productsRes.error,
      profilesRes.error,
      stocksRes.error,
      ratesRes.error,
    ].filter(Boolean);

    if (errors.length) console.error('Errores cargando Dashboard:', errors);

    const next: DashboardCache = {
      email,
      allOrders: (allOrdersRes.data || []) as OrderRow[],
      products: (productsRes.data || []) as ProductRow[],
      profiles: (profilesRes.data || []) as ProfileRow[],
      deliveryStocks: (stocksRes.data || []) as DeliveryStockRow[],
      deliveryRates: rateMap,
      commissionRequests: requests,
    };

    // Ante un error no se pisan los datos buenos que ya había.
    if (!allOrdersRes.error) dashboardCache = next;

    setAllOrders(next.allOrders);
    setProducts(next.products);
    setProfiles(next.profiles);
    setDeliveryStocks(next.deliveryStocks);
    setDeliveryRates(next.deliveryRates);
    setCommissionRequests(next.commissionRequests);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboard();
  }, [email]);

  const profileMap = useMemo(() => {
    const map: Record<string, ProfileRow> = {};
    profiles.forEach((item) => {
      map[normalizeEmail(item.email)] = item;
    });
    return map;
  }, [profiles]);

  const productById = useMemo(() => {
    const map = new Map<string, ProductRow>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const productBySku = useMemo(() => {
    const map = new Map<string, ProductRow>();
    products.forEach((product) => {
      if (product.sku) map.set(String(product.sku).trim(), product);
    });
    return map;
  }, [products]);

  const getOrderProviders = (order: OrderRow): string[] => {
    const providerSet = new Set<string>();

    safeItems(order).forEach((item) => {
      const product = productById.get(itemProductId(item)) || productBySku.get(itemSku(item));
      const providerEmail = normalizeEmail(product?.provider_email);
      if (providerEmail) providerSet.add(providerEmail);
    });

    // Misma regla usada en Pago/Solicitud de comisiones:
    // provider_emails_list solamente se usa cuando no se identificó proveedor por SKU.
    if (providerSet.size === 0) {
      parseProviderEmailList(order.provider_emails_list).forEach((providerEmail) => {
        providerSet.add(providerEmail);
      });
    }

    if (providerSet.size === 0) {
      const directProvider = normalizeEmail(order.provider_email);
      if (directProvider) providerSet.add(directProvider);
    }

    return Array.from(providerSet);
  };

  const orderHasProviderProduct = (order: OrderRow, providerEmail: string) =>
    getOrderProviders(order).includes(normalizeEmail(providerEmail));

  const roleFilteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (isSeller) return getSellerEmail(order) === email;
      if (isDeliveryUser) return getDeliveryEmail(order) === email;
      if (isProvider) return orderHasProviderProduct(order, email);
      return true;
    });
  }, [orders, isSeller, isDeliveryUser, isProvider, email, productById, productBySku]);

  const roleFilteredAllOrders = useMemo(() => {
    return allOrders.filter((order) => {
      if (isSeller) return getSellerEmail(order) === email;
      if (isDeliveryUser) return getDeliveryEmail(order) === email;
      if (isProvider) return orderHasProviderProduct(order, email);
      return true;
    });
  }, [allOrders, isSeller, isDeliveryUser, isProvider, email, productById, productBySku]);

  const createdOrders = useMemo(
    () => roleFilteredOrders.filter((order) => inRange(order.created_at, dateFrom, dateTo)),
    [roleFilteredOrders, dateFrom, dateTo],
  );

  const deliveredOrders = useMemo(
    () =>
      roleFilteredOrders.filter(
        (order) => isDelivered(order) && inRange(order.delivered_at || order.created_at, dateFrom, dateTo),
      ),
    [roleFilteredOrders, dateFrom, dateTo],
  );

  const settledDeliveredOrders = useMemo(
    () => deliveredOrders.filter((order) => isSettled(order)),
    [deliveredOrders],
  );

  const allDeliveredOrders = useMemo(
    () => roleFilteredAllOrders.filter((order) => isDelivered(order)),
    [roleFilteredAllOrders],
  );

  const allSettledDeliveredOrders = useMemo(
    () => allDeliveredOrders.filter((order) => isSettled(order)),
    [allDeliveredOrders],
  );

  const getProviderShare = (order: OrderRow, providerEmail: string) => {
    const target = normalizeEmail(providerEmail);
    const items = safeItems(order);

    let allValue = 0;
    let providerValue = 0;
    let allUnits = 0;
    let providerUnits = 0;

    items.forEach((item) => {
      const product = productById.get(itemProductId(item)) || productBySku.get(itemSku(item));
      const qty = itemQty(item);
      const value = itemSaleValue(item, product);
      const belongs = normalizeEmail(product?.provider_email || order.provider_email) === target;

      allValue += value;
      allUnits += qty;

      if (belongs) {
        providerValue += value;
        providerUnits += qty;
      }
    });

    if (allValue > 0) return Math.min(1, providerValue / allValue);
    if (allUnits > 0) return Math.min(1, providerUnits / allUnits);
    return normalizeEmail(order.provider_email) === target ? 1 : 0;
  };

  const pendingRequestsBySellerProvider = useMemo(() => {
    const map = new Map<string, number>();

    commissionRequests.forEach((request) => {
      if (String(request.status || '').toUpperCase().trim() !== 'PENDIENTE') return;

      const sellerEmail = normalizeEmail(request.vendor_email);
      const providerEmail = normalizeEmail(request.provider_email);
      if (!sellerEmail || !providerEmail) return;

      const key = `${sellerEmail}::${providerEmail}`;
      map.set(key, (map.get(key) || 0) + Number(request.amount_gs || 0));
    });

    return map;
  }, [commissionRequests]);

  const approvedRequestsBySellerProvider = useMemo(() => {
    const map = new Map<string, number>();

    commissionRequests.forEach((request) => {
      if (String(request.status || '').toUpperCase().trim() !== 'APROBADO') return;

      const sellerEmail = normalizeEmail(request.vendor_email);
      const providerEmail = normalizeEmail(request.provider_email);
      if (!sellerEmail || !providerEmail) return;

      const key = `${sellerEmail}::${providerEmail}`;
      map.set(key, (map.get(key) || 0) + Number(request.amount_gs || 0));
    });

    return map;
  }, [commissionRequests]);

  const sellerCommissionRows = useMemo(() => {
    if (!canSeeGlobalPanels && !isSeller) return [];

    type SellerCommissionAccumulator = {
      email: string;
      name: string;
      logo: string | null;
      orders: number;
      units: number;
      sales: number;
      generated: number;
      grossAvailable: number;
      requested: number;
      paid: number;
      products: Set<string>;
      providerGross: Map<string, number>;
      providerPending: Map<string, number>;
      providerPaid: Map<string, number>;
    };

    const map = new Map<string, SellerCommissionAccumulator>();

    // IMPORTANTE:
    // Se recorren TODOS los pedidos históricos, sin el selector de fechas.
    // Esto replica la disponibilidad real de Solicitud/Pago de comisiones.
    allOrders.forEach((order) => {
      const sellerEmail = getSellerEmail(order);
      if (!sellerEmail) return;
      if (isSeller && sellerEmail !== email) return;

      const status = norm(order.status || (order as any).estado_1);
      const status2 = norm(order.status2 || (order as any).estado_2);

      const isEligible =
        (status === 'entregado' || status === 'encomienda entregada') &&
        status2 === 'rendido';

      if (!isEligible) return;

      const commission = Number(order.commission_gs || 0);
      if (commission <= 0) return;

      const providers = getOrderProviders(order);
      if (providers.length === 0) return;
      if (isProvider && !providers.includes(email)) return;

      const perProvider = commission / providers.length;
      const info = profileMap[sellerEmail];

      const current = map.get(sellerEmail) || {
        email: sellerEmail,
        name: info?.name || sellerEmail,
        logo: info?.logo_url || null,
        orders: 0,
        units: 0,
        sales: 0,
        generated: 0,
        grossAvailable: 0,
        requested: 0,
        paid: 0,
        products: new Set<string>(),
        providerGross: new Map<string, number>(),
        providerPending: new Map<string, number>(),
        providerPaid: new Map<string, number>(),
      };

      let relevantUnits = 0;
      let relevantSales = 0;

      safeItems(order).forEach((item) => {
        const product = productById.get(itemProductId(item)) || productBySku.get(itemSku(item));
        const itemProvider = normalizeEmail(product?.provider_email);
        const belongs = !isProvider || itemProvider === email || providers.includes(email);
        if (!belongs) return;

        relevantUnits += itemQty(item);
        relevantSales += itemSaleValue(item, product);
        if (product?.title) current.products.add(product.title);
      });

      current.orders += 1;
      current.units += relevantUnits;
      current.sales +=
        relevantSales > 0
          ? relevantSales
          : isProvider
            ? Number(order.total_gs || 0) / providers.length
            : Number(order.total_gs || 0);

      const visibleProviders = isProvider ? [email] : providers;
      const visibleCommission = isProvider ? perProvider : commission;
      current.generated += visibleCommission;

      visibleProviders.forEach((providerEmail) => {
        const key = `${sellerEmail}::${providerEmail}`;
        const pendingAmount = pendingRequestsBySellerProvider.get(key) || 0;
        const approvedAmount = approvedRequestsBySellerProvider.get(key) || 0;

        current.providerPending.set(providerEmail, pendingAmount);
        current.providerPaid.set(providerEmail, approvedAmount);

        // Exactamente igual que Solicitud de comisiones:
        // solo las órdenes NO pagadas forman el saldo rendido/disponible.
        if (!order.commission_paid) {
          current.providerGross.set(
            providerEmail,
            (current.providerGross.get(providerEmail) || 0) + perProvider,
          );
        }
      });

      map.set(sellerEmail, current);
    });

    // También deben aparecer vendedores que tengan solicitudes históricas,
    // aunque todos sus pedidos ya estén marcados commission_paid.
    commissionRequests.forEach((request) => {
      const sellerEmail = normalizeEmail(request.vendor_email);
      const providerEmail = normalizeEmail(request.provider_email);
      if (!sellerEmail || !providerEmail) return;
      if (isSeller && sellerEmail !== email) return;
      if (isProvider && providerEmail !== email) return;

      const status = String(request.status || '').toUpperCase().trim();
      if (status !== 'PENDIENTE' && status !== 'APROBADO') return;

      const info = profileMap[sellerEmail];
      const current = map.get(sellerEmail) || {
        email: sellerEmail,
        name: info?.name || sellerEmail,
        logo: info?.logo_url || null,
        orders: 0,
        units: 0,
        sales: 0,
        generated: 0,
        grossAvailable: 0,
        requested: 0,
        paid: 0,
        products: new Set<string>(),
        providerGross: new Map<string, number>(),
        providerPending: new Map<string, number>(),
        providerPaid: new Map<string, number>(),
      };

      const key = `${sellerEmail}::${providerEmail}`;
      if (status === 'PENDIENTE') {
        current.providerPending.set(
          providerEmail,
          pendingRequestsBySellerProvider.get(key) || 0,
        );
      }

      if (status === 'APROBADO') {
        current.providerPaid.set(
          providerEmail,
          approvedRequestsBySellerProvider.get(key) || 0,
        );
      }

      map.set(sellerEmail, current);
    });

    return Array.from(map.values())
      .map((row) => {
        const providerKeys = new Set<string>([
          ...row.providerGross.keys(),
          ...row.providerPending.keys(),
          ...row.providerPaid.keys(),
        ]);

        let grossAvailable = 0;
        let requested = 0;
        let paid = 0;
        let available = 0;

        providerKeys.forEach((providerEmail) => {
          const gross = row.providerGross.get(providerEmail) || 0;
          const pending = row.providerPending.get(providerEmail) || 0;
          const approved = row.providerPaid.get(providerEmail) || 0;

          grossAvailable += gross;
          requested += pending;
          paid += approved;
          available += Math.max(0, gross - pending);
        });

        return {
          email: row.email,
          name: row.name,
          logo: row.logo,
          orders: row.orders,
          units: row.units,
          sales: row.sales,
          // Histórico mostrado de forma consistente:
          // saldo no pagado + solicitudes aprobadas.
          generated: grossAvailable + paid,
          available,
          requested,
          paid,
          products: Array.from(row.products).sort(),
        };
      })
      .filter(
        (row) =>
          row.generated > 0 ||
          row.available > 0 ||
          row.requested > 0 ||
          row.paid > 0,
      )
      .sort((a, b) => b.available - a.available || b.generated - a.generated);
  }, [
    canSeeGlobalPanels,
    isSeller,
    isProvider,
    email,
    allOrders,
    commissionRequests,
    profileMap,
    productById,
    productBySku,
    pendingRequestsBySellerProvider,
    approvedRequestsBySellerProvider,
  ]);

  const commissionSummary = useMemo(() => {
    return sellerCommissionRows.reduce(
      (sum, row) => ({
        generated: sum.generated + row.generated,
        available: sum.available + row.available,
        requested: sum.requested + row.requested,
        paid: sum.paid + row.paid,
      }),
      { generated: 0, available: 0, requested: 0, paid: 0 },
    );
  }, [sellerCommissionRows]);

  const pendingRenderByDelivery = useMemo(() => {
    const map = new Map<
      string,
      { email: string; name: string; logo: string | null; orders: number; money: number }
    >();

    roleFilteredAllOrders
      .filter((order) => isDelivered(order) && !isSettled(order))
      .forEach((order) => {
        const deliveryEmail = getDeliveryEmail(order);
        if (!deliveryEmail) return;
        const providerShare = isProvider ? getProviderShare(order, email) : 1;
        if (providerShare <= 0) return;

        const info = profileMap[deliveryEmail];
        const feeStored = Number(order.delivery_fee_gs || order.delivery_gs || 0);
        const fee = feeStored > 0 ? feeStored : Number(deliveryRates[norm(order.city)] || 0);
        const amount = Math.max(0, (Number(order.total_gs || 0) - fee) * providerShare);
        const current = map.get(deliveryEmail) || {
          email: deliveryEmail,
          name: info?.name || deliveryEmail,
          logo: info?.logo_url || null,
          orders: 0,
          money: 0,
        };

        current.orders += 1;
        current.money += amount;
        map.set(deliveryEmail, current);
      });

    return Array.from(map.values()).sort((a, b) => b.money - a.money);
  }, [
    roleFilteredAllOrders,
    profileMap,
    deliveryRates,
    isProvider,
    email,
    productById,
    productBySku,
  ]);

  const deliveryStockGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        email: string;
        name: string;
        logo: string | null;
        total: number;
        products: { id: string; title: string; sku: string; image: string | null; quantity: number }[];
      }
    >();

    deliveryStocks.forEach((stock) => {
      const deliveryEmail = normalizeEmail(stock.delivery_email);
      if (isDeliveryUser && deliveryEmail !== email) return;

      const product = productById.get(stock.product_id);
      if (!product || Number(stock.quantity || 0) <= 0) return;
      if (isProvider && normalizeEmail(product.provider_email) !== email) return;

      const info = profileMap[deliveryEmail];
      const current = map.get(deliveryEmail) || {
        email: deliveryEmail,
        name: info?.name || deliveryEmail,
        logo: info?.logo_url || null,
        total: 0,
        products: [],
      };

      current.total += Number(stock.quantity || 0);
      current.products.push({
        id: product.id,
        title: product.title,
        sku: product.sku || '',
        image: product.image_url || null,
        quantity: Number(stock.quantity || 0),
      });
      map.set(deliveryEmail, current);
    });

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        products: group.products.sort((a, b) => b.quantity - a.quantity),
      }))
      .sort((a, b) => b.total - a.total);
  }, [deliveryStocks, productById, profileMap, isDeliveryUser, isProvider, email]);

  const topSellers = useMemo(() => {
    if (!canSeeGlobalPanels) return [];

    const map = new Map<
      string,
      { email: string; name: string; logo: string | null; delivered: number; revenue: number; units: number }
    >();

    deliveredOrders.forEach((order) => {
      const sellerEmail = getSellerEmail(order);
      if (!sellerEmail) return;
      const providerShare = isProvider ? getProviderShare(order, email) : 1;
      if (providerShare <= 0) return;

      const info = profileMap[sellerEmail];
      const current = map.get(sellerEmail) || {
        email: sellerEmail,
        name: info?.name || sellerEmail,
        logo: info?.logo_url || null,
        delivered: 0,
        revenue: 0,
        units: 0,
      };

      let relevantUnits = 0;
      let relevantRevenue = 0;

      safeItems(order).forEach((item) => {
        const product = productById.get(itemProductId(item)) || productBySku.get(itemSku(item));
        const belongs = !isProvider || normalizeEmail(product?.provider_email || order.provider_email) === email;
        if (!belongs) return;
        relevantUnits += itemQty(item);
        relevantRevenue += itemSaleValue(item, product);
      });

      current.delivered += 1;
      current.revenue += relevantRevenue > 0 ? relevantRevenue : Number(order.total_gs || 0) * providerShare;
      current.units += relevantUnits;
      map.set(sellerEmail, current);
    });

    return Array.from(map.values())
      .sort((a, b) => b.delivered - a.delivered || b.revenue - a.revenue)
      .slice(0, 10);
  }, [canSeeGlobalPanels, deliveredOrders, isProvider, email, profileMap, productById, productBySku]);

  const topProducts = useMemo(() => {
    type ProductTopRow = {
      key: string;
      id: string;
      sku: string;
      title: string;
      image: string | null;
      soldUnits: number;
      deliveredUnits: number;
      soldAmount: number;
      deliveredAmount: number;
    };

    const map = new Map<string, ProductTopRow>();

    const addOrder = (order: OrderRow, delivered: boolean) => {
      if (!delivered && isCancelled(order)) return;

      safeItems(order).forEach((item) => {
        const product = productById.get(itemProductId(item)) || productBySku.get(itemSku(item));
        const providerEmail = normalizeEmail(product?.provider_email || order.provider_email);

        if (isProvider && providerEmail !== email) return;

        const sku = itemSku(item) || product?.sku || '';
        const productId = itemProductId(item) || product?.id || '';
        const key = productId || sku || String(item?.title || 'Producto');
        const qty = itemQty(item);
        const amount = itemSaleValue(item, product);

        const current = map.get(key) || {
          key,
          id: product?.id || productId,
          sku: product?.sku || sku,
          title: product?.title || String(item?.title || sku || 'Producto'),
          image: product?.image_url || null,
          soldUnits: 0,
          deliveredUnits: 0,
          soldAmount: 0,
          deliveredAmount: 0,
        };

        if (delivered) {
          current.deliveredUnits += qty;
          current.deliveredAmount += amount;
        } else {
          current.soldUnits += qty;
          current.soldAmount += amount;
        }

        map.set(key, current);
      });
    };

    createdOrders.forEach((order) => addOrder(order, false));
    deliveredOrders.forEach((order) => addOrder(order, true));

    return Array.from(map.values())
      .sort(
        (a, b) =>
          b.soldUnits - a.soldUnits ||
          b.deliveredUnits - a.deliveredUnits ||
          b.soldAmount - a.soldAmount,
      )
      .slice(0, 10);
  }, [createdOrders, deliveredOrders, productById, productBySku, isProvider, email]);

  const topCities = useMemo(() => {
    type CityTopRow = {
      city: string;
      soldOrders: number;
      deliveredOrders: number;
      soldUnits: number;
      deliveredUnits: number;
      soldAmount: number;
      deliveredAmount: number;
    };

    const map = new Map<string, CityTopRow>();

    const relevantItemTotals = (order: OrderRow) => {
      let units = 0;
      let amount = 0;

      safeItems(order).forEach((item) => {
        const product = productById.get(itemProductId(item)) || productBySku.get(itemSku(item));
        const providerEmail = normalizeEmail(product?.provider_email || order.provider_email);
        if (isProvider && providerEmail !== email) return;

        units += itemQty(item);
        amount += itemSaleValue(item, product);
      });

      if (!isProvider && amount <= 0) amount = Number(order.total_gs || 0);
      return { units, amount };
    };

    createdOrders.forEach((order) => {
      if (isCancelled(order)) return;

      const city = String(order.city || 'Sin ciudad').trim() || 'Sin ciudad';
      const totals = relevantItemTotals(order);
      if (isProvider && totals.units <= 0) return;

      const current = map.get(norm(city)) || {
        city,
        soldOrders: 0,
        deliveredOrders: 0,
        soldUnits: 0,
        deliveredUnits: 0,
        soldAmount: 0,
        deliveredAmount: 0,
      };

      current.soldOrders += 1;
      current.soldUnits += totals.units;
      current.soldAmount += totals.amount;
      map.set(norm(city), current);
    });

    deliveredOrders.forEach((order) => {
      const city = String(order.city || 'Sin ciudad').trim() || 'Sin ciudad';
      const totals = relevantItemTotals(order);
      if (isProvider && totals.units <= 0) return;

      const current = map.get(norm(city)) || {
        city,
        soldOrders: 0,
        deliveredOrders: 0,
        soldUnits: 0,
        deliveredUnits: 0,
        soldAmount: 0,
        deliveredAmount: 0,
      };

      current.deliveredOrders += 1;
      current.deliveredUnits += totals.units;
      current.deliveredAmount += totals.amount;
      map.set(norm(city), current);
    });

    return Array.from(map.values())
      .sort(
        (a, b) =>
          b.soldOrders - a.soldOrders ||
          b.deliveredOrders - a.deliveredOrders ||
          b.soldAmount - a.soldAmount,
      )
      .slice(0, 10);
  }, [createdOrders, deliveredOrders, productById, productBySku, isProvider, email]);

  const kpis = useMemo(() => {
    const sold = createdOrders.reduce((sum, order) => sum + Number(order.total_gs || 0), 0);
    const deliveredValue = deliveredOrders.reduce((sum, order) => sum + Number(order.total_gs || 0), 0);
    const canceled = createdOrders.filter(isCancelled).length;
    const pendingMoney = pendingRenderByDelivery.reduce((sum, row) => sum + row.money, 0);
    const pendingOrders = pendingRenderByDelivery.reduce((sum, row) => sum + row.orders, 0);

    return {
      orders: createdOrders.length,
      sold,
      delivered: deliveredOrders.length,
      deliveredValue,
      canceled,
      settled: settledDeliveredOrders.length,
      commissions: commissionSummary.generated,
      availableCommission: commissionSummary.available,
      requestedCommission: commissionSummary.requested,
      paidCommission: commissionSummary.paid,
      pendingMoney,
      pendingOrders,
    };
  }, [createdOrders, deliveredOrders, settledDeliveredOrders, commissionSummary, pendingRenderByDelivery]);

  const barData = useMemo(() => {
    const map: Record<string, number> = {};
    createdOrders.forEach((order) => {
      const day = order.created_at.slice(0, 10);
      map[day] = (map[day] || 0) + Number(order.total_gs || 0);
    });

    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date: date.slice(5), value }));
  }, [createdOrders]);

  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    createdOrders.forEach((order) => {
      const state = String(order.status || 'PENDIENTE').toUpperCase();
      map[state] = (map[state] || 0) + 1;
    });

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [createdOrders]);

  return (
    <div className="min-h-screen w-full bg-[#05070c] text-white">
      <div className="w-full max-w-none space-y-5 p-3 md:p-4 xl:p-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/80 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight md:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm font-semibold text-slate-400">
              Resumen de pedidos, rendiciones, vendedores y stock asignado.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-bold text-slate-400">
              Desde
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="mt-1 block rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none"
              />
            </label>
            <label className="text-xs font-bold text-slate-400">
              Hasta
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="mt-1 block rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none"
              />
            </label>
            <button
              onClick={loadDashboard}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? 'Cargando...' : 'Actualizar'}
            </button>
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
          canSeeGlobalPanels ? 'xl:grid-cols-4 2xl:grid-cols-6' : 'xl:grid-cols-4'
        }`}>
          <KpiCard title="Pedidos" value={nf(kpis.orders)} subtitle="Creados en el rango" icon="📦" tone="blue" />
          <KpiCard title="Entregados" value={nf(kpis.delivered)} subtitle={`${nf(kpis.deliveredValue)} Gs`} icon="✅" tone="emerald" />
          <KpiCard title="Disponible para cobrar" value={`${nf(kpis.availableCommission)} Gs`} subtitle="Rendido, sin solicitar ni pagar" icon="💵" tone="emerald" />
          <KpiCard title="Comisiones pagadas" value={`${nf(kpis.paidCommission)} Gs`} subtitle="Pagos finalizados" icon="✅" tone="cyan" />
          {canSeeGlobalPanels && (
            <>
              <KpiCard title="En solicitud" value={`${nf(kpis.requestedCommission)} Gs`} subtitle="Solicitudes con estado PENDIENTE" icon="⏳" tone="violet" />
              <KpiCard title="Pendiente a rendir" value={`${nf(kpis.pendingMoney)} Gs`} subtitle={`${nf(kpis.pendingOrders)} pedidos, delivery descontado`} icon="🧾" tone="amber" />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-black">Ventas por día</h2>
              <p className="text-xs font-semibold text-slate-400">Monto de pedidos creados</p>
            </div>
            {barData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" />
                  <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => nf(v)} />
                  <Tooltip
                    contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 12 }}
                    formatter={(value: number) => [`${nf(value)} Gs`, 'Ventas']}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[280px] items-center justify-center text-slate-500">Sin datos</div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-black">Estados de pedidos</h2>
              <p className="text-xs font-semibold text-slate-400">Distribución del rango elegido</p>
            </div>
            {pieData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[280px] items-center justify-center text-slate-500">Sin datos</div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-blue-500/20 bg-slate-950/70 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-black">📦 Top de productos vendidos y entregados</h2>
              <p className="text-xs font-semibold text-slate-400">
                Unidades del rango seleccionado.
                {isProvider ? ' Solo se consideran tus productos.' : ''}
              </p>
            </div>

            {topProducts.length ? (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="bg-slate-900/90 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Producto</th>
                      <th className="px-4 py-3 text-center">Vendido</th>
                      <th className="px-4 py-3 text-center">Entregado</th>
                      <th className="px-4 py-3 text-right">Monto vendido</th>
                      <th className="px-4 py-3 text-right">Monto entregado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-slate-950/40">
                    {topProducts.map((product, index) => (
                      <tr key={product.key} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-3 font-black text-blue-300">#{index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-11 w-11 overflow-hidden rounded-xl border border-white/10 bg-slate-900">
                              {product.image ? (
                                <img
                                  src={product.image}
                                  alt={product.title}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">📦</div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="max-w-[220px] truncate text-sm font-black text-white">
                                {product.title}
                              </div>
                              <div className="text-xs text-slate-500">
                                SKU: {product.sku || 'Sin SKU'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-lg font-black text-blue-300">
                          {nf(product.soldUnits)}
                        </td>
                        <td className="px-4 py-3 text-center text-lg font-black text-emerald-300">
                          {nf(product.deliveredUnits)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-black text-slate-300">
                          {nf(product.soldAmount)} Gs
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-black text-emerald-300">
                          {nf(product.deliveredAmount)} Gs
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
                No hay productos vendidos en este rango.
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-fuchsia-500/20 bg-slate-950/70 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-black">🏙️ Top de ciudades vendidas y entregadas</h2>
              <p className="text-xs font-semibold text-slate-400">
                Pedidos, unidades y montos del rango seleccionado.
                {isProvider ? ' Solo se consideran tus productos.' : ''}
              </p>
            </div>

            {topCities.length ? (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="bg-slate-900/90 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Ciudad</th>
                      <th className="px-4 py-3 text-center">Pedidos vendidos</th>
                      <th className="px-4 py-3 text-center">Pedidos entregados</th>
                      <th className="px-4 py-3 text-center">Unidades V/E</th>
                      <th className="px-4 py-3 text-right">Monto vendido</th>
                      <th className="px-4 py-3 text-right">Monto entregado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-slate-950/40">
                    {topCities.map((city, index) => (
                      <tr key={norm(city.city)} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-3 font-black text-fuchsia-300">#{index + 1}</td>
                        <td className="px-4 py-3 font-black text-white">{city.city}</td>
                        <td className="px-4 py-3 text-center text-lg font-black text-blue-300">
                          {nf(city.soldOrders)}
                        </td>
                        <td className="px-4 py-3 text-center text-lg font-black text-emerald-300">
                          {nf(city.deliveredOrders)}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-black text-slate-300">
                          {nf(city.soldUnits)} / {nf(city.deliveredUnits)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-black text-slate-300">
                          {nf(city.soldAmount)} Gs
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-black text-emerald-300">
                          {nf(city.deliveredAmount)} Gs
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
                No hay ciudades con ventas en este rango.
              </div>
            )}
          </section>
        </div>

        {canSeeGlobalPanels && (
          <section className="rounded-2xl border border-amber-500/20 bg-slate-950/70 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">🚚 Pedidos pendientes a rendir</h2>
                <p className="text-xs font-semibold text-slate-400">
                  Todos los entregados o encomiendas entregadas sin estado RENDIDO, sin aplicar el filtro de fechas. El monto ya descuenta el delivery.
                </p>
              </div>
              <div className="rounded-xl bg-amber-500/10 px-4 py-2 text-sm font-black text-amber-300">
                Total: {nf(kpis.pendingMoney)} Gs
              </div>
            </div>

            {pendingRenderByDelivery.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {pendingRenderByDelivery.map((delivery) => (
                  <div key={delivery.email} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={delivery.name} logo={delivery.logo} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-black text-white">{delivery.name}</div>
                        <div className="truncate text-xs text-slate-500">{delivery.email}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-800/80 p-3">
                        <div className="text-[10px] font-black uppercase text-slate-500">Pedidos</div>
                        <div className="mt-1 text-xl font-black">{nf(delivery.orders)}</div>
                      </div>
                      <div className="rounded-xl bg-amber-500/10 p-3">
                        <div className="text-[10px] font-black uppercase text-amber-400">A rendir</div>
                        <div className="mt-1 text-lg font-black text-amber-300">{nf(delivery.money)} Gs</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
                No hay pedidos pendientes a rendir.
              </div>
            )}
          </section>
        )}

        {canSeeGlobalPanels && (
          <section className="rounded-2xl border border-emerald-500/20 bg-slate-950/70 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">💰 Estado de comisiones por vendedor</h2>
                <p className="text-xs font-semibold text-slate-400">
                  CÁLCULO UNIFICADO V3 PAGINADO: Disponible = comisiones RENDIDAS no pagadas menos solicitudes PENDIENTES. Pagada = solicitudes APROBADAS. Sin filtro de fechas.
                  {isProvider ? ' Solo se muestran las comisiones correspondientes a tus productos.' : ''}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-300">
                Generado: {nf(kpis.commissions)} Gs
              </div>
            </div>

            {sellerCommissionRows.length ? (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full min-w-[1180px] text-left">
                  <thead className="bg-slate-900/90 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Vendedor</th>
                      <th className="px-4 py-3 text-center">Pedidos rendidos</th>
                      <th className="px-4 py-3 text-center">Unidades</th>
                      <th className="px-4 py-3 text-right">Venta correspondiente</th>
                      <th className="px-4 py-3 text-right">Generada</th>
                      <th className="px-4 py-3 text-right">Disponible</th>
                      <th className="px-4 py-3 text-right">En solicitud</th>
                      <th className="px-4 py-3 text-right">Pagada</th>
                      <th className="px-4 py-3">Productos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-slate-950/40">
                    {sellerCommissionRows.map((seller) => (
                      <tr key={seller.email} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={seller.name} logo={seller.logo} />
                            <div className="min-w-0">
                              <div className="truncate font-black text-white">{seller.name}</div>
                              <div className="truncate text-xs text-slate-500">{seller.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-lg font-black text-white">{nf(seller.orders)}</td>
                        <td className="px-4 py-3 text-center font-black text-cyan-300">{nf(seller.units)}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-200">{nf(seller.sales)} Gs</td>
                        <td className="px-4 py-3 text-right font-black text-slate-200">
                          {nf(seller.generated)} Gs
                        </td>
                        <td className="px-4 py-3 text-right text-lg font-black text-emerald-300">
                          {nf(seller.available)} Gs
                        </td>
                        <td className="px-4 py-3 text-right font-black text-amber-300">
                          {nf(seller.requested)} Gs
                        </td>
                        <td className="px-4 py-3 text-right font-black text-cyan-300">
                          {nf(seller.paid)} Gs
                        </td>
                        <td className="max-w-[360px] px-4 py-3">
                          <div className="line-clamp-2 text-xs font-semibold text-slate-400">
                            {seller.products.length ? seller.products.join(', ') : 'Sin producto identificado'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
                No hay comisiones disponibles, solicitadas o pagadas para mostrar.
              </div>
            )}
          </section>
        )}

        {canSeeGlobalPanels && (
          <section className="rounded-2xl border border-violet-500/20 bg-slate-950/70 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-black">🏆 Top de mejores vendedores</h2>
              <p className="text-xs font-semibold text-slate-400">
                Ordenados por entregas. Para proveedor solamente se consideran sus productos.
              </p>
            </div>

            {topSellers.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {topSellers.map((seller, index) => (
                  <div key={seller.email} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/15 text-sm font-black text-violet-300">
                      #{index + 1}
                    </div>
                    <Avatar name={seller.name} logo={seller.logo} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-black">{seller.name}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {nf(seller.delivered)} entregas · {nf(seller.units)} unidades
                      </div>
                      <div className="mt-1 text-sm font-black text-emerald-400">{nf(seller.revenue)} Gs</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
                No hay vendedores con entregas en este rango.
              </div>
            )}
          </section>
        )}

        {(canSeeGlobalPanels || isDeliveryUser) && (
          <section className="rounded-2xl border border-cyan-500/20 bg-slate-950/70 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-black">📦 Stock disponible por delivery</h2>
              <p className="text-xs font-semibold text-slate-400">
                Nombre del delivery, producto asignado y cantidad restante.
              </p>
            </div>

            {deliveryStockGroups.length ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {deliveryStockGroups.map((delivery) => (
                  <div key={delivery.email} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
                    <div className="flex items-center gap-3 border-b border-white/10 p-4">
                      <Avatar name={delivery.name} logo={delivery.logo} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-black">{delivery.name}</div>
                        <div className="truncate text-xs text-slate-500">{delivery.email}</div>
                      </div>
                      <div className="rounded-xl bg-cyan-500/10 px-3 py-2 text-center">
                        <div className="text-[10px] font-black uppercase text-cyan-400">Total</div>
                        <div className="text-xl font-black text-cyan-300">{nf(delivery.total)}</div>
                      </div>
                    </div>

                    <div className="max-h-80 space-y-2 overflow-y-auto p-3">
                      {delivery.products.map((product) => (
                        <div key={product.id} className="flex items-center gap-3 rounded-xl bg-slate-800/70 p-3">
                          <div className="h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                            {product.image ? (
                              <img src={product.image} alt={product.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">📦</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black">{product.title}</div>
                            <div className="text-xs text-slate-500">SKU: {product.sku || 'Sin SKU'}</div>
                          </div>
                          <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-center">
                            <div className="text-[10px] font-black uppercase text-emerald-400">Disponible</div>
                            <div className="text-xl font-black text-emerald-300">{nf(product.quantity)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-slate-500">
                No hay stock asignado disponible.
              </div>
            )}
          </section>
        )}

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs font-bold text-slate-400">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <span>📅 {dateFrom} → {dateTo}</span>
            <span>📦 Pedidos: {nf(kpis.orders)}</span>
            <span>✅ Entregados: {nf(kpis.delivered)}</span>
            <span>✕ Cancelados: {nf(kpis.canceled)}</span>
            <span>💵 Ventas: {nf(kpis.sold)} Gs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
