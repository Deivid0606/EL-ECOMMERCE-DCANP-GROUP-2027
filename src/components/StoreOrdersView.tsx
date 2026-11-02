import { useCallback, useEffect, useMemo, useState } from "react";
import DropiButton from "@/components/DropiButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type StoreOrderPrefill = {
  customer?: string;
  phone?: string;
  city?: string;
  street?: string;
  district?: string;
  email?: string;
  productTitle?: string;
  totalGs?: number;
  qty?: number;
  obs?: string;
};

export type StoreOrder = {
  id: string;
  landing_page_id: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  unit_price_gs: number;
  total_gs: number;
  customer_name: string;
  phone: string;
  department: string | null;
  city: string;
  address: string | null;
  reference: string | null;
  status: string;
  seller_email: string | null;
  page_name: string | null;
  page_slug: string | null;
  system_status: string | null;
  sent_to_system_at: string | null;
  created_at: string;
  tags?: string[] | null;
};

export type CoverageResult =
  | "covered"
  | "uncovered"
  | "unknown";

export type ProductMatch =
  | "matched"
  | "review"
  | "missing";

export type CatalogProduct = {
  id: string;
  title: string;
  sku?: string | null;
  aliases?: string[];
};

export type StoreOrdersViewProps = {
  onLoadOrder: (prefill: StoreOrderPrefill) => void;
  checkCoverage?: (
    city: string,
    department: string | null
  ) => CoverageResult;
  catalogProducts?: CatalogProduct[];
  onOrderCreated?: (
    sourceOrderId: string,
    createdOrderId: string
  ) => Promise<void> | void;
};

const SELECT =
  "id,landing_page_id,product_id,product_title,quantity,unit_price_gs,total_gs,customer_name,phone,department,city,address,reference,status,seller_email,page_name,page_slug,system_status,sent_to_system_at,created_at,tags";

const nf = (n: number) =>
  new Intl.NumberFormat("es-PY").format(
    Math.round(Number(n || 0))
  );

const pyDate = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

const pyTime = (value: string) =>
  new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const normalize = (
  value: string | null | undefined
) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const TAGS = [
  "Ecommerce",
  "Drop",
  "Pago anticipado",
  "Pendiente de pago",
];

const sourceStatus = (order: StoreOrder) =>
  (order.system_status || "pending").toLowerCase();

const isSaved = (order: StoreOrder) =>
  ["loaded", "created", "saved", "imported"].includes(
    sourceStatus(order)
  );

export function makeStoreOrderPrefill(
  order: StoreOrder
): StoreOrderPrefill {
  return {
    customer: order.customer_name || "",
    phone: order.phone || "",
    city: order.city || "",
    street: order.address || "",
    district: order.department || "",
    productTitle: order.product_title || "",
    totalGs: Number(order.total_gs || 0),
    qty: Number(order.quantity || 1),
    obs: [
      `PEDIDO MI TIENDA: ${order.id}`,
      order.page_name
        ? `Página: ${order.page_name}`
        : "",
      order.page_slug
        ? `Slug: ${order.page_slug}`
        : "",
      order.reference
        ? `Referencia: ${order.reference}`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

function orderUrl(ids: string[]) {
  const url = new URL(window.location.href);

  url.searchParams.set("view", "create-order");
  url.searchParams.set(
    "store_order_ids",
    ids.join(",")
  );
  url.searchParams.delete("store_order_id");

  return url.toString();
}

function classifyProduct(
  order: StoreOrder,
  products?: CatalogProduct[]
): ProductMatch {
  if (!products) return "review";

  const name = normalize(order.product_title);

  const exact = products.filter(
    (p) =>
      normalize(p.title) === name ||
      (p.aliases || []).some(
        (a) => normalize(a) === name
      )
  );

  return exact.length === 1
    ? "matched"
    : exact.length > 1
      ? "review"
      : "missing";
}

// ============================================
// DROPI: SIN BLOQUEO POR COBERTURA INTERNA
// ============================================

async function prepareDropi(
  order: StoreOrder,
  product: CatalogProduct | undefined
) {
  // El producto puede no coincidir con el catálogo
  // interno. Dropi utiliza su propio ID o SKU.

  const productKey = `bot-sky-dropi-product:${
    product?.id ||
    order.product_id ||
    normalize(order.product_title) ||
    order.id
  }`;

  let saved = "";

  try {
    saved = localStorage.getItem(productKey) || "";
  } catch {
    // El almacenamiento puede estar deshabilitado.
  }

  // Solicitar siempre el ID o SKU antes de continuar.
  const reference = window.prompt(
    `ID o SKU de Dropi para ${order.product_title}\n(Si ya está vinculado, podés conservar el valor):`,
    saved
  );

  if (reference === null) return;

  const dropiReference = reference.trim();

  if (!dropiReference) {
    toast.error(
      "Ingresá el ID o SKU del producto de Dropi."
    );
    return;
  }

  // No verificar la cobertura interna.
  // Dropi determinará si acepta la ubicación.
  // Sí se comprueban los datos básicos del pedido.

  if (
    !order.customer_name?.trim() ||
    !order.phone?.trim() ||
    !order.address?.trim() ||
    !(Number(order.quantity) > 0) ||
    !(Number(order.total_gs) > 0)
  ) {
    toast.error(
      "Faltan datos del pedido: verificá cliente, teléfono, dirección, cantidad y precio de venta."
    );
    return;
  }

  try {
    localStorage.setItem(
      productKey,
      dropiReference
    );
  } catch {
    // Continuar sin guardar la referencia.
  }

  const quantity = Number(order.quantity);
  const totalGs = Number(order.total_gs);

  const unitPriceGs =
    Number(order.unit_price_gs || 0) ||
    totalGs / quantity;

  const payload = {
    sourceOrderId: order.id,

    productId:
      product?.id || order.product_id || "",

    productTitle: order.product_title,
    dropiReference,

    customer: order.customer_name,
    phone: order.phone,

    city: order.city || "",
    department: order.department || "",
    address: order.address || "",
    reference: order.reference || "",

    quantity,
    totalGs,
    salePriceGs: totalGs,
    unitPriceGs,

    sellerEmail: order.seller_email || "",
  };

  // Comunicación con la extensión de Chrome.
  // No se expone la información del cliente
  // dentro de los parámetros de una URL externa.

  const requestId = crypto.randomUUID();

  let resolved = false;

  const onMessage = (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== location.origin
    ) {
      return;
    }

    if (
      event.data?.type !== "BOT_SKY_DROPI_ACK" ||
      event.data?.requestId !== requestId
    ) {
      return;
    }

    resolved = true;

    window.removeEventListener(
      "message",
      onMessage
    );

    if (event.data.ok) {
      toast.success(
        "🚀 Pedido entregado a la extensión. Revisá el formulario de Dropi."
      );
    } else {
      toast.error(
        event.data.error ||
          "La extensión no pudo preparar Dropi."
      );
    }
  };

  window.addEventListener(
    "message",
    onMessage
  );

  window.postMessage(
    {
      type: "BOT_SKY_PREPARE_DROPI",
      requestId,
      payload,
    },
    location.origin
  );

  window.setTimeout(() => {
    window.removeEventListener(
      "message",
      onMessage
    );

    if (!resolved) {
      toast.error(
        "La extensión de Dropi no respondió. Verificá que esté instalada, habilitada y actualizada."
      );
    }
  }, 8000);
}

// ============================================
// ETIQUETAS PERSONALIZADAS
// ============================================

const TAG_STYLES = {
  violet: { pill: "bg-violet-500/15 text-violet-200 border-violet-400/30", dot: "bg-violet-400" },
  blue: { pill: "bg-sky-500/15 text-sky-200 border-sky-400/30", dot: "bg-sky-400" },
  green: { pill: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30", dot: "bg-emerald-400" },
  amber: { pill: "bg-amber-500/15 text-amber-200 border-amber-400/30", dot: "bg-amber-400" },
  rose: { pill: "bg-rose-500/15 text-rose-200 border-rose-400/30", dot: "bg-rose-400" },
  teal: { pill: "bg-teal-500/15 text-teal-200 border-teal-400/30", dot: "bg-teal-400" },
  orange: { pill: "bg-orange-500/15 text-orange-200 border-orange-400/30", dot: "bg-orange-400" },
  slate: { pill: "bg-slate-500/15 text-slate-200 border-slate-400/30", dot: "bg-slate-400" },
} as const;

type TagColor = keyof typeof TAG_STYLES;
type TagDef = { name: string; color: TagColor };

const TAG_COLOR_KEYS = Object.keys(TAG_STYLES) as TagColor[];

const DEFAULT_TAG_COLORS: TagColor[] = ["blue", "violet", "green", "amber"];
const DEFAULT_TAGS: TagDef[] = TAGS.map((name, i) => ({ name, color: DEFAULT_TAG_COLORS[i] }));

function fallbackColor(name: string): TagColor {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLOR_KEYS[hash % TAG_COLOR_KEYS.length];
}

const tagStorageKey = (email: string) => `store-order-tags:${email}`;

function readTagDefs(email: string): TagDef[] {
  try {
    const raw = localStorage.getItem(tagStorageKey(email));
    if (!raw) return DEFAULT_TAGS;
    const parsed = JSON.parse(raw) as TagDef[];
    if (!Array.isArray(parsed)) return DEFAULT_TAGS;
    return parsed
      .filter((t) => typeof t?.name === "string" && t.name.trim())
      .map((t) => ({
        name: t.name.trim(),
        color: TAG_COLOR_KEYS.includes(t.color) ? t.color : fallbackColor(t.name),
      }));
  } catch {
    return DEFAULT_TAGS;
  }
}

function writeTagDefs(email: string, defs: TagDef[]) {
  try {
    localStorage.setItem(tagStorageKey(email), JSON.stringify(defs));
  } catch {
    // Las etiquetas siguen funcionando sin guardar colores.
  }
}

function TagPill({ def, onRemove }: { def: TagDef; onRemove?: () => void }) {
  const style = TAG_STYLES[def.color];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {def.name}
      {onRemove && (
        <button
          type="button"
          className="opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Quitar ${def.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function TagPicker({
  defs,
  value,
  disabled,
  onToggle,
  onCreate,
}: {
  defs: TagDef[];
  value: string[];
  disabled?: boolean;
  onToggle: (name: string, on: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const filtered = defs.filter((d) => normalize(d.name).includes(normalize(q)));
  const exists = defs.some((d) => normalize(d.name) === normalize(q));

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/60 disabled:opacity-50"
          onClick={(e) => e.stopPropagation()}
        >
          + Etiqueta
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <input
          className="app-input !py-2"
          placeholder="Buscar o crear etiqueta…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q && !exists) {
              onCreate(q);
              setQuery("");
            }
          }}
        />
        <div className="mt-2 max-h-56 overflow-y-auto space-y-0.5">
          {filtered.map((def) => {
            const on = value.includes(def.name);
            return (
              <label
                key={def.name}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer hover:bg-secondary"
              >
                <input type="checkbox" checked={on} onChange={(e) => onToggle(def.name, e.target.checked)} />
                <span className={`h-2 w-2 rounded-full ${TAG_STYLES[def.color].dot}`} />
                <span className="truncate">{def.name}</span>
              </label>
            );
          })}
          {q && !exists && (
            <button
              type="button"
              className="w-full text-left rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-secondary"
              onClick={() => {
                onCreate(q);
                setQuery("");
              }}
            >
              + Crear «{q}»
            </button>
          )}
          {!filtered.length && !q && (
            <div className="px-2 py-3 text-xs text-muted-foreground">Todavía no hay etiquetas.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// ESTADOS DE CARGA
// ============================================

type LoadStage = "new" | "opened" | "error" | "loaded";

const loadStage = (order: StoreOrder): LoadStage => {
  if (isSaved(order)) return "loaded";
  const status = sourceStatus(order);
  if (status === "opened") return "opened";
  if (status === "error") return "error";
  return "new";
};

const STAGE_BADGE: Record<LoadStage, { label: string; cls: string }> = {
  new: { label: "🆕 Nuevo", cls: "bg-sky-500/15 text-sky-200 border-sky-400/30" },
  opened: { label: "↗ Formulario abierto", cls: "bg-amber-500/15 text-amber-200 border-amber-400/30" },
  error: { label: "⚠️ Error de carga", cls: "bg-rose-500/15 text-rose-200 border-rose-400/30" },
  loaded: { label: "✅ Cargado", cls: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30" },
};

const COVERAGE_BADGE: Record<CoverageResult, { label: string; cls: string }> = {
  covered: { label: "✅ En cobertura", cls: "bg-emerald-500/10 text-emerald-200 border-emerald-400/25" },
  uncovered: { label: "❌ Sin cobertura", cls: "bg-rose-500/10 text-rose-200 border-rose-400/25" },
  unknown: { label: "⚠️ Por verificar", cls: "bg-amber-500/10 text-amber-200 border-amber-400/25" },
};

const PRODUCT_BADGE: Record<ProductMatch, { label: string; cls: string }> = {
  matched: { label: "✅ Producto detectado", cls: "bg-emerald-500/10 text-emerald-200 border-emerald-400/25" },
  review: { label: "⚠️ Revisar producto", cls: "bg-amber-500/10 text-amber-200 border-amber-400/25" },
  missing: { label: "❌ Producto no encontrado", cls: "bg-rose-500/10 text-rose-200 border-rose-400/25" },
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ============================================
// DASHBOARD (ESTILO SHOPIFY)
// ============================================

type Period = "today" | "7d" | "30d" | "month";

const PERIODS: Array<[Period, string]> = [
  ["today", "Hoy"],
  ["7d", "Últimos 7 días"],
  ["30d", "Últimos 30 días"],
  ["month", "Este mes"],
];

const DAY_MS = 86_400_000;

const shiftDay = (day: string, delta: number) =>
  new Date(new Date(`${day}T12:00:00Z`).getTime() + delta * DAY_MS).toISOString().slice(0, 10);

const pyHour = (value: string) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Asuncion",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value))
  );

const compactGs = (n: number) =>
  new Intl.NumberFormat("es-PY", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function periodLength(period: Period, today: string) {
  if (period === "today") return 1;
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  return Number(today.slice(8, 10));
}

function summarize(list: StoreOrder[]) {
  const sales = list.reduce((sum, o) => sum + Number(o.total_gs || 0), 0);
  const loaded = list.filter(isSaved).length;
  return {
    sales,
    count: list.length,
    avg: list.length ? sales / list.length : 0,
    loadedRate: list.length ? (loaded / list.length) * 100 : 0,
  };
}

function Delta({ current, previous, points }: { current: number; previous: number; points?: boolean }) {
  if (!points && previous === 0) {
    return <span className="text-[11px] text-muted-foreground">Sin datos previos</span>;
  }
  const diff = points ? current - previous : ((current - previous) / previous) * 100;
  const rounded = Math.round(diff * 10) / 10;
  if (rounded === 0) {
    return <span className="text-[11px] text-muted-foreground">= sin cambios</span>;
  }
  const up = rounded > 0;
  return (
    <span className={`text-[11px] font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(rounded).toLocaleString("es-PY")}
      {points ? " pp" : "%"}
      <span className="font-normal text-muted-foreground"> vs período anterior</span>
    </span>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { tip: string; sales: number; count: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{point.tip}</div>
      <div className="font-black text-sm mt-0.5">Gs. {nf(point.sales)}</div>
      <div className="text-muted-foreground">
        {point.count} pedido{point.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function RankList({
  title,
  rows,
  format,
}: {
  title: string;
  rows: Array<[string, number]>;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <div className="rounded-2xl border border-border p-4 min-w-0">
      <div className="text-sm font-black">{title}</div>
      {!rows.length ? (
        <div className="text-xs text-muted-foreground mt-3">Sin datos en este período.</div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {rows.map(([name, value]) => (
            <div key={name} className="min-w-0">
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate">{name}</span>
                <b className="shrink-0">{format(value)}</b>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StoreOrdersDashboard({ orders, today }: { orders: StoreOrder[]; today: string }) {
  const [period, setPeriod] = useState<Period>("7d");

  const data = useMemo(() => {
    const len = periodLength(period, today);
    const days = Array.from({ length: len }, (_, i) => shiftDay(today, i - len + 1));
    const daySet = new Set(days);
    const prevSet = new Set(days.map((d) => shiftDay(d, -len)));

    const current = orders.filter((o) => daySet.has(pyDate(o.created_at)));
    const previous = orders.filter((o) => prevSet.has(pyDate(o.created_at)));

    const series =
      period === "today"
        ? Array.from({ length: 24 }, (_, h) => {
            const list = current.filter((o) => pyHour(o.created_at) === h);
            return {
              label: `${h}h`,
              tip: `Hoy · ${String(h).padStart(2, "0")}:00`,
              sales: list.reduce((s, o) => s + Number(o.total_gs || 0), 0),
              count: list.length,
            };
          })
        : days.map((day) => {
            const list = current.filter((o) => pyDate(o.created_at) === day);
            const [, m, d] = day.split("-");
            return {
              label: `${d}/${m}`,
              tip: day === today ? "Hoy" : `${d}/${m}`,
              sales: list.reduce((s, o) => s + Number(o.total_gs || 0), 0),
              count: list.length,
            };
          });

    const rank = (key: (o: StoreOrder) => string, value: (o: StoreOrder) => number) => {
      const map = new Map<string, number>();
      current.forEach((o) => {
        const k = key(o) || "Sin dato";
        map.set(k, (map.get(k) || 0) + value(o));
      });
      return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    };

    return {
      cur: summarize(current),
      prev: summarize(previous),
      series,
      topProducts: rank((o) => o.product_title, (o) => Number(o.total_gs || 0)),
      topCities: rank((o) => o.city, () => 1),
      topPages: rank((o) => o.page_name || "Landing", () => 1),
    };
  }, [orders, period, today]);

  const pending = orders.filter((o) => !isSaved(o));
  const pendingSales = pending.reduce((s, o) => s + Number(o.total_gs || 0), 0);

  const tiles = [
    {
      label: "Ventas totales",
      value: `Gs. ${nf(data.cur.sales)}`,
      delta: <Delta current={data.cur.sales} previous={data.prev.sales} />,
    },
    {
      label: "Pedidos",
      value: nf(data.cur.count),
      delta: <Delta current={data.cur.count} previous={data.prev.count} />,
    },
    {
      label: "Ticket promedio",
      value: `Gs. ${nf(data.cur.avg)}`,
      delta: <Delta current={data.cur.avg} previous={data.prev.avg} />,
    },
    {
      label: "Tasa de carga",
      value: `${Math.round(data.cur.loadedRate)}%`,
      delta: <Delta current={data.cur.loadedRate} previous={data.prev.loadedRate} points />,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-black">📊 Resumen de ventas</div>
          <div className="text-xs text-muted-foreground">Comparado con el período anterior de igual duración.</div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border p-1">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                period === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-border p-4 min-w-0">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="text-xl lg:text-2xl font-black mt-1 break-words">{t.value}</div>
            <div className="mt-1">{t.delta}</div>
          </div>
        ))}
        <div className="col-span-2 xl:col-span-1 rounded-2xl border border-sky-400/30 bg-sky-500/5 p-4 min-w-0">
          <div className="text-xs text-sky-200">🆕 Por cargar (todas las fechas)</div>
          <div className="text-xl lg:text-2xl font-black mt-1">{nf(pending.length)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Gs. {nf(pendingSales)} en espera</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <div className="rounded-2xl border border-border p-4 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-black">Ventas {period === "today" ? "por hora" : "por día"}</div>
            <div className="text-xs text-muted-foreground">Gs.</div>
          </div>
          <div className="mt-3 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(240 16% 18%)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={14}
                />
                <YAxis
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickFormatter={(v: number) => compactGs(v)}
                  allowDecimals={false}
                />
                <Tooltip cursor={{ fill: "hsl(240 14% 15%)", opacity: 0.6 }} content={<ChartTooltip />} />
                <Bar dataKey="sales" fill="hsl(var(--brand))" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <RankList title="🏆 Productos más vendidos" rows={data.topProducts} format={(n) => `Gs. ${compactGs(n)}`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RankList title="📍 Ciudades con más pedidos" rows={data.topCities} format={nf} />
        <RankList title="📄 Páginas con más pedidos" rows={data.topPages} format={nf} />
      </div>
    </div>
  );
}

// ============================================
// VISTA PRINCIPAL DE PEDIDOS
// ============================================

type Section = "new" | "loaded" | "all";

const PAGE_SIZE = 50;

export default function StoreOrdersView({
  onLoadOrder,
  checkCoverage,
  catalogProducts,
}: StoreOrdersViewProps) {
  const { user } = useAuth();
  const email = user?.email?.toLowerCase() || "";

  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [taggingIds, setTaggingIds] = useState<string[]>([]);

  const today = pyDate(new Date());

  const [section, setSection] = useState<Section>("new");
  const [selectedDate, setSelectedDate] = useState(today);
  const [showAllDates, setShowAllDates] = useState(false);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("all");
  const [coverage, setCoverage] = useState("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showDashboard, setShowDashboard] = useState(true);

  const [tagDefsStored, setTagDefsStored] = useState<TagDef[]>(DEFAULT_TAGS);

  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<
    Array<{ id: string; status: string; order_id?: string; message?: string }>
  >([]);

  useEffect(() => {
    if (email) setTagDefsStored(readTagDefs(email));
  }, [email]);

  // ==========================================
  // CARGAR PEDIDOS
  // ==========================================

  const loadOrders = useCallback(
    async (showSpinner = false) => {
      if (!email) {
        setOrders([]);
        setLoading(false);
        return;
      }

      if (showSpinner) setLoading(true);

      const collected: StoreOrder[] = [];

      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase
          .from("landing_page_orders")
          .select(SELECT)
          .eq("seller_email", email)
          .order("created_at", { ascending: false })
          .range(start, start + 499);

        if (error) {
          console.error(error);
          toast.error("No se pudieron cargar los pedidos. Ejecutá store_orders_pro.sql.");
          setLoading(false);
          return;
        }

        const batch = (data || []) as StoreOrder[];
        collected.push(...batch);
        if (batch.length < 500) break;
      }

      setOrders(collected);
      setLoading(false);
    },
    [email]
  );

  useEffect(() => {
    void loadOrders(true);

    if (!email) return;

    const channel = supabase
      .channel(`store-orders-pro-${email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "landing_page_orders" }, () => {
        void loadOrders();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [email, loadOrders]);

  // Etiquetas definidas + las que ya existen en pedidos.
  const tagDefs = useMemo(() => {
    const defs = [...tagDefsStored];
    const known = new Set(defs.map((d) => d.name));
    orders.forEach((o) =>
      (o.tags || []).forEach((t) => {
        if (t && !known.has(t)) {
          known.add(t);
          defs.push({ name: t, color: fallbackColor(t) });
        }
      })
    );
    return defs;
  }, [tagDefsStored, orders]);

  const tagDefMap = useMemo(() => new Map(tagDefs.map((d) => [d.name, d])), [tagDefs]);
  const defFor = (name: string): TagDef => tagDefMap.get(name) || { name, color: fallbackColor(name) };

  const tagUsage = useMemo(() => {
    const map = new Map<string, number>();
    orders.forEach((o) => (o.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
    return map;
  }, [orders]);

  const updateTagDefs = (next: TagDef[]) => {
    setTagDefsStored(next);
    writeTagDefs(email, next);
  };

  const createTag = (name: string) => {
    const clean = name.trim().slice(0, 40);
    const existing = tagDefs.find((d) => normalize(d.name) === normalize(clean));
    if (!clean || existing) return existing?.name || clean;
    updateTagDefs([...tagDefs, { name: clean, color: fallbackColor(clean) }]);
    return clean;
  };

  const products = useMemo(
    () => [...new Set(orders.map((o) => o.product_title).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [orders]
  );

  const getCoverage = useCallback(
    (order: StoreOrder): CoverageResult => {
      if (!checkCoverage || !order.city?.trim() || !order.department?.trim()) return "unknown";
      try {
        return checkCoverage(order.city, order.department);
      } catch {
        return "unknown";
      }
    },
    [checkCoverage]
  );

  // ==========================================
  // FILTROS
  // ==========================================

  const sectionCounts = useMemo(() => {
    const newCount = orders.filter((o) => !isSaved(o)).length;
    return { new: newCount, loaded: orders.length - newCount, all: orders.length };
  }, [orders]);

  // Los pedidos nuevos (sin cargar) se muestran siempre, sin importar la fecha.
  const usesDate = section !== "new";

  const visibleOrders = useMemo(() => {
    const q = normalize(search);
    return orders.filter((order) => {
      if (section === "new" && isSaved(order)) return false;
      if (section === "loaded" && !isSaved(order)) return false;
      if (usesDate && !showAllDates && pyDate(order.created_at) !== selectedDate) return false;
      if (product !== "all" && order.product_title !== product) return false;
      if (coverage !== "all" && getCoverage(order) !== coverage) return false;
      if (tagFilter.length && !tagFilter.every((t) => (order.tags || []).includes(t))) return false;
      return (
        !q ||
        [
          order.customer_name,
          order.phone,
          order.city,
          order.department,
          order.product_title,
          order.page_name,
          order.id,
          ...(order.tags || []),
        ].some((s) => normalize(s).includes(q))
      );
    });
  }, [orders, section, usesDate, showAllDates, selectedDate, product, coverage, getCoverage, tagFilter, search]);

  const pagedOrders = visibleOrders.slice(0, limit);

  const resetSelection = () => {
    setChosen([]);
    setLimit(PAGE_SIZE);
  };

  const selected = visibleOrders.filter((o) => chosen.includes(o.id));

  // Esta validación es únicamente para la importación INTERNA.
  // No se utiliza para Cargar a Dropi.
  const canImport = (o: StoreOrder) =>
    !isSaved(o) &&
    getCoverage(o) === "covered" &&
    classifyProduct(o, catalogProducts) === "matched" &&
    Boolean(o.customer_name?.trim()) &&
    Boolean(o.phone?.trim()) &&
    Number(o.quantity) > 0 &&
    Number(o.total_gs) > 0;

  const ready = selected.filter(canImport);
  const deletable = selected.filter((o) => !isSaved(o));

  const allVisibleChosen = visibleOrders.length > 0 && visibleOrders.every((o) => chosen.includes(o.id));
  const someVisibleChosen = selected.length > 0 && !allVisibleChosen;

  const listTotal = visibleOrders.reduce((sum, o) => sum + Number(o.total_gs || 0), 0);

  const busy = savingIds.length > 0 || importing || deletingIds.length > 0;

  const activeFilters =
    (product !== "all" ? 1 : 0) + (coverage !== "all" ? 1 : 0) + tagFilter.length + (search.trim() ? 1 : 0);

  const toggleChosen = (id: string, on: boolean) =>
    setChosen((old) => (on ? [...new Set([...old, id])] : old.filter((x) => x !== id)));

  // ==========================================
  // FORMULARIO INTERNO
  // ==========================================

  async function markOpened(ids: string[]) {
    setSavingIds(ids);

    const { error } = await supabase
      .from("landing_page_orders")
      .update({ system_status: "opened", sent_to_system_at: new Date().toISOString() })
      .in("id", ids)
      .eq("seller_email", email);

    setSavingIds([]);

    if (error) {
      console.error(error);
      toast.error("No se pudo preparar la carga.");
      return false;
    }

    setOrders((old) =>
      old.map((o) => (ids.includes(o.id) && !isSaved(o) ? { ...o, system_status: "opened" } : o))
    );

    return true;
  }

  async function openOne(order: StoreOrder) {
    const tab = window.open("about:blank", "_blank");

    if (!tab) {
      toast.error("Permití ventanas emergentes para abrir el formulario.");
      return;
    }

    if (!(await markOpened([order.id]))) {
      tab.close();
      return;
    }

    tab.location.replace(orderUrl([order.id]));

    void onLoadOrder;
  }

  async function openBulk() {
    if (!selected.length) return;

    if (!ready.length) {
      toast.error("No hay pedidos con producto confirmado para abrir.");
      return;
    }

    const excluded = selected.length - ready.length;

    if (
      !window.confirm(
        `Se abrirán ${ready.length} pedido(s) en una sola pestaña, uno por vez.${
          excluded ? `\n${excluded} pedido(s) excluido(s) por revisión o ya cargados.` : ""
        }\n\nLa creación de cada venta se confirma en el formulario.`
      )
    ) {
      return;
    }

    const tab = window.open("about:blank", "_blank");

    if (!tab) {
      toast.error("Permití ventanas emergentes para la carga masiva.");
      return;
    }

    const ids = ready.map((o) => o.id);

    if (!(await markOpened(ids))) {
      tab.close();
      return;
    }

    tab.location.replace(orderUrl(ids));
    setChosen([]);
  }

  // ==========================================
  // CARGA DIRECTA INTERNA
  // ==========================================

  async function importDirect(ids: string[]) {
    if (busy || !ids.length) return;

    const eligible = orders.filter((o) => ids.includes(o.id) && canImport(o));

    if (eligible.length !== ids.length) {
      toast.error(
        "Sólo se importan pedidos con cobertura y producto confirmados, sin datos faltantes y no cargados."
      );
      return;
    }

    if (
      !window.confirm(
        `¿Guardar directamente ${ids.length} pedido(s) en el sistema, sin abrir el formulario?\n\nSe conservarán precio total y cantidad de Mi Tienda. Cada pedido se validará nuevamente en Supabase.`
      )
    ) {
      return;
    }

    setImporting(true);
    setImportReport([]);

    try {
      const result: Array<{ id: string; status: string; order_id?: string; message?: string }> = [];

      for (let i = 0; i < ids.length; i += 25) {
        const batch = ids.slice(i, i + 25);

        const { data, error } = await supabase.rpc("import_store_orders", { p_ids: batch });

        if (error) {
          result.push(...batch.map((id) => ({ id, status: "error", message: error.message })));
        } else if (Array.isArray(data)) {
          result.push(...(data as typeof result));
        } else {
          result.push(
            ...batch.map((id) => ({ id, status: "error", message: "Respuesta inesperada del servidor" }))
          );
        }
      }

      setImportReport(result);

      const success = result.filter((x) => x.status === "loaded").length;
      const existing = result.filter((x) => x.status === "already_loaded").length;
      const failed = result.filter((x) => x.status === "error").length;

      if (success) toast.success(`✅ ${success} pedido(s) cargados correctamente`);
      if (existing) toast.info(`${existing} pedido(s) ya estaban cargados`);
      if (failed) toast.error(`${failed} pedido(s) requieren revisión. Mirá el detalle debajo.`);

      setChosen([]);
      await loadOrders();
    } finally {
      setImporting(false);
    }
  }

  // ==========================================
  // ETIQUETAS
  // ==========================================

  async function saveTagsMany(updates: Array<{ id: string; tags: string[] }>) {
    if (!updates.length) return true;

    setTaggingIds(updates.map((u) => u.id));

    const results = await Promise.all(
      updates.map((u) =>
        supabase.from("landing_page_orders").update({ tags: u.tags }).eq("id", u.id).eq("seller_email", email)
      )
    );

    setTaggingIds([]);

    const failedIds = new Set(updates.filter((_, i) => results[i].error).map((u) => u.id));

    if (failedIds.size) {
      console.error(results.map((r) => r.error).filter(Boolean));
      toast.error(`No se pudieron guardar las etiquetas de ${failedIds.size} pedido(s).`);
    }

    const byId = new Map(updates.filter((u) => !failedIds.has(u.id)).map((u) => [u.id, u.tags]));
    setOrders((old) => old.map((o) => (byId.has(o.id) ? { ...o, tags: byId.get(o.id) } : o)));

    return failedIds.size === 0;
  }

  const toggleOrderTag = (order: StoreOrder, name: string, on: boolean) => {
    const current = order.tags || [];
    const next = on ? [...new Set([...current, name])] : current.filter((t) => t !== name);
    void saveTagsMany([{ id: order.id, tags: next }]);
  };

  async function bulkTag(name: string, on: boolean) {
    const updates = selected
      .filter((o) => (o.tags || []).includes(name) !== on)
      .map((o) => ({
        id: o.id,
        tags: on ? [...(o.tags || []), name] : (o.tags || []).filter((t) => t !== name),
      }));

    if (!updates.length) {
      toast.info(on ? `Todos ya tienen «${name}».` : `Ninguno tiene «${name}».`);
      return;
    }

    if (await saveTagsMany(updates)) {
      toast.success(
        on
          ? `🏷️ «${name}» agregada a ${updates.length} pedido(s)`
          : `🏷️ «${name}» quitada de ${updates.length} pedido(s)`
      );
    }
  }

  async function deleteTagEverywhere(name: string) {
    const used = orders.filter((o) => (o.tags || []).includes(name));

    if (
      used.length &&
      !window.confirm(`La etiqueta «${name}» está en ${used.length} pedido(s). ¿Quitarla de todos y eliminarla?`)
    ) {
      return;
    }

    const ok = await saveTagsMany(used.map((o) => ({ id: o.id, tags: (o.tags || []).filter((t) => t !== name) })));
    if (!ok) return;

    updateTagDefs(tagDefs.filter((d) => d.name !== name));
    setTagFilter((old) => old.filter((t) => t !== name));
    toast.success(`Etiqueta «${name}» eliminada`);
  }

  // ==========================================
  // ELIMINAR PEDIDOS (UNO O VARIOS)
  // ==========================================

  async function deleteOrders(list: StoreOrder[]) {
    const allowed = list.filter((o) => !isSaved(o));
    const skipped = list.length - allowed.length;

    if (!allowed.length) {
      toast.error("Los pedidos ya importados no se pueden eliminar desde Mi Tienda.");
      return;
    }

    const message =
      allowed.length === 1
        ? `¿Eliminar este pedido?\n\nCliente: ${allowed[0].customer_name}\nProducto: ${allowed[0].product_title}\nTotal: Gs. ${nf(allowed[0].total_gs)}`
        : `¿Eliminar ${allowed.length} pedidos?\n\nTotal: Gs. ${nf(allowed.reduce((s, o) => s + Number(o.total_gs || 0), 0))}`;

    if (
      !window.confirm(
        `${message}${skipped ? `\n\n${skipped} pedido(s) ya cargado(s) se conservarán.` : ""}\n\nEsta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    const ids = allowed.map((o) => o.id);
    setDeletingIds(ids);

    const removed: string[] = [];
    let lastError = "";

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { error } = await supabase
        .from("landing_page_orders")
        .delete()
        .in("id", batch)
        .eq("seller_email", email);

      if (error) {
        console.error(error);
        lastError = error.message;
      } else {
        removed.push(...batch);
      }
    }

    setDeletingIds([]);

    if (removed.length) {
      setOrders((old) => old.filter((o) => !removed.includes(o.id)));
      setChosen((old) => old.filter((id) => !removed.includes(id)));
      toast.success(
        removed.length === 1 ? "🗑️ Pedido eliminado correctamente" : `🗑️ ${removed.length} pedidos eliminados`
      );
    }

    if (lastError) {
      toast.error(lastError || "No se pudieron eliminar algunos pedidos.");
    }
  }

  // ==========================================
  // RENDER
  // ==========================================

  const sectionTabs: Array<[Section, string, number]> = [
    ["new", "🆕 Nuevos · sin cargar", sectionCounts.new],
    ["loaded", "✅ Cargados", sectionCounts.loaded],
    ["all", "📋 Todos", sectionCounts.all],
  ];

  const dateLabel = showAllDates ? "todas las fechas" : selectedDate === today ? "hoy" : selectedDate;

  const rowGrid =
    "lg:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)_20px]";

  return (
    <div className="space-y-5">
      {/* DASHBOARD */}
      <div className="rounded-2xl border border-border p-4">
        <button
          type="button"
          className="w-full flex items-center justify-between text-left"
          onClick={() => setShowDashboard((v) => !v)}
        >
          <span className="text-xs uppercase tracking-[0.18em] font-black text-primary">Análisis</span>
          <span className="text-xs text-muted-foreground">{showDashboard ? "Ocultar ▲" : "Mostrar ▼"}</span>
        </button>
        {showDashboard && (
          <div className="mt-3">
            {loading ? (
              <div className="h-40 rounded-2xl bg-secondary/40 animate-pulse" />
            ) : (
              <StoreOrdersDashboard orders={orders} today={today} />
            )}
          </div>
        )}
      </div>

      {/* LISTA DE PEDIDOS */}
      <div className="rounded-2xl border border-border overflow-hidden">
        {/* Pestañas por estado de carga */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2">
          {sectionTabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={`shrink-0 rounded-t-xl px-4 py-2.5 text-sm font-bold border-b-2 transition ${
                section === key
                  ? "border-primary text-foreground bg-secondary/40"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setSection(key);
                resetSelection();
              }}
            >
              {label}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                  section === key ? "bg-primary text-primary-foreground" : "bg-secondary"
                }`}
              >
                {nf(count)}
              </span>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="p-3 sm:p-4 space-y-3 border-b border-border">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <input
              className="app-input"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetSelection();
              }}
              placeholder="🔍 Buscar cliente, teléfono, ciudad, producto, etiqueta…"
            />
            <select
              className="app-input"
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                resetSelection();
              }}
            >
              <option value="all">📦 Todos los productos</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className="app-input"
              value={coverage}
              onChange={(e) => {
                setCoverage(e.target.value);
                resetSelection();
              }}
            >
              <option value="all">📍 Todas las zonas</option>
              <option value="covered">✅ En cobertura</option>
              <option value="uncovered">❌ Sin cobertura</option>
              <option value="unknown">⚠️ Por verificar</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {usesDate ? (
              <>
                <button
                  type="button"
                  className={`nav-btn !py-1.5 !text-xs ${!showAllDates && selectedDate === today ? "active" : ""}`}
                  onClick={() => {
                    setSelectedDate(today);
                    setShowAllDates(false);
                    resetSelection();
                  }}
                >
                  Hoy
                </button>
                <button
                  type="button"
                  className={`nav-btn !py-1.5 !text-xs ${
                    !showAllDates && selectedDate === shiftDay(today, -1) ? "active" : ""
                  }`}
                  onClick={() => {
                    setSelectedDate(shiftDay(today, -1));
                    setShowAllDates(false);
                    resetSelection();
                  }}
                >
                  Ayer
                </button>
                <button
                  type="button"
                  className={`nav-btn !py-1.5 !text-xs ${showAllDates ? "active" : ""}`}
                  onClick={() => {
                    setShowAllDates(true);
                    resetSelection();
                  }}
                >
                  Todas las fechas
                </button>
                <input
                  className="app-input !w-auto !py-1.5"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value || today);
                    setShowAllDates(false);
                    resetSelection();
                  }}
                />
              </>
            ) : (
              <span className="text-xs text-sky-200 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5">
                📅 Mostrando todos los pedidos sin cargar, sin filtrar por fecha
              </span>
            )}

            <div className="ml-auto flex flex-wrap gap-2">
              {activeFilters > 0 && (
                <button
                  type="button"
                  className="nav-btn !py-1.5 !text-xs"
                  onClick={() => {
                    setProduct("all");
                    setCoverage("all");
                    setTagFilter([]);
                    setSearch("");
                    resetSelection();
                  }}
                >
                  ✕ Limpiar filtros ({activeFilters})
                </button>
              )}
              <button type="button" className="nav-btn !py-1.5 !text-xs" onClick={() => void loadOrders(true)}>
                ↻ Actualizar
              </button>
            </div>
          </div>

          {/* Etiquetas: filtro + gestión */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">🏷️ Etiquetas:</span>
            {tagDefs.map((def) => {
              const on = tagFilter.includes(def.name);
              return (
                <button
                  key={def.name}
                  type="button"
                  className={`rounded-full transition ${on ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"}`}
                  onClick={() => {
                    setTagFilter((old) => (on ? old.filter((t) => t !== def.name) : [...old, def.name]));
                    resetSelection();
                  }}
                  title={on ? "Quitar filtro" : "Filtrar por esta etiqueta"}
                >
                  <TagPill def={{ ...def, name: `${def.name} · ${tagUsage.get(def.name) || 0}` }} />
                </button>
              );
            })}

            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="text-xs text-primary font-bold px-2 py-1 hover:underline">
                  ⚙️ Gestionar
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="start">
                <div className="text-sm font-black">Etiquetas de pedidos</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Creá etiquetas propias, elegí su color o eliminá las que ya no uses.
                </p>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem("tag") as HTMLInputElement;
                    if (input.value.trim()) createTag(input.value);
                    input.value = "";
                  }}
                >
                  <input name="tag" className="app-input !py-2" placeholder="Nueva etiqueta…" maxLength={40} />
                  <button type="submit" className="nav-btn active !py-2 shrink-0">
                    Crear
                  </button>
                </form>
                <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
                  {tagDefs.map((def) => (
                    <div key={def.name} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-secondary/60">
                      <div className="flex gap-1">
                        {TAG_COLOR_KEYS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={c}
                            className={`h-3.5 w-3.5 rounded-full ${TAG_STYLES[c].dot} ${
                              def.color === c ? "ring-2 ring-offset-1 ring-offset-background ring-foreground" : "opacity-40 hover:opacity-100"
                            }`}
                            onClick={() =>
                              updateTagDefs(tagDefs.map((d) => (d.name === def.name ? { ...d, color: c } : d)))
                            }
                          />
                        ))}
                      </div>
                      <span className="flex-1 truncate text-sm">{def.name}</span>
                      <span className="text-[11px] text-muted-foreground">{tagUsage.get(def.name) || 0}</span>
                      <button
                        type="button"
                        className="text-xs text-rose-400 hover:text-rose-300 px-1"
                        disabled={taggingIds.length > 0}
                        onClick={() => void deleteTagEverywhere(def.name)}
                        aria-label={`Eliminar ${def.name}`}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {!checkCoverage && (
            <p className="text-xs text-amber-600">
              Conectá checkCoverage a la función oficial de la plataforma; por seguridad ninguna ciudad se considera
              cubierta sin validación.
            </p>
          )}

          {!catalogProducts && (
            <p className="text-xs text-amber-600">
              Conectá catalogProducts al catálogo real para habilitar la verificación y selección masiva de productos.
            </p>
          )}
        </div>

        {/* Barra de acciones masivas */}
        {selected.length > 0 && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-primary/40 bg-background/95 backdrop-blur px-3 sm:px-4 py-2.5">
            <span className="text-sm font-bold">
              {selected.length} seleccionado{selected.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setChosen([])}>
              Deseleccionar
            </button>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                className="nav-btn active !py-2 !text-xs"
                onClick={() => void importDirect(ready.map((o) => o.id))}
                disabled={busy || ready.length === 0}
                title="Sólo pedidos con cobertura y producto confirmados"
              >
                {importing ? "Guardando..." : `⚡ Cargar directo (${ready.length})`}
              </button>
              <button
                type="button"
                className="nav-btn !py-2 !text-xs"
                onClick={() => void openBulk()}
                disabled={busy || ready.length === 0}
              >
                📦 Abrir formularios ({ready.length}) ↗
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="nav-btn !py-2 !text-xs" disabled={busy || taggingIds.length > 0}>
                    🏷️ Etiquetar ▾
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-2" align="end">
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    Aplicar a {selected.length} pedido{selected.length === 1 ? "" : "s"}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {tagDefs.map((def) => {
                      const count = selected.filter((o) => (o.tags || []).includes(def.name)).length;
                      return (
                        <div key={def.name} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/60">
                          <span className={`h-2 w-2 rounded-full ${TAG_STYLES[def.color].dot}`} />
                          <span className="flex-1 truncate text-sm">{def.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {count}/{selected.length}
                          </span>
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-0.5 text-xs hover:border-primary"
                            disabled={count === selected.length}
                            onClick={() => void bulkTag(def.name, true)}
                          >
                            + Agregar
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-0.5 text-xs hover:border-rose-400"
                            disabled={count === 0}
                            onClick={() => void bulkTag(def.name, false)}
                          >
                            −
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <button
                type="button"
                className="nav-btn !py-2 !text-xs !text-rose-300"
                disabled={busy || deletable.length === 0}
                onClick={() => void deleteOrders(selected)}
                title={deletable.length < selected.length ? "Los pedidos ya cargados no se eliminan" : undefined}
              >
                {deletingIds.length ? "Eliminando..." : `🗑️ Eliminar (${deletable.length})`}
              </button>
            </div>
          </div>
        )}

        {importReport.length > 0 && (
          <div className="border-b border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-bold">Resultado de carga directa</div>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setImportReport([])}>
                ✕ Cerrar
              </button>
            </div>
            {importReport.map((r, i) => (
              <div key={`${r.id}-${i}`} className="text-sm break-words">
                {r.status === "loaded" ? "✅" : r.status === "already_loaded" ? "ℹ️" : "❌"} {r.id}:{" "}
                {r.status === "loaded"
                  ? `Cargado (orden ${r.order_id || "creada"})`
                  : r.status === "already_loaded"
                    ? "Ya estaba cargado"
                    : r.message || "Error desconocido"}
              </div>
            ))}
          </div>
        )}

        {/* Encabezado de tabla */}
        <div
          className={`grid grid-cols-[24px_1fr_auto] ${rowGrid} items-center gap-3 px-3 sm:px-4 py-2.5 bg-secondary/30 text-[11px] uppercase tracking-wider font-bold text-muted-foreground`}
        >
          <input
            type="checkbox"
            aria-label="Seleccionar todos"
            ref={(el) => {
              if (el) el.indeterminate = someVisibleChosen;
            }}
            checked={allVisibleChosen}
            onChange={(e) => setChosen(e.target.checked ? visibleOrders.map((o) => o.id) : [])}
          />
          <span className="lg:hidden normal-case tracking-normal text-xs">
            {nf(visibleOrders.length)} pedidos · Gs. {nf(listTotal)}
          </span>
          <span className="hidden lg:block">Pedido</span>
          <span className="hidden lg:block">Cliente</span>
          <span className="hidden lg:block">Producto</span>
          <span className="hidden lg:block text-right">Total</span>
          <span className="hidden lg:block">Estado</span>
          <span className="hidden lg:block">Etiquetas</span>
          <span className="hidden lg:block" />
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-14 rounded-xl bg-secondary/40 animate-pulse" />
            ))}
          </div>
        ) : !visibleOrders.length ? (
          <div className="p-12 text-center">
            <div className="text-4xl">{section === "new" ? "🎉" : "📦"}</div>
            <div className="font-black mt-3">
              {section === "new" && !activeFilters ? "¡Todo al día! No hay pedidos sin cargar" : "No hay pedidos en esta vista"}
            </div>
            {usesDate && !showAllDates && (
              <button
                type="button"
                className="nav-btn mt-4 !text-xs"
                onClick={() => {
                  setShowAllDates(true);
                  resetSelection();
                }}
              >
                Ver todas las fechas
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pagedOrders.map((order) => {
              const cov = getCoverage(order);
              const match = classifyProduct(order, catalogProducts);
              const stage = loadStage(order);
              const saved = stage === "loaded";
              const isOpen = expanded === order.id;
              const isChosen = chosen.includes(order.id);
              const tagging = taggingIds.includes(order.id);
              const deleting = deletingIds.includes(order.id);

              const matches = (catalogProducts || []).filter(
                (p) =>
                  normalize(p.title) === normalize(order.product_title) ||
                  (p.aliases || []).some((a) => normalize(a) === normalize(order.product_title))
              );
              const dropiProduct = matches.length === 1 ? matches[0] : undefined;

              const tagsCell = (
                <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {(order.tags || []).map((t) => (
                    <TagPill
                      key={t}
                      def={defFor(t)}
                      onRemove={tagging ? undefined : () => toggleOrderTag(order, t, false)}
                    />
                  ))}
                  <TagPicker
                    defs={tagDefs}
                    value={order.tags || []}
                    disabled={tagging}
                    onToggle={(name, on) => toggleOrderTag(order, name, on)}
                    onCreate={(name) => toggleOrderTag(order, createTag(name), true)}
                  />
                </div>
              );

              return (
                <div
                  key={order.id}
                  className={`transition ${isChosen ? "bg-primary/[0.06]" : ""} ${deleting ? "opacity-50" : ""}`}
                >
                  <div
                    className={`grid grid-cols-[24px_1fr_auto] ${rowGrid} gap-3 px-3 sm:px-4 py-3 items-start lg:items-center cursor-pointer hover:bg-secondary/30`}
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 lg:mt-0"
                      checked={isChosen}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggleChosen(order.id, e.target.checked)}
                      aria-label="Seleccionar pedido"
                    />

                    {/* Móvil: tarjeta compacta */}
                    <div className="lg:hidden min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <b className="truncate">{order.customer_name || "Sin nombre"}</b>
                        <Badge {...STAGE_BADGE[stage]} />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {order.product_title} × {order.quantity} · {order.city || "Sin ciudad"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {pyDate(order.created_at)} · {pyTime(order.created_at)} · #{order.id.slice(0, 8)}
                      </div>
                      {tagsCell}
                    </div>
                    <div className="lg:hidden text-right">
                      <div className="font-black text-sm whitespace-nowrap">Gs. {nf(order.total_gs)}</div>
                      <div className="text-xs text-muted-foreground mt-1">{isOpen ? "▲" : "▼"}</div>
                    </div>

                    {/* Escritorio: fila de tabla */}
                    <div className="hidden lg:block min-w-0">
                      <div className="font-bold text-sm">#{order.id.slice(0, 8)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {pyDate(order.created_at) === today ? "Hoy" : pyDate(order.created_at)} · {pyTime(order.created_at)}
                      </div>
                    </div>
                    <div className="hidden lg:block min-w-0">
                      <div className="font-semibold text-sm truncate">{order.customer_name || "Sin nombre"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[order.city, order.department].filter(Boolean).join(" · ") || "Sin ubicación"}
                      </div>
                    </div>
                    <div className="hidden lg:block min-w-0">
                      <div className="text-sm truncate">{order.product_title}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        × {order.quantity} · {order.page_name || "Landing"}
                      </div>
                    </div>
                    <div className="hidden lg:block text-right font-black text-sm whitespace-nowrap">
                      Gs. {nf(order.total_gs)}
                    </div>
                    <div className="hidden lg:flex flex-col items-start gap-1">
                      <Badge {...STAGE_BADGE[stage]} />
                      {!saved && cov !== "covered" && <Badge {...COVERAGE_BADGE[cov]} />}
                    </div>
                    <div className="hidden lg:block min-w-0">{tagsCell}</div>
                    <div className="hidden lg:block text-xs text-muted-foreground">{isOpen ? "▲" : "▼"}</div>
                  </div>

                  {isOpen && (
                    <div className="px-3 sm:px-4 pb-4 lg:pl-[52px]">
                      <div className="rounded-2xl border border-border bg-secondary/20 p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-4">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge {...STAGE_BADGE[stage]} />
                            <Badge {...COVERAGE_BADGE[cov]} />
                            <Badge {...PRODUCT_BADGE[match]} />
                            {order.status && <Badge label={`Estado web: ${order.status}`} cls="border-border text-muted-foreground" />}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                            {[
                              ["Cliente", order.customer_name],
                              ["Teléfono", order.phone],
                              ["Ubicación", [order.city, order.department].filter(Boolean).join(" · ")],
                              ["Dirección", order.address],
                              ["Referencia", order.reference],
                              ["Producto", `${order.product_title} × ${order.quantity}`],
                              ["Precio unitario", `Gs. ${nf(order.unit_price_gs || order.total_gs / (order.quantity || 1))}`],
                              ["Total", `Gs. ${nf(order.total_gs)}`],
                              ["Página", order.page_name || "Landing"],
                              ["Fecha", `${pyDate(order.created_at)} · ${pyTime(order.created_at)}`],
                              [
                                "Enviado al sistema",
                                order.sent_to_system_at
                                  ? `${pyDate(order.sent_to_system_at)} · ${pyTime(order.sent_to_system_at)}`
                                  : "—",
                              ],
                              ["ID", order.id],
                            ].map(([label, value]) => (
                              <div key={label} className="min-w-0">
                                <div className="text-[11px] text-muted-foreground">{label}</div>
                                <div className="font-semibold break-words">{value || "—"}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-row flex-wrap lg:flex-col gap-2 lg:w-52">
                          {/* DROPI SIN VALIDACIÓN DE COBERTURA INTERNA */}
                          <button
                            type="button"
                            className="nav-btn !px-4 !py-2.5 !border-orange-500 !text-orange-500"
                            disabled={busy}
                            onClick={() => void prepareDropi(order, dropiProduct)}
                          >
                            🚀 Cargar a Dropi ↗
                          </button>
                          <button
                            type="button"
                            className="nav-btn active !px-4 !py-2.5"
                            disabled={busy || !canImport(order)}
                            onClick={() => void importDirect([order.id])}
                          >
                            ⚡ Cargar directo
                          </button>
                          <button
                            type="button"
                            className="nav-btn !px-4 !py-2.5"
                            disabled={busy || saved}
                            onClick={() => void openOne(order)}
                          >
                            📦 {saved ? "Ya cargado" : "Abrir formulario ↗"}
                          </button>
                          <DropiButton
                            className="nav-btn !px-4 !py-2.5 !bg-orange-500/90 !text-white"
                            order={{
                              customer: order.customer_name,
                              phone: order.phone,
                              department: order.department || "",
                              city: order.city || "",
                              address: [order.address, order.reference].filter(Boolean).join(" · "),
                              product: order.product_title,
                              qty: Number(order.quantity || 1),
                              total: Number(order.total_gs || 0),
                            }}
                          />
                          <button
                            type="button"
                            className="nav-btn !px-4 !py-2.5 !text-rose-300"
                            disabled={busy || saved}
                            onClick={() => void deleteOrders([order])}
                          >
                            {deleting ? "Eliminando..." : "🗑️ Eliminar pedido"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && visibleOrders.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 sm:px-4 py-3 text-xs text-muted-foreground">
            <span>
              Mostrando {nf(pagedOrders.length)} de {nf(visibleOrders.length)} · Gs. {nf(listTotal)}
              {usesDate ? ` · ${dateLabel}` : ""}
            </span>
            {visibleOrders.length > limit && (
              <button type="button" className="nav-btn !py-1.5 !text-xs" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Ver {Math.min(PAGE_SIZE, visibleOrders.length - limit)} más
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// PUENTE HACIA EL FORMULARIO INTERNO
// ============================================

export function StoreOrderTabBridge({
  onLoadOrder,
}: {
  onLoadOrder: (
    prefill: StoreOrderPrefill
  ) => void;
}) {
  const { user } = useAuth();

  const email =
    user?.email?.toLowerCase() ||
    "";

  const [ids, setIds] =
    useState<string[]>([]);

  const [index, setIndex] =
    useState(0);

  const [problem, setProblem] =
    useState("");

  useEffect(() => {
    const params = new URL(
      window.location.href
    ).searchParams;

    const raw =
      params.get(
        "store_order_ids"
      ) ||
      params.get(
        "store_order_id"
      );

    setIds(
      raw
        ? raw
            .split(",")
            .filter(
              (id) =>
                /^[0-9a-f-]{36}$/i.test(
                  id
                )
            )
            .slice(
              0,
              500
            )
        : []
    );

    setIndex(0);
  }, []);

  useEffect(() => {
    if (
      !email ||
      !ids[index]
    ) {
      return;
    }

    let active = true;

    (async () => {
      setProblem("");

      const {
        data,
        error,
      } = await supabase
        .from(
          "landing_page_orders"
        )
        .select(
          SELECT
        )
        .eq(
          "id",
          ids[index]
        )
        .eq(
          "seller_email",
          email
        )
        .maybeSingle();

      if (!active) {
        return;
      }

      if (
        error ||
        !data
      ) {
        setProblem(
          "No se pudo recuperar el pedido o no tenés acceso."
        );
        return;
      }

      onLoadOrder(
        makeStoreOrderPrefill(
          data as StoreOrder
        )
      );
    })();

    return () => {
      active = false;
    };
  }, [
    email,
    ids,
    index,
    onLoadOrder,
  ]);

  if (
    !ids.length
  ) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-border bg-background shadow-xl p-4 space-y-2">
      <b>
        📦 Mi Tienda ·{" "}
        {index + 1} de{" "}
        {ids.length}
      </b>

      {problem && (
        <p className="text-sm text-red-500">
          {problem}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Guardá el pedido en el
        formulario habitual antes de
        avanzar. Abrirlo no significa
        que haya sido creado.
      </p>

      <div className="flex gap-2">
        <button
          className="nav-btn"
          disabled={
            index === 0
          }
          onClick={() =>
            setIndex(
              (i) =>
                i - 1
            )
          }
        >
          Anterior
        </button>

        <button
          className="nav-btn active"
          disabled={
            index >=
            ids.length - 1
          }
          onClick={() =>
            setIndex(
              (i) =>
                i + 1
            )
          }
        >
          Siguiente ↗
        </button>
      </div>
    </div>
  );
}
