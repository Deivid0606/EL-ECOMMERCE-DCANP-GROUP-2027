import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import DropiButton from "@/components/DropiButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { compactKey, resolveCity, titleSimilarity, type CityMatch, type CityPrice } from "@/lib/fuzzyMatch";

const nf = (n: number) => new Intl.NumberFormat("es-PY").format(n);

const DASHBOARD_TIME_ZONE = "America/Asuncion";

const getDateKeyInTimeZone = (date: Date, timeZone = DASHBOARD_TIME_ZONE): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

const getTodayDateKey = (): string => getDateKeyInTimeZone(new Date());

const parseSheetDateKey = (value: any): string | null => {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  // Formato ISO / Shopify: 2026-08-13, 2026-08-13T20:30:00...
  const isoMatch = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // Formato habitual del Sheet en Paraguay: 13/8/2026, 13-08-2026, con o sin hora.
  const pyMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (pyMatch) {
    const [, day, month, year] = pyMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // Fallback para fechas completas que JavaScript sí pueda interpretar.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return getDateKeyInTimeZone(parsed);
  }

  return null;
};

type SheetOrder = Record<string, string>;

const AUTO_LOAD_KEY = "shopify_auto_load_enabled";
const ACTIVE_FILTER_KEY = "shopify_active_filter";
const PRODUCT_ALIAS_STORAGE_PREFIX = "shopify_product_aliases";
const CITY_ALIAS_STORAGE_PREFIX = "shopify_city_aliases";

type OrderStatus = "CARGAR" | "A DROPEAR" | "CARGADO" | "CARGADO_MANUAL" | "CANCELADO";
type FilterType = "TODOS" | "CARGAR" | "CARGADO" | "CARGADO_MANUAL" | "A DROPEAR" | "CANCELADO";

function extractPhoneNumber(value: any): string {
  if (!value) return "";
  let phone = String(value).replace(/[\s\-().+]/g, "").trim();
  if (phone.startsWith("595")) phone = "0" + phone.slice(3);
  if (phone.length === 9 && phone.match(/^\d+$/)) phone = "0" + phone;
  return phone;
}

const normalizeText = (text: string): string => {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/-/g, "")
    .trim();
};

// ─────────────────────────────────────────────────────────────
// COBERTURA DE CIUDADES
// Fuente única: ciudad + departamento + precio de delivery.
// De esta forma el precio y el departamento nunca quedan desincronizados.
// ─────────────────────────────────────────────────────────────
type CityCoverage = {
  name: string;
  department: string;
  price: number;
};

const CITY_COVERAGE_DATA: CityCoverage[] = [
  { name: "Altos", department: "Cordillera", price: 55000 },
  { name: "Aregua", department: "Central", price: 45000 },
  { name: "Asuncion", department: "Central", price: 35000 },
  { name: "Atyrá", department: "Cordillera", price: 55000 },
  { name: "Benjamín Aceval", department: "Presidente Hayes", price: 60000 },
  { name: "Caacupe", department: "Cordillera", price: 55000 },
  { name: "Caaguazú", department: "Caaguazú", price: 55000 },
  { name: "Capiata", department: "Central", price: 45000 },
  { name: "Carapeguá", department: "Paraguarí", price: 55000 },
  { name: "Ciudad del Este", department: "Alto Paraná", price: 45000 },
  { name: "Colonia Yguazu", department: "Alto Paraná", price: 50000 },
  { name: "Coronel Oviedo", department: "Caaguazú", price: 55000 },
  { name: "Emboscada", department: "Cordillera", price: 55000 },
  { name: "Escobar", department: "Paraguarí", price: 55000 },
  { name: "Eusebio Ayala", department: "Cordillera", price: 55000 },
  { name: "Félix Pérez Cardozo", department: "Caaguazú", price: 55000 },
  { name: "Fernando de la Mora", department: "Central", price: 35000 },
  { name: "General Bernardino Caballero", department: "Paraguarí", price: 55000 },
  { name: "Guarambare", department: "Central", price: 50000 },
  { name: "Hernandarias", department: "Alto Paraná", price: 50000 },
  { name: "INTERIOR PAGO ANTICIPADO", department: "Varios", price: 35000 },
  { name: "Ita", department: "Central", price: 55000 },
  { name: "Itacurubí de la Cordillera", department: "Cordillera", price: 55000 },
  { name: "Itaugua", department: "Central", price: 45000 },
  { name: "J. Augusto Saldívar", department: "Central", price: 45000 },
  { name: "Juan leon malloriquin", department: "Alto Paraná", price: 60000 },
  { name: "Karaguatay", department: "Cordillera", price: 55000 },
  { name: "Lambare", department: "Central", price: 35000 },
  { name: "Limpio", department: "Central", price: 40000 },
  { name: "Loma Grande", department: "Cordillera", price: 55000 },
  { name: "Luque", department: "Central", price: 35000 },
  { name: "Mariano Roque Alonso", department: "Central", price: 40000 },
  { name: "Mauricio José Troche", department: "Caaguazú", price: 55000 },
  { name: "Mbocayaty", department: "Guairá", price: 55000 },
  { name: "Minga Guazu", department: "Alto Paraná", price: 50000 },
  { name: "Natalicio Talavera", department: "Caaguazú", price: 55000 },
  { name: "Ñemby", department: "Central", price: 40000 },
  { name: "Nueva Italia", department: "Cordillera", price: 55000 },
  { name: "Paraguarí", department: "Paraguarí", price: 55000 },
  { name: "Pirayú", department: "Paraguarí", price: 55000 },
  { name: "Piribebuy", department: "Cordillera", price: 55000 },
  { name: "Presidente franco", department: "Alto Paraná", price: 50000 },
  { name: "Remansito", department: "Presidente Hayes", price: 60000 },
  { name: "Repatriación", department: "Caaguazú", price: 55000 },
  { name: "San Alberto", department: "Alto Paraná", price: 55000 },
  { name: "San Antonio", department: "Central", price: 45000 },
  { name: "San Bernardino", department: "Cordillera", price: 55000 },
  { name: "San José de los Arroyos", department: "Caaguazú", price: 55000 },
  { name: "San Lorenzo", department: "Central", price: 35000 },
  { name: "Santa Elena", department: "Cordillera", price: 55000 },
  { name: "Santa Rita", department: "Alto Paraná", price: 55000 },
  { name: "Sapucai", department: "Paraguarí", price: 55000 },
  { name: "Tobatí", department: "Cordillera", price: 55000 },
  { name: "Villa Elisa", department: "Central", price: 40000 },
  { name: "Villa Hayes", department: "Presidente Hayes", price: 60000 },
  { name: "Villarrica", department: "Guairá", price: 50000 },
  { name: "Villeta", department: "Central", price: 55000 },
  { name: "Yaguaron", department: "Paraguarí", price: 55000 },
  { name: "Yataity del Norte", department: "Caaguazú", price: 55000 },
  { name: "Yguazu", department: "Alto Paraná", price: 60000 },
  { name: "Ypacarai", department: "Cordillera", price: 50000 },
  { name: "Ypane", department: "Central", price: 45000 },
];

const CITY_COVERAGE_MAP: Record<string, number> = Object.fromEntries(
  CITY_COVERAGE_DATA.map((city) => [normalizeText(city.name), city.price]),
);

const CITY_DEPARTMENT_MAP: Record<string, string> = Object.fromEntries(
  CITY_COVERAGE_DATA.map((city) => [normalizeText(city.name), city.department]),
);

// Variantes habituales para evitar que pequeñas diferencias del Sheet
// hagan que una ciudad válida aparezca como "sin cobertura".
const CITY_ALIASES: Record<string, string> = {
  // Ciudad del Este
  cdeleste: "ciudaddeleste",
  cdedeleste: "ciudaddeleste",
  ciudadeste: "ciudaddeleste",

  // Coronel Oviedo
  cneloviedo: "coroneloviedo",

  // J. Augusto Saldívar
  augustosaldivar: "jaugustosaldivar",
  joseaugustosaldivar: "jaugustosaldivar",
  saldivar: "jaugustosaldivar",
  jagustosaldivar: "jaugustosaldivar",
  jagugustosaldivar: "jaugustosaldivar",

  // Juan León Mallorquín
  juanleonmallorquin: "juanleonmalloriquin",
  mallorquin: "juanleonmalloriquin",

  // Mariano Roque Alonso
  mra: "marianoroquealonso",

  // Mauricio José Troche
  mauriciotroche: "mauriciojosetroche",

  // Minga Guazú
  mingaguasu: "mingaguazu",

  // Presidente Franco
  puertopresidentefranco: "presidentefranco",
  ptofranco: "presidentefranco",
  pdtefranco: "presidentefranco",

  // San José de los Arroyos
  sanjosearroyos: "sanjosedelosarroyos",

  // Santa Elena
  santahelena: "santaelena",

  // Villa Elisa
  villaelsa: "villaelisa",

  // Errores frecuentes
  villela: "villeta",
  sanantonioi: "sanantonio",
  santoni: "sanantonio",

  // Interior pago anticipado
  interior: "interiorpagoanticipado",
  pagoanticipado: "interiorpagoanticipado",
};

const resolveCityKey = (cityName: string): string => {
  if (!cityName) return "";

  const normalized = normalizeText(cityName);

  if (Object.prototype.hasOwnProperty.call(CITY_COVERAGE_MAP, normalized)) {
    return normalized;
  }

  if (CITY_ALIASES[normalized]) {
    return CITY_ALIASES[normalized];
  }

  // Casos donde el campo CIUDAD llega acompañado por texto extra.
  if (normalized.includes("pagoanticipado") || normalized.includes("interior")) {
    return "interiorpagoanticipado";
  }

  if (normalized.includes("ciudaddeleste") || normalized.includes("cdedeleste")) {
    return "ciudaddeleste";
  }

  if (normalized.includes("presidentefranco") || normalized.includes("puertopresidentefranco")) {
    return "presidentefranco";
  }

  if (normalized.includes("augustosaldivar") || normalized === "saldivar") {
    return "jaugustosaldivar";
  }

  if (normalized.includes("villaelisa") || normalized.includes("villaelsa")) {
    return "villaelisa";
  }

  return normalized;
};

const hasCoverage = (cityName: string): boolean => {
  if (!cityName) return false;
  const cityKey = resolveCityKey(cityName);
  return Object.prototype.hasOwnProperty.call(CITY_COVERAGE_MAP, cityKey);
};

const getCityDeliveryPrice = (cityName: string): number | null => {
  if (!cityName) return null;
  const cityKey = resolveCityKey(cityName);
  return CITY_COVERAGE_MAP[cityKey] ?? null;
};

const getCityDepartment = (cityName: string): string | null => {
  if (!cityName) return null;
  const cityKey = resolveCityKey(cityName);
  return CITY_DEPARTMENT_MAP[cityKey] ?? null;
};

function parseQuantity(value: any): number {
  if (!value) return 1;
  let str = String(value).trim();
  if (str.includes('\n')) str = str.split('\n')[0].trim();
  str = str.replace(/["']/g, '');
  const numMatch = str.match(/\d+/);
  if (!numMatch) return 1;
  const num = parseInt(numMatch[0], 10);
  return isNaN(num) ? 1 : num;
}

function parseMoney(v: string): number {
  if (!v) return 0;
  let cleanValue = String(v);
  if (cleanValue.includes('\n')) cleanValue = cleanValue.split('\n')[0].trim();
  cleanValue = cleanValue.replace(/["']/g, '');
  let cleaned = cleanValue.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  return Math.round(Number(cleaned) || 0);
}

const findAmountInRow = (row: SheetOrder): number => {
  const excludeColumns = ["telefono", "phone", "tel", "celular", "whatsapp", "cantidad", "qty", "quantity", "fecha", "date", "estado", "status"];
  for (const key in row) {
    const value = row[key];
    if (!value) continue;
    const keyLower = key.toLowerCase();
    if (excludeColumns.some(ex => keyLower.includes(ex))) continue;
    const str = String(value).trim();
    const priceMatches = str.match(/\b\d{4,7}\b/g);
    if (priceMatches && priceMatches.length > 0) {
      for (const match of priceMatches) {
        const num = parseInt(match, 10);
        if (num >= 10000 && num <= 5000000) return num;
      }
    }
  }
  return 0;
};

const getAmountFromRow = (order: SheetOrder, amountColumn: string): number => {
  if (amountColumn && order[amountColumn]) {
    const parsed = parseMoney(order[amountColumn]);
    if (parsed > 0) return parsed;
  }
  for (const key in order) {
    if (key === "TOTAL A PAGAR" || key === "total a pagar") {
      const parsed = parseMoney(order[key]);
      if (parsed > 0) return parsed;
    }
  }
  const fallbackAmount = findAmountInRow(order);
  if (fallbackAmount > 0) return fallbackAmount;
  return 0;
};

const generateUniqueOrderId = async (): Promise<string> => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const newOrderNumber = `SHOPIFY${timestamp}${random}`;
  const { data: existing } = await supabase
    .from('orders')
    .select('order_number')
    .eq('order_number', newOrderNumber)
    .maybeSingle();
  if (!existing) return newOrderNumber;
  return generateUniqueOrderId();
};

interface ShopifyInboxProps {
  onSheetConfirm?: (prefill: {
    customer?: string; phone?: string; city?: string; street?: string;
    district?: string; productTitle?: string; totalGs?: number; qty?: number;
    sku?: string; departamento?: string; sheetRow?: { sheetUrl: string; rowIndex: number };
  }) => void;
}

export default function ShopifyInboxView({ onSheetConfirm }: ShopifyInboxProps) {
  const { profile } = useAuth();
  const myEmail = profile?.email || "";
  const sheetUrl = profile?.sheet_url || "";

  const [sheetOrders, setSheetOrders] = useState<SheetOrder[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  
  const [rowStatuses, setRowStatuses] = useState<Record<string, OrderStatus>>({});
  const [rowOrderNumbers, setRowOrderNumbers] = useState<Record<string, string>>({});
  
  const [autoLoad, setAutoLoad] = useState<boolean>(() => localStorage.getItem(AUTO_LOAD_KEY) === "true");
  // La auto-carga corre en el servidor (cada 5 min) aunque la app esté cerrada.
  const [serverAuto, setServerAuto] = useState<{ last_run_at: string | null; last_result: any } | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>(() => {
    const saved = localStorage.getItem(ACTIVE_FILTER_KEY) as FilterType;
    return saved || "CARGAR";
  });
  
  const [searchType, setSearchType] = useState<"all" | "product" | "city">("product");
  const [productSearch, setProductSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<"all" | "covered" | "uncovered">("covered");
  const [dashboardDate, setDashboardDate] = useState<string>(() => getTodayDateKey());
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<{ order: SheetOrder; rowKey: string } | null>(null);
  const [showGuideModal, setShowGuideModal] = useState(false);

  // Alias editables: permiten corregir/normalizar productos y ciudades sin tocar el Sheet.
  // Se guardan por usuario en localStorage.
  const [productAliases, setProductAliases] = useState<Record<string, string>>({});
  const [cityAliases, setCityAliases] = useState<Record<string, string>>({});
  const [showProductAliasModal, setShowProductAliasModal] = useState(false);
  const [showCityAliasModal, setShowCityAliasModal] = useState(false);
  const [selectedProductNames, setSelectedProductNames] = useState<Set<string>>(new Set());
  const [selectedCityNames, setSelectedCityNames] = useState<Set<string>>(new Set());
  const [productAliasTarget, setProductAliasTarget] = useState("");
  const [cityAliasTarget, setCityAliasTarget] = useState("");

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  // Tarifas reales de delivery por ciudad (tabla client_prices) y "producto → mi SKU".
  const [cityPrices, setCityPrices] = useState<CityPrice[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { sku: string; raw_title: string }>>({});
  const [skuDrafts, setSkuDrafts] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<"pedidos" | "productos" | "ciudades">("pedidos");
  const autoRunning = useRef(false);
  const autoFailed = useRef<Set<string>>(new Set());
  const loadingRows = useRef<Set<string>>(new Set());

  const colKeys = useMemo(() => {
    const h = sheetHeaders;
    const find = (...candidates: string[]) => {
      for (let i = 0; i < h.length; i++) {
        const normalizedHeader = normalizeText(h[i]);
        for (const candidate of candidates) {
          const normalizedCandidate = normalizeText(candidate);
          if (normalizedHeader === normalizedCandidate || normalizedHeader.includes(normalizedCandidate)) {
            return h[i];
          }
        }
      }
      return "";
    };
    return {
      name: find("nombre", "cliente", "customer", "name", "NOMBRE"),
      phone: find("telefono", "phone", "tel", "celular", "whatsapp", "Teléfono"),
      street: find("calle", "direccion", "address", "street", "CALLE"),
      city: find("ciudad", "city", "localidad", "distrito", "CIUDAD"),
      product: find("producto", "product", "articulo", "PRODUCTO"),
      qty: find("cantidad", "qty", "quantity", "unidades", "CANTIDAD"),
      amount: find("total", "monto", "precio", "importe", "venta", "MONTO"),
      date: find("fecha", "date", "FECHA"),
    };
  }, [sheetHeaders]);

  const productAliasStorageKey = `${PRODUCT_ALIAS_STORAGE_PREFIX}:${myEmail || "anon"}`;
  const cityAliasStorageKey = `${CITY_ALIAS_STORAGE_PREFIX}:${myEmail || "anon"}`;

  useEffect(() => {
    try {
      const savedProducts = localStorage.getItem(productAliasStorageKey);
      const savedCities = localStorage.getItem(cityAliasStorageKey);
      setProductAliases(savedProducts ? JSON.parse(savedProducts) : {});
      setCityAliases(savedCities ? JSON.parse(savedCities) : {});
    } catch (error) {
      console.error("Error leyendo alias guardados:", error);
      setProductAliases({});
      setCityAliases({});
    }
  }, [productAliasStorageKey, cityAliasStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(productAliasStorageKey, JSON.stringify(productAliases));
    } catch (error) {
      console.error("Error guardando alias de productos:", error);
    }
  }, [productAliases, productAliasStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(cityAliasStorageKey, JSON.stringify(cityAliases));
    } catch (error) {
      console.error("Error guardando alias de ciudades:", error);
    }
  }, [cityAliases, cityAliasStorageKey]);

  const getProductDisplayName = useCallback((rawName: string): string => {
    if (!rawName) return "Sin producto";
    return productAliases[normalizeText(rawName)] || rawName.trim();
  }, [productAliases]);

  const resolveCityWithUserAlias = useCallback((rawCity: string): string => {
    if (!rawCity) return "";
    const custom = cityAliases[normalizeText(rawCity)];
    return custom || rawCity;
  }, [cityAliases]);

  // Ciudades con cobertura: las tarifas reales; si no cargan, la lista de respaldo.
  const cityList = useMemo<CityPrice[]>(
    () =>
      cityPrices.length
        ? cityPrices
        : CITY_COVERAGE_DATA.map((c) => ({ city: c.name, price: c.price, departamento: c.department })),
    [cityPrices],
  );
  const userCityAliasMap = useMemo(
    () => Object.fromEntries(Object.entries(cityAliases).map(([k, v]) => [compactKey(k), v])),
    [cityAliases],
  );
  const cityMatchCache = useMemo(() => new Map<string, CityMatch | null>(), [cityList, userCityAliasMap]);
  // Detecta la ciudad aunque esté mal escrita, abreviada o con texto de más.
  const matchCity = useCallback(
    (rawCity: string): CityMatch | null => {
      const raw = String(rawCity || "");
      if (cityMatchCache.has(raw)) return cityMatchCache.get(raw) || null;
      const m = resolveCity(raw, cityList, userCityAliasMap);
      cityMatchCache.set(raw, m);
      return m;
    },
    [cityList, userCityAliasMap, cityMatchCache],
  );

  const hasCoverageForCity = useCallback((rawCity: string): boolean => Boolean(matchCity(rawCity)), [matchCity]);

  const getCityDeliveryPriceForCity = useCallback(
    (rawCity: string): number | null => {
      const m = matchCity(rawCity);
      return m ? Number(m.price) || null : null;
    },
    [matchCity],
  );

  const getCityDepartmentForCity = useCallback(
    (rawCity: string): string | null => {
      const m = matchCity(rawCity);
      if (!m) return null;
      return (m.departamento || "").trim() || getCityDepartment(m.city) || null;
    },
    [matchCity],
  );

  const getCityDisplayName = useCallback(
    (rawCity: string): string => matchCity(rawCity)?.city.trim() || resolveCityWithUserAlias(rawCity) || rawCity || "—",
    [matchCity, resolveCityWithUserAlias],
  );

  useEffect(() => {
    supabase
      .from("client_prices")
      .select("city, price_gs, departamento")
      .then(({ data, error }) => {
        if (error || !data?.length) return;
        setCityPrices(
          (data as any[])
            .filter((r) => r.city && Number(r.price_gs) > 0)
            .map((r) => ({ city: String(r.city).trim(), price: Number(r.price_gs), departamento: String(r.departamento || "").trim() })),
        );
      });
  }, []);

  const loadSkuMappings = useCallback(async () => {
    if (!myEmail) return;
    const { data, error } = await (supabase as any)
      .from("product_title_mappings")
      .select("title_key, raw_title, sku")
      .eq("owner_email", myEmail.toLowerCase());
    if (error) return;
    const map: Record<string, { sku: string; raw_title: string }> = {};
    (data || []).forEach((r: any) => {
      map[r.title_key] = { sku: r.sku, raw_title: r.raw_title };
    });
    setSkuMappings(map);
    autoFailed.current.clear();
  }, [myEmail]);

  useEffect(() => {
    void loadSkuMappings();
  }, [loadSkuMappings]);

  const loadServerAuto = useCallback(async () => {
    if (!myEmail) return;
    const { data } = await (supabase as any)
      .from("shopify_autoload_settings")
      .select("enabled, last_run_at, last_result")
      .eq("user_email", myEmail.toLowerCase())
      .maybeSingle();
    if (data) {
      setAutoLoad(Boolean(data.enabled));
      setServerAuto({ last_run_at: data.last_run_at, last_result: data.last_result });
    }
  }, [myEmail]);

  useEffect(() => {
    void loadServerAuto();
    const t = window.setInterval(() => void loadServerAuto(), 60_000);
    return () => window.clearInterval(t);
  }, [loadServerAuto]);

  // El servidor usa también tus correcciones de ciudades y productos.
  const aliasesReady = useRef(false);
  useEffect(() => {
    if (!myEmail) return;
    if (!aliasesReady.current) {
      aliasesReady.current = true;
      return;
    }
    const t = window.setTimeout(() => {
      void (supabase as any).from("shopify_autoload_settings").upsert(
        { user_email: myEmail.toLowerCase(), city_aliases: cityAliases, product_aliases: productAliases, updated_at: new Date().toISOString() },
        { onConflict: "user_email" },
      );
    }, 1500);
    return () => window.clearTimeout(t);
  }, [cityAliases, productAliases, myEmail]);

  const getRowKey = useCallback((order: SheetOrder, idx: number): string => {
    if (order.__row) {
      return String(order.__row);
    }
    return String(idx);
  }, []);

  const getRowStatus = useCallback((rowKey: string): OrderStatus => {
    return rowStatuses[rowKey] || "CARGAR";
  }, [rowStatuses]);

  const getRowOrderNumber = useCallback((rowKey: string): string | null => {
    return rowOrderNumbers[rowKey] || null;
  }, [rowOrderNumbers]);

  // ─── FIX: paginado para traer TODAS las filas, sin importar cuántas sean ───
  // Supabase/PostgREST devuelve por defecto un máximo de 1000 filas por consulta.
  // Si el usuario ya tiene más de 1000 estados guardados, el .select() sin
  // .range() los recorta silenciosamente (sin error) y la app nunca ve esos
  // estados "de más" -> los pedidos correspondientes vuelven a aparecer como
  // "Pendiente" aunque ya hayan sido cambiados y guardados correctamente.
  const loadStatusesFromDatabase = useCallback(async () => {
    if (!myEmail || !sheetUrl) return;
    setLoadingStatuses(true);
    try {
      const statusMap: Record<string, OrderStatus> = {};
      const orderNumberMap: Record<string, string> = {};
      const pageSize = 1000;
      let from = 0;
      let keepGoing = true;

      while (keepGoing) {
        const { data, error } = await supabase
          .from("sheet_row_statuses")
          .select("row_index, status, order_number")
          .eq("user_email", myEmail)
          .eq("sheet_url", sheetUrl)
          .range(from, from + pageSize - 1);

        if (error) throw error;

        (data || []).forEach(item => {
          const rowKey = String(item.row_index);
          statusMap[rowKey] = item.status as OrderStatus;
          if (item.order_number) orderNumberMap[rowKey] = item.order_number;
        });

        keepGoing = (data?.length || 0) === pageSize;
        from += pageSize;
      }

      setRowStatuses(statusMap);
      setRowOrderNumbers(orderNumberMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStatuses(false);
    }
  }, [myEmail, sheetUrl]);

  const persistRowStatus = useCallback(async (rowKey: string, status: OrderStatus, orderNumber?: string) => {
    if (!myEmail || !sheetUrl) {
      toast.error("Falta email o URL del sheet");
      return;
    }
    try {
      if (status !== "CARGAR") {
        const { error } = await supabase
          .from("sheet_row_statuses")
          .upsert({
            user_email: myEmail,
            sheet_url: sheetUrl,
            row_index: rowKey,
            status: status,
            order_number: orderNumber || null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_email,sheet_url,row_index'
          });
        if (error) throw error;
        const statusMessages: Record<OrderStatus, string> = {
          "CANCELADO": "❌ Cancelado",
          "A DROPEAR": "⚠️ A Dropear",
          "CARGADO": "✅ Cargado Auto",
          "CARGADO_MANUAL": "✍️ Cargado Manual",
          "CARGAR": "⏳ Pendiente"
        };
        toast.success(`✅ Estado: ${statusMessages[status] || status}`);
      } else {
        const { error } = await supabase
          .from("sheet_row_statuses")
          .delete()
          .eq("user_email", myEmail)
          .eq("sheet_url", sheetUrl)
          .eq("row_index", rowKey);
        if (error) throw error;
        toast.success(`✅ Estado: ⏳ Pendiente`);
      }
    } catch (error: any) {
      console.error("❌ Error al persistir estado:", error);
      toast.error(`Error: ${error.message}`);
      await loadStatusesFromDatabase();
    }
  }, [myEmail, sheetUrl, loadStatusesFromDatabase]);

  const setRowStatus = useCallback(async (rowKey: string, status: OrderStatus, orderNumber?: string) => {
    if (status === "CARGAR") {
      setRowStatuses(prev => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      setRowOrderNumbers(prev => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
    } else {
      setRowStatuses(prev => ({ ...prev, [rowKey]: status }));
      if (orderNumber) {
        setRowOrderNumbers(prev => ({ ...prev, [rowKey]: orderNumber }));
      }
    }
    await persistRowStatus(rowKey, status, orderNumber);
  }, [persistRowStatus]);

  useEffect(() => {
    if (!myEmail || !sheetUrl) return;
    const channel = supabase
      .channel('sheet_row_statuses_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sheet_row_statuses', filter: `user_email=eq.${myEmail}` },
        () => {
          loadStatusesFromDatabase();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myEmail, sheetUrl, loadStatusesFromDatabase]);

  useEffect(() => { localStorage.setItem(AUTO_LOAD_KEY, autoLoad.toString()); }, [autoLoad]);
  useEffect(() => { localStorage.setItem(ACTIVE_FILTER_KEY, activeFilter); }, [activeFilter]);

  // ─── FIX: mismo paginado para products, por si el catálogo supera las 1000 filas ───
  useEffect(() => {
    const loadAllProducts = async () => {
      try {
        const pageSize = 1000;
        let from = 0;
        let allProducts: any[] = [];
        let keepGoing = true;

        while (keepGoing) {
          const { data, error } = await supabase
            .from("products")
            .select("*")
            .range(from, from + pageSize - 1);

          if (error) throw error;

          allProducts = allProducts.concat(data || []);
          keepGoing = (data?.length || 0) === pageSize;
          from += pageSize;
        }

        setProducts(allProducts);
      } catch (err) {
        console.error("Error cargando productos:", err);
      }
    };
    loadAllProducts();
  }, []);

  useEffect(() => { if (myEmail && sheetUrl) loadStatusesFromDatabase(); }, [myEmail, sheetUrl, loadStatusesFromDatabase]);
  useEffect(() => { if (sheetUrl && !initialLoadDone) { readSheet(); setInitialLoadDone(true); } }, [sheetUrl]);

  const readSheet = useCallback(async (quiet = false) => {
    if (!sheetUrl) { if (!quiet) toast.error("Configurá tu URL de Google Sheet"); return; }
    if (!quiet) setLoading(true);
    try {
      const resp = await fetch(`/api/read-sheet?url=${encodeURIComponent(sheetUrl)}&t=${Date.now()}`);
      const json = await resp.json();
      if (json.error) { if (!quiet) toast.error(json.error); }
      else {
        setSheetHeaders(json.headers || []);
        setSheetOrders(json.orders || []);
        setLastSync(new Date());
        if (!quiet) toast.success(`📊 Sheet cargado: ${json.orders?.length || 0} filas`);
      }
    } catch (err: any) { if (!quiet) toast.error("Error: " + err.message); }
    if (!quiet) setLoading(false);
  }, [sheetUrl]);

  const productBySku = useMemo(() => {
    const m = new Map<string, any>();
    products.forEach((p) => {
      if (p?.sku) m.set(String(p.sku).trim().toLowerCase(), p);
    });
    return m;
  }, [products]);

  // Producto: 1) el SKU que asignaste a ese nombre, 2) nombre igual o parecido.
  const matchProductInfo = useCallback(
    (rawName: string): { product: any; method: "sku" | "auto" | "parecido" } | null => {
      if (!rawName) return null;
      const mapped = skuMappings[compactKey(rawName)];
      if (mapped) {
        const p = productBySku.get(String(mapped.sku).trim().toLowerCase());
        if (p) return { product: p, method: "sku" };
      }
      const direct = matchProductByName(rawName);
      if (direct) return { product: direct, method: "auto" };
      let best: { p: any; score: number } | null = null;
      for (const p of products) {
        const score = Math.max(titleSimilarity(rawName, p.title || ""), titleSimilarity(getProductDisplayName(rawName), p.title || ""));
        if (score >= 0.6 && (!best || score > best.score)) best = { p, score };
      }
      return best ? { product: best.p, method: "parecido" } : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skuMappings, productBySku, products, getProductDisplayName],
  );

  const matchProduct = useCallback((rawName: string) => matchProductInfo(rawName)?.product || null, [matchProductInfo]);
  // Para cargar en lote / automático: sólo productos seguros (SKU asignado o mismo nombre).
  const matchProductSafe = useCallback((rawName: string) => {
    const info = matchProductInfo(rawName);
    return info && info.method !== "parecido" ? info.product : null;
  }, [matchProductInfo]);

  function matchProductByName(rawName: string) {
    if (!rawName) return null;

    // Si el usuario unificó varios nombres, primero intentamos con el nombre corregido.
    const correctedName = getProductDisplayName(rawName);
    const cleanCorrected = normalizeText(correctedName);
    const cleanRaw = normalizeText(rawName);

    return products.find(p => normalizeText(p.title || "") === cleanCorrected) ||
           products.find(p => normalizeText(p.title || "") === cleanRaw) ||
           products.find(p => {
             const title = normalizeText(p.title || "");
             return title.includes(cleanCorrected) || cleanCorrected.includes(title);
           }) ||
           products.find(p => {
             const title = normalizeText(p.title || "");
             return title.includes(cleanRaw) || cleanRaw.includes(title);
           }) ||
           null;
  }

  const loadOrder = useCallback(async (order: SheetOrder, rowKey: string, source: "auto" | "manual" = "auto", quiet = false) => {
    const productName = order[colKeys.product] || "";
    const matched = matchProduct(productName);
    if (!matched) { if (!quiet) toast.error(`❌ Producto no detectado: "${productName}". Asignale tu SKU en 🔗 Productos ↔ SKU.`); return false; }

    const rawCity = order[colKeys.city] || "";
    const cityMatch = matchCity(rawCity);
    const deliveryPrice = cityMatch ? Number(cityMatch.price) || 0 : 0;
    if (!cityMatch || !deliveryPrice) { if (!quiet) toast.warning(`⚠️ Ciudad "${rawCity}" sin cobertura`); return false; }
    // Se guarda el nombre oficial de la ciudad: así la tarifa del delivery y la comisión salen bien.
    const city = cityMatch.city.trim();
    if (/pago\s*anticipado/i.test(city)) {
      if (!quiet) toast.info("📮 Interior pago anticipado: tocá «📮 Formulario» y subí el comprobante de pago.");
      return false;
    }

    const departamento = getCityDepartmentForCity(rawCity);
    if (!departamento && !quiet) toast.warning(`⚠️ No se pudo determinar el departamento para "${rawCity}"`);

    const salePrice = getAmountFromRow(order, colKeys.amount);
    if (salePrice === 0) { if (!quiet) toast.warning(`⚠️ No se detectó monto en fila ${rowKey}`); return false; }

    // Evita cargar dos veces la misma fila (otra pestaña, otro equipo o auto-carga en curso).
    if (loadingRows.current.has(rowKey)) return false;
    loadingRows.current.add(rowKey);
    try {
    const orderId = await generateUniqueOrderId();
    const newStatus: OrderStatus = source === "auto" ? "CARGADO" : "CARGADO_MANUAL";
      // Se "reserva" la fila antes de crear el pedido: si el servidor (auto-carga) u
      // otro equipo ya la tomó, no se duplica.
      const { error: claimError } = await (supabase as any).from("sheet_row_statuses").insert({
        user_email: myEmail,
        sheet_url: sheetUrl,
        row_index: Number(rowKey),
        status: newStatus,
        order_number: orderId,
        updated_at: new Date().toISOString(),
      });
      if (claimError) {
        if (!quiet) toast.info(`La fila ${rowKey} ya estaba cargada.`);
        await loadStatusesFromDatabase();
        return false;
      }
    const productCost = matched.provider_price_gs || 0;
    const qty = parseQuantity(order[colKeys.qty]);
    // Comisión = venta − (precio proveedor × cantidad) − delivery de la ciudad.
    const commission = salePrice - (productCost * qty + deliveryPrice);

    const payload = {
      order_number: orderId,
      created_by: myEmail,
      customer_name: order[colKeys.name] || "",
      phone: extractPhoneNumber(order[colKeys.phone] || ""),
      city: city,
      departamento: departamento || "",
      street: order[colKeys.street] || "",
      district: "", email: "", obs: "",
      items_json: [{
        sku: matched.sku || "",
        title: matched.title,
        qty,
        sale_gs: salePrice,
        provider_price_gs: productCost,
        provider_email: matched.provider_email || ""
      }],
      total_gs: salePrice,
      delivery_gs: deliveryPrice,
      commission_gs: commission,
      provider_emails_list: matched.provider_email || "",
    };

    const { error } = await supabase.from("orders").insert(payload);
    if (error) {
      // Se libera la fila para poder reintentar.
      await (supabase as any).from("sheet_row_statuses").delete()
        .eq("user_email", myEmail).eq("sheet_url", sheetUrl).eq("row_index", Number(rowKey)).eq("order_number", orderId);
      if (!quiet) toast.error("Error al guardar: " + error.message);
      return false;
    }

    setRowStatuses(prev => ({ ...prev, [rowKey]: newStatus }));
    setRowOrderNumbers(prev => ({ ...prev, [rowKey]: orderId }));
    if (!quiet) toast.success(`✅ Pedido ${orderId} cargado | ${city} · Delivery: ${nf(deliveryPrice)} Gs`);
    return true;
    } finally {
      loadingRows.current.delete(rowKey);
    }
  }, [colKeys, matchProduct, matchCity, getCityDepartmentForCity, myEmail, sheetUrl, loadStatusesFromDatabase]);

  // 🤖 Auto-carga: todos los pedidos pendientes con cobertura y producto detectado.
  const runAutoLoad = useCallback(async () => {
    if (autoRunning.current) return;
    autoRunning.current = true;
    let loaded = 0;
    try {
      for (let i = 0; i < sheetOrders.length; i++) {
        const order = sheetOrders[i];
        const rowKey = getRowKey(order, i);
        if (getRowStatus(rowKey) !== "CARGAR" || autoFailed.current.has(rowKey)) continue;
        if (!hasCoverageForCity(order[colKeys.city] || "")) continue;
        if (!matchProductSafe(order[colKeys.product] || "")) {
          autoFailed.current.add(rowKey);
          continue;
        }
        const ok = await loadOrder(order, rowKey, "auto", true);
        if (ok) loaded++;
        else autoFailed.current.add(rowKey);
      }
    } finally {
      autoRunning.current = false;
    }
    if (loaded) toast.success(`🤖 Auto-carga: ${loaded} pedido(s) nuevo(s) cargado(s)`);
  }, [sheetOrders, getRowKey, getRowStatus, hasCoverageForCity, matchProductSafe, loadOrder, colKeys]);

  useEffect(() => {
    if (!autoLoad || loadingStatuses || !products.length || !sheetOrders.length) return;
    void runAutoLoad();
  }, [autoLoad, loadingStatuses, products.length, sheetOrders, runAutoLoad]);

  // Con la auto-carga activa se vuelve a leer el Sheet cada minuto.
  useEffect(() => {
    if (!autoLoad || !sheetUrl) return;
    const timer = window.setInterval(() => void readSheet(true), 60_000);
    return () => window.clearInterval(timer);
  }, [autoLoad, sheetUrl, readSheet]);

  const handleDirectSave = (order: SheetOrder, rowKey: string) => loadOrder(order, rowKey, "auto");

  const handleOpenForm = (order: SheetOrder, rowKey: string) => {
    const rawCity = order[colKeys.city] || "";
    const cm = matchCity(rawCity);
    const prod = matchProductInfo(order[colKeys.product] || "")?.product;
    if (onSheetConfirm) onSheetConfirm({
      customer: order[colKeys.name] || "",
      phone: extractPhoneNumber(order[colKeys.phone] || ""),
      city: cm?.city.trim() || rawCity,
      departamento: getCityDepartmentForCity(rawCity) || "",
      sku: prod?.sku || "",
      sheetRow: sheetUrl && Number.isFinite(Number(rowKey)) ? { sheetUrl, rowIndex: Number(rowKey) } : undefined,
      street: order[colKeys.street] || "",
      productTitle: order[colKeys.product] || "",
      totalGs: getAmountFromRow(order, colKeys.amount),
      qty: parseQuantity(order[colKeys.qty]),
    });
  };

  const handleBulkLoad = async () => {
    let count = 0, errors = 0;
    for (let i = 0; i < sheetOrders.length; i++) {
      const order = sheetOrders[i];
      const rowKey = getRowKey(order, i);
      const status = getRowStatus(rowKey);
      if (status !== "CARGAR") continue;
      const city = order[colKeys.city] || "";
      if (!hasCoverageForCity(city)) continue;
      if (!matchProductSafe(order[colKeys.product] || "")) { errors++; continue; }
      const success = await loadOrder(order, rowKey, "auto", true);
      if (success) count++; else errors++;
      if (count % 3 === 0) await new Promise(r => setTimeout(r, 100));
    }
    toast.success(`✅ ${count} cargados | ⚠️ ${errors} sin cargar (revisá 🔗 Productos ↔ SKU)`);
  };

  const toggleRowSelection = (rowKey: string) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowKey)) {
        newSet.delete(rowKey);
      } else {
        newSet.add(rowKey);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedRows(new Set());
    } else {
      const allKeys = filteredOrders.map(item => item.rowKey);
      setSelectedRows(new Set(allKeys));
    }
    setSelectAll(!selectAll);
  };

  const bulkChangeStatus = async (newStatus: OrderStatus) => {
    if (selectedRows.size === 0) {
      toast.warning("⚠️ Seleccioná al menos una fila");
      return;
    }

    setBulkActionLoading(true);
    let successCount = 0;
    let errorCount = 0;

    const rows = Array.from(selectedRows);
    const batchSize = 10;
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const promises = batch.map(async (rowKey) => {
        try {
          const orderNumber = getRowOrderNumber(rowKey);
          
          if (newStatus === "CARGAR") {
            setRowStatuses(prev => {
              const next = { ...prev };
              delete next[rowKey];
              return next;
            });
            setRowOrderNumbers(prev => {
              const next = { ...prev };
              delete next[rowKey];
              return next;
            });
          } else {
            setRowStatuses(prev => ({ ...prev, [rowKey]: newStatus }));
          }

          await persistRowStatus(rowKey, newStatus, orderNumber || undefined);
          successCount++;
        } catch (error) {
          errorCount++;
        }
      });

      await Promise.all(promises);
      toast.info(`⏳ Procesando... ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
    }

    setSelectedRows(new Set());
    setSelectAll(false);
    setBulkActionLoading(false);

    toast.success(`✅ Estados actualizados: ${successCount} exitosos, ${errorCount} errores`);
  };

  const bulkLoadOrders = async () => {
    if (selectedRows.size === 0) {
      toast.warning("⚠️ Seleccioná al menos una fila");
      return;
    }

    setBulkActionLoading(true);
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    const rows = Array.from(selectedRows);
    const loadableRows: { rowKey: string; order: SheetOrder }[] = [];
    
    for (const rowKey of rows) {
      const status = getRowStatus(rowKey);
      if (status !== "CARGAR") {
        skippedCount++;
        continue;
      }
      
      const order = sheetOrders.find((o, idx) => getRowKey(o, idx) === rowKey);
      if (!order) {
        errorCount++;
        continue;
      }
      
      const city = order[colKeys.city] || "";
      if (!hasCoverageForCity(city)) {
        skippedCount++;
        continue;
      }
      
      loadableRows.push({ rowKey, order });
    }

    if (loadableRows.length === 0) {
      toast.warning(`⚠️ Ninguna fila seleccionada es cargable (${skippedCount} no cargables)`);
      setBulkActionLoading(false);
      return;
    }

    toast.info(`⏳ Cargando ${loadableRows.length} pedidos...`);

    const batchSize = 5;
    for (let i = 0; i < loadableRows.length; i += batchSize) {
      const batch = loadableRows.slice(i, i + batchSize);
      const promises = batch.map(async ({ rowKey, order }) => {
        try {
          const success = await loadOrder(order, rowKey, "auto");
          if (success) successCount++;
          else errorCount++;
        } catch (error) {
          errorCount++;
        }
      });

      await Promise.all(promises);
      toast.info(`⏳ Progreso: ${Math.min(i + batchSize, loadableRows.length)}/${loadableRows.length}`);
    }

    setSelectedRows(new Set());
    setSelectAll(false);
    setBulkActionLoading(false);

    toast.success(`✅ Pedidos cargados: ${successCount} exitosos, ${errorCount} errores, ${skippedCount} omitidos`);
  };

  const toggleAutoLoad = () => {
    if (!autoLoad) {
      const pending = sheetOrders.filter((o, i) => {
        const rowKey = getRowKey(o, i);
        return getRowStatus(rowKey) === "CARGAR" && hasCoverageForCity(o[colKeys.city] || "") && matchProductSafe(o[colKeys.product] || "");
      }).length;
      if (
        !window.confirm(
          `🤖 Auto-carga\n\nSe van a cargar automáticamente ${pending} pedido(s) pendientes con cobertura y producto detectado, ` +
            `y desde ahora cada pedido nuevo del Sheet (se revisa cada minuto mientras la app esté abierta).\n\n` +
            `Antes, marcá como Cancelado lo que no quieras cargar. ¿Activar?`,
        )
      )
        return;
      autoFailed.current.clear();
    }
    const next = !autoLoad;
    setAutoLoad(next);
    void (supabase as any)
      .from("shopify_autoload_settings")
      .upsert(
        {
          user_email: myEmail.toLowerCase(),
          enabled: next,
          enabled_at: next ? new Date().toISOString() : null,
          city_aliases: cityAliases,
          product_aliases: productAliases,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_email" },
      )
      .then(({ error }: any) => {
        if (error) toast.error("No se pudo guardar la auto-carga: " + error.message);
      });
    toast.info(next ? "🤖 Auto-carga activada: el servidor carga tus pedidos cada 5 minutos, aunque cierres la app" : "⏹️ Auto-carga desactivada");
  };

  const getDisplayAmount = (order: SheetOrder) => getAmountFromRow(order, colKeys.amount);

  const getOrderDate = (order: SheetOrder) => {
    const dateValue = order[colKeys.date];
    if (!dateValue) return "—";
    try { const d = new Date(dateValue); if (!isNaN(d.getTime())) return d.toLocaleDateString("es-PY"); } catch {}
    return String(dateValue).split(' ')[0];
  };

  const getAllFields = (order: SheetOrder) => {
    const camposPrincipales = ['FECHA', 'NOMBRE', 'Teléfono', 'CIUDAD', 'PRODUCTO', 'CANTIDAD', 'MONTO', 'REFERENCIA', 'CALLE'];
    const principales: Record<string, string> = {};
    const extras: Record<string, string> = {};
    for (const key in order) {
      const valor = order[key];
      if (!valor || valor.trim() === "") continue;
      if (camposPrincipales.some(campo => campo.toLowerCase() === key.toLowerCase())) {
        principales[key] = valor;
      } else {
        extras[key] = valor;
      }
    }
    return { principales, extras };
  };

  // ─── FECHA EXCLUSIVA DEL DASHBOARD SUPERIOR ───
  // Empieza SIEMPRE en hoy (zona horaria de Paraguay).
  // Esta fecha afecta únicamente KPIs + gráficos + Top ciudades.
  // NO afecta la tabla ni el ranking lateral de productos pendientes.
  const dashboardOrders = useMemo(() => {
    if (!dashboardDate) return sheetOrders;

    return sheetOrders.filter((order) => {
      const rawDate = order[colKeys.date];
      return parseSheetDateKey(rawDate) === dashboardDate;
    });
  }, [sheetOrders, colKeys.date, dashboardDate]);

  const dashboardDateLabel = useMemo(() => {
    if (!dashboardDate) return "Todas las fechas";
    const [year, month, day] = dashboardDate.split("-").map(Number);
    if (!year || !month || !day) return dashboardDate;
    return new Date(year, month - 1, day, 12, 0, 0).toLocaleDateString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }, [dashboardDate]);

  // ─── ESTADÍSTICAS PARA DASHBOARD SUPERIOR ───
  const dashboardStats = useMemo(() => {
    let pendientesConCobertura = 0, pendientesSinCobertura = 0, cargados = 0, dropeados = 0, cancelados = 0;
    let totalVenta = 0;

    dashboardOrders.forEach((order) => {
      const idx = sheetOrders.indexOf(order);
      const rowKey = getRowKey(order, idx);
      const city = order[colKeys.city] || "";
      const covered = hasCoverageForCity(city);
      const status = getRowStatus(rowKey);
      const amount = getAmountFromRow(order, colKeys.amount);

      if (status === "CARGAR") {
        if (covered) pendientesConCobertura++; else pendientesSinCobertura++;
      } else if (status === "CARGADO" || status === "CARGADO_MANUAL") {
        cargados++;
        totalVenta += amount;
      } else if (status === "A DROPEAR") {
        dropeados++;
      } else if (status === "CANCELADO") {
        cancelados++;
      }
    });

    const totalPedidos = dashboardOrders.length;
    const tasaCobertura = totalPedidos > 0 ? Math.round((pendientesConCobertura / totalPedidos) * 100) : 0;
    const tasaCargados = totalPedidos > 0 ? Math.round((cargados / totalPedidos) * 100) : 0;

    return {
      pendientesConCobertura,
      pendientesSinCobertura,
      cargados,
      dropeados,
      cancelados,
      totalPedidos,
      totalVenta,
      tasaCobertura,
      tasaCargados
    };
  }, [dashboardOrders, sheetOrders, colKeys, getRowKey, getRowStatus, hasCoverageForCity]);

  const counts = useMemo(() => {
    let cargarConCobertura = 0, cargarSinCobertura = 0, cargados = 0, aDropear = 0, cancelados = 0;
    sheetOrders.forEach((order, idx) => {
      const rowKey = getRowKey(order, idx);
      const status = getRowStatus(rowKey);
      const city = order[colKeys.city] || "";
      const covered = hasCoverageForCity(city);
      if (status === "CARGAR") {
        if (covered) cargarConCobertura++; else cargarSinCobertura++;
      } else if (status === "CARGADO" || status === "CARGADO_MANUAL") {
        cargados++;
      } else if (status === "A DROPEAR") {
        aDropear++;
      } else if (status === "CANCELADO") {
        cancelados++;
      }
    });
    return { cargarConCobertura, cargarSinCobertura, cargados, aDropear, cancelados, total: sheetOrders.length };
  }, [sheetOrders, colKeys, getRowKey, getRowStatus]);

  // ─── FILTERED ORDERS ───
  const filteredOrders = useMemo(() => {
    return sheetOrders
      .map((order, idx) => ({ order, idx, rowKey: getRowKey(order, idx) }))
      .filter(({ order, rowKey }) => {
        const status = getRowStatus(rowKey);
        const city = order[colKeys.city] || "";
        const covered = hasCoverageForCity(city);

        let estadoMatch = true;
        switch (activeFilter) {
          case "CARGAR":    estadoMatch = status === "CARGAR"; break;
          case "CARGADO":   estadoMatch = status === "CARGADO" || status === "CARGADO_MANUAL"; break;
          case "A DROPEAR": estadoMatch = status === "A DROPEAR"; break;
          case "CANCELADO": estadoMatch = status === "CANCELADO"; break;
          case "TODOS":     estadoMatch = true; break;
        }
        if (!estadoMatch) return false;

        let coberturaMatch = true;
        switch (coverageFilter) {
          case "covered":   coberturaMatch = covered === true; break;
          case "uncovered": coberturaMatch = covered === false; break;
          case "all":       coberturaMatch = true; break;
        }
        if (!coberturaMatch) return false;

        if (searchType === "product" && productSearch.trim()) {
          const product = order[colKeys.product] || "";
          return product.toLowerCase().includes(productSearch.toLowerCase());
        }
        if (searchType === "city" && cityFilter.trim()) {
          const cityName = order[colKeys.city] || "";
          return cityName.toLowerCase().includes(cityFilter.toLowerCase());
        }
        if (searchType === "all" && search.trim()) {
          const allText = Object.values(order).join(" ").toLowerCase();
          return allText.includes(search.toLowerCase());
        }
        return true;
      });
  }, [sheetOrders, activeFilter, search, productSearch, cityFilter, searchType, coverageFilter, colKeys, getRowKey, getRowStatus, hasCoverageForCity]);

  useEffect(() => {
    if (filteredOrders.length === 0) {
      setSelectAll(false);
      return;
    }
    const allKeys = filteredOrders.map(item => item.rowKey);
    const allSelected = allKeys.every(key => selectedRows.has(key));
    setSelectAll(allSelected);
  }, [filteredOrders, selectedRows]);

  const changeFilter = (filter: FilterType) => setActiveFilter(filter);

  const getRowClassName = (status: OrderStatus, hasCoverageCity: boolean) => {
    if (status === "CARGADO" || status === "CARGADO_MANUAL") return "bg-emerald-500/5 hover:bg-emerald-500/10";
    if (status === "A DROPEAR") return "bg-amber-500/5 hover:bg-amber-500/10";
    if (status === "CANCELADO") return "bg-rose-500/5 hover:bg-rose-500/10";
    if (!hasCoverageCity && status === "CARGAR") return "bg-orange-500/5 hover:bg-orange-500/10";
    return "hover:bg-white/5";
  };

  // ─── UI HELPERS PRO ───
  const statusTheme: Record<OrderStatus, { label: string; badge: string; dot: string; row: string }> = {
    "CARGAR": {
      label: "Pendiente",
      badge: "bg-blue-500/12 text-blue-200 border-blue-400/25",
      dot: "bg-blue-400",
      row: "hover:bg-blue-500/5"
    },
    "A DROPEAR": {
      label: "A dropear",
      badge: "bg-amber-500/12 text-amber-200 border-amber-400/25",
      dot: "bg-amber-400",
      row: "bg-amber-500/5 hover:bg-amber-500/10"
    },
    "CARGADO": {
      label: "Cargado auto",
      badge: "bg-emerald-500/12 text-emerald-200 border-emerald-400/25",
      dot: "bg-emerald-400",
      row: "bg-emerald-500/5 hover:bg-emerald-500/10"
    },
    "CARGADO_MANUAL": {
      label: "Cargado manual",
      badge: "bg-teal-500/12 text-teal-200 border-teal-400/25",
      dot: "bg-teal-400",
      row: "bg-teal-500/5 hover:bg-teal-500/10"
    },
    "CANCELADO": {
      label: "Cancelado",
      badge: "bg-rose-500/12 text-rose-200 border-rose-400/25",
      dot: "bg-rose-400",
      row: "bg-rose-500/5 hover:bg-rose-500/10"
    }
  };

  const getProRowClassName = (status: OrderStatus, hasCoverageCity: boolean) => {
    if (!hasCoverageCity && status === "CARGAR") return "bg-orange-500/5 hover:bg-orange-500/10";
    return statusTheme[status]?.row || getRowClassName(status, hasCoverageCity);
  };

  const MetricCard = ({
    title,
    value,
    subtitle,
    icon,
    tone = "blue"
  }: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: string;
    tone?: "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan";
  }) => {
    const tones = {
      blue: "from-blue-500/18 to-cyan-500/8 border-blue-400/20 text-blue-200 shadow-blue-950/20",
      emerald: "from-emerald-500/18 to-teal-500/8 border-emerald-400/20 text-emerald-200 shadow-emerald-950/20",
      amber: "from-amber-500/18 to-orange-500/8 border-amber-400/20 text-amber-200 shadow-amber-950/20",
      rose: "from-rose-500/18 to-pink-500/8 border-rose-400/20 text-rose-200 shadow-rose-950/20",
      violet: "from-violet-500/18 to-fuchsia-500/8 border-violet-400/20 text-violet-200 shadow-violet-950/20",
      cyan: "from-cyan-500/18 to-sky-500/8 border-cyan-400/20 text-cyan-200 shadow-cyan-950/20"
    };

    return (
      <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${tones[tone]} p-4 shadow-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20`}>
        <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/5 blur-xl" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-white md:text-3xl">{value}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-xl shadow-inner">
            {icon}
          </div>
        </div>
        {subtitle && <p className="mt-2 text-xs font-semibold text-slate-400">{subtitle}</p>}
      </div>
    );
  };

  const StatusBadge = ({ status }: { status: OrderStatus }) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${statusTheme[status].badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${statusTheme[status].dot}`} />
      {statusTheme[status].label}
    </span>
  );

  const DonutChart = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) {
      return <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 text-sm text-slate-500">Sin datos</div>;
    }

    let currentAngle = -90;
    const radius = 42;
    const center = 50;
    const circumference = 2 * Math.PI * radius;

    const segments = data.map((d) => {
      const percent = d.value / total;
      const dash = percent * circumference;
      const rotation = currentAngle;
      currentAngle += percent * 360;
      return { ...d, percent, dash, rotation };
    });

    return (
      <div className="grid gap-3 md:grid-cols-[190px_1fr] md:items-center">
        <div className="relative mx-auto h-44 w-44">
          <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_0_24px_rgba(59,130,246,0.22)]">
            <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(30,41,59,.9)" strokeWidth="13" />
            {segments.map((seg, i) => (
              <circle
                key={seg.label}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth="13"
                strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
                strokeLinecap="round"
                transform={`rotate(${seg.rotation} ${center} ${center})`}
                className="transition-opacity duration-300 hover:opacity-80"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black text-white">{total}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">pedidos</span>
          </div>
        </div>
        <div className="space-y-2">
          {segments.map((seg) => (
            <div key={seg.label} className="flex items-center justify-between rounded-xl border border-slate-800/70 bg-slate-950/45 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                <span className="text-sm font-bold text-slate-200">{seg.label}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-black text-white">{seg.value}</div>
                <div className="text-[10px] text-slate-500">{Math.round(seg.percent * 100)}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const ProgressBar = ({ value, total, label, color }: { value: number; total: number; label: string; color: string }) => {
    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-300">{label}</span>
          <span className="font-black text-white">{value} · {percentage}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-950 ring-1 ring-slate-800">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${percentage}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  };

  const renderGuideModal = () => {
    if (!showGuideModal || !selectedOrder) return null;
    const { order, rowKey } = selectedOrder;
    const status = getRowStatus(rowKey);
    const city = order[colKeys.city] || "";
    const covered = hasCoverageForCity(city);
    const deliveryPrice = getCityDeliveryPriceForCity(city);
    const departamento = getCityDepartmentForCity(city);
    const salePrice = getDisplayAmount(order);
    const productName = order[colKeys.product] || "";
    const matched = matchProduct(productName);
    const quantity = parseQuantity(order[colKeys.qty]);
    const orderNumber = getRowOrderNumber(rowKey);
    const { extras } = getAllFields(order);
    const totalConEnvio = salePrice + (deliveryPrice || 0);
    const unitPrice = quantity > 1 ? Math.round(salePrice / quantity) : salePrice;
    const commission = matched ? salePrice - (matched.provider_price_gs || 0) - (deliveryPrice || 0) : 0;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-md" onClick={() => setShowGuideModal(false)}>
        <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950 shadow-2xl shadow-black/60" onClick={(e) => e.stopPropagation()}>
          <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-5 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Guía de envío</p>
                <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-black text-white">
                  Pedido #{order.__row || "?"}
                  {orderNumber && <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-black text-emerald-300">{orderNumber}</span>}
                </h2>
                <p className="mt-1 text-sm text-slate-400">{getOrderDate(order)} · {order[colKeys.name] || "Cliente sin nombre"}</p>
              </div>
              <button onClick={() => setShowGuideModal(false)} className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xl font-bold text-slate-400 transition hover:text-white">×</button>
            </div>
          </div>

          <div className="max-h-[calc(92vh-108px)] overflow-y-auto p-6">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:col-span-2">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Estado actual</p>
                <div className="mt-3"><StatusBadge status={status} /></div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:col-span-2">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Cobertura</p>
                <div className={`mt-3 text-lg font-black ${covered ? "text-emerald-300" : "text-rose-300"}`}>
                  {covered ? "✅ Con cobertura" : "❌ Sin cobertura"}
                </div>
                {deliveryPrice && <p className="mt-1 text-sm font-bold text-amber-300">Delivery: {nf(deliveryPrice)} Gs</p>}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <h3 className="mb-4 text-sm font-black uppercase tracking-[0.18em] text-white">👤 Datos del cliente</h3>
                <div className="grid gap-3 text-sm">
                  <div><p className="text-xs font-bold text-slate-500">Nombre</p><p className="mt-1 font-bold text-white">{order[colKeys.name] || "—"}</p></div>
                  <div><p className="text-xs font-bold text-slate-500">Teléfono</p><p className="mt-1 font-bold text-white">{order[colKeys.phone] || "—"}</p></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs font-bold text-slate-500">Ciudad</p><p className={`mt-1 font-black ${covered ? "text-emerald-300" : "text-rose-300"}`}>{city || "—"}</p></div>
                    <div><p className="text-xs font-bold text-slate-500">Departamento</p><p className="mt-1 font-bold text-cyan-300">{departamento || "—"}</p></div>
                  </div>
                  <div><p className="text-xs font-bold text-slate-500">Dirección</p><p className="mt-1 font-bold text-white">{order[colKeys.street] || "—"}</p></div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <h3 className="mb-4 text-sm font-black uppercase tracking-[0.18em] text-white">💰 Resumen financiero</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Subtotal</span><span className="font-black text-white">{nf(salePrice)} Gs</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Envío</span><span className="font-black text-amber-300">{deliveryPrice ? nf(deliveryPrice) : "0"} Gs</span></div>
                  {matched && <div className="flex justify-between"><span className="text-slate-400">Comisión estimada</span><span className="font-black text-blue-300">{nf(commission)} Gs</span></div>}
                  <div className="border-t border-slate-800 pt-4">
                    <div className="flex justify-between text-lg"><span className="font-black text-white">TOTAL</span><span className="font-black text-emerald-300">{nf(totalConEnvio)} Gs</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="mb-4 text-sm font-black uppercase tracking-[0.18em] text-white">📦 Producto</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr className="border-b border-slate-800">
                      <th className="py-2 text-left">Producto</th>
                      <th className="py-2 text-center">Cantidad</th>
                      <th className="py-2 text-right">Precio unit.</th>
                      <th className="py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-800/70">
                      <td className="py-3 font-bold text-white">{productName || "—"}</td>
                      <td className="py-3 text-center font-bold text-white">{quantity}</td>
                      <td className="py-3 text-right font-bold text-white">{nf(unitPrice)} Gs</td>
                      <td className="py-3 text-right font-black text-emerald-300">{nf(salePrice)} Gs</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {matched && <p className="mt-3 text-xs font-bold text-slate-500">SKU: {matched.sku || "—"} · Costo: {nf(matched.provider_price_gs || 0)} Gs</p>}
            </div>

            {Object.keys(extras).length > 0 && (
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <h3 className="mb-4 text-sm font-black uppercase tracking-[0.18em] text-white">📋 Información adicional</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(extras).map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
                      <p className="text-xs font-bold text-slate-500">{key}</p>
                      <p className="mt-1 break-words font-semibold text-slate-200">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderProductAliasModal = () => {
    if (!showProductAliasModal) return null;

    const toggleName = (raw: string) => {
      setSelectedProductNames(prev => {
        const next = new Set(prev);
        if (next.has(raw)) next.delete(raw); else next.add(raw);
        return next;
      });
    };

    const applyAlias = () => {
      const target = productAliasTarget.trim();
      if (selectedProductNames.size === 0) { toast.warning("Seleccioná al menos un nombre de producto"); return; }
      if (!target) { toast.warning("Escribí o seleccioná el nombre final del producto"); return; }

      setProductAliases(prev => {
        const next = { ...prev };
        selectedProductNames.forEach(raw => { next[normalizeText(raw)] = target; });
        return next;
      });
      toast.success(`✅ ${selectedProductNames.size} nombre(s) unificados como “${target}”`);
      setSelectedProductNames(new Set());
      setProductAliasTarget("");
    };

    const removeSelectedAliases = () => {
      if (selectedProductNames.size === 0) { toast.warning("Seleccioná al menos un producto"); return; }
      setProductAliases(prev => {
        const next = { ...prev };
        selectedProductNames.forEach(raw => delete next[normalizeText(raw)]);
        return next;
      });
      toast.success("Alias eliminados para los productos seleccionados");
      setSelectedProductNames(new Set());
    };

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md" onClick={() => setShowProductAliasModal(false)}>
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between border-b border-slate-800 p-5">
            <div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Editor múltiple</p><h2 className="text-2xl font-black text-white">Unificar nombres de productos</h2><p className="mt-1 text-sm text-slate-400">Seleccioná varios nombres del Sheet y asignales un solo nombre. El Sheet original no se modifica.</p></div>
            <button onClick={() => setShowProductAliasModal(false)} className="rounded-xl bg-slate-800 px-3 py-2 font-black text-slate-300">×</button>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[1fr_320px]">
            <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-800">
              {uniqueProductNames.map(item => {
                const selected = selectedProductNames.has(item.raw);
                const changed = normalizeText(item.raw) !== normalizeText(item.display);
                return (
                  <label key={normalizeText(item.raw)} className={`flex cursor-pointer items-center gap-3 border-b border-slate-800/70 px-4 py-3 transition ${selected ? "bg-violet-500/10" : "hover:bg-white/5"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleName(item.raw)} className="h-4 w-4" />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white" title={item.raw}>{item.raw}</div>{changed && <div className="truncate text-xs font-bold text-violet-300">→ {item.display}</div>}</div>
                    <span className="rounded-full bg-slate-900 px-2 py-1 text-xs font-black text-slate-300">{item.count}</span>
                  </label>
                );
              })}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Seleccionados</p><p className="mt-1 text-3xl font-black text-white">{selectedProductNames.size}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Nombre final</label>
                <input list="catalog-product-titles" value={productAliasTarget} onChange={e => setProductAliasTarget(e.target.value)} placeholder="Ej: Procesador de Alimentos 3 en 1" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-violet-400" />
                <datalist id="catalog-product-titles">{products.map((p, i) => <option key={p.id || i} value={p.title || ""} />)}</datalist>
                <p className="mt-2 text-xs text-slate-500">Podés escribir un nombre o elegir uno existente del catálogo.</p>
              </div>
              <button onClick={applyAlias} className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white">✅ Aplicar a seleccionados</button>
              <button onClick={removeSelectedAliases} className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-sm font-black text-slate-300 ring-1 ring-slate-700">↩ Quitar alias seleccionados</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCityAliasModal = () => {
    if (!showCityAliasModal) return null;

    const toggleName = (raw: string) => {
      setSelectedCityNames(prev => {
        const next = new Set(prev);
        if (next.has(raw)) next.delete(raw); else next.add(raw);
        return next;
      });
    };

    const applyAlias = () => {
      if (selectedCityNames.size === 0) { toast.warning("Seleccioná al menos una ciudad"); return; }
      if (!cityAliasTarget) { toast.warning("Seleccioná la ciudad correcta"); return; }
      setCityAliases(prev => {
        const next = { ...prev };
        selectedCityNames.forEach(raw => { next[normalizeText(raw)] = cityAliasTarget; });
        return next;
      });
      toast.success(`✅ ${selectedCityNames.size} nombre(s) asociados a ${cityAliasTarget}`);
      setSelectedCityNames(new Set());
      setCityAliasTarget("");
    };

    const removeSelectedAliases = () => {
      if (selectedCityNames.size === 0) { toast.warning("Seleccioná al menos una ciudad"); return; }
      setCityAliases(prev => {
        const next = { ...prev };
        selectedCityNames.forEach(raw => delete next[normalizeText(raw)]);
        return next;
      });
      toast.success("Alias eliminados para las ciudades seleccionadas");
      setSelectedCityNames(new Set());
    };

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md" onClick={() => setShowCityAliasModal(false)}>
        <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between border-b border-slate-800 p-5">
            <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">Editor múltiple</p><h2 className="text-2xl font-black text-white">Corregir nombres de ciudades</h2><p className="mt-1 text-sm text-slate-400">Seleccioná una o varias variantes y asignalas a una ciudad válida con su departamento y delivery.</p></div>
            <button onClick={() => setShowCityAliasModal(false)} className="rounded-xl bg-slate-800 px-3 py-2 font-black text-slate-300">×</button>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[1fr_320px]">
            <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-800">
              {uniqueCityNames.map(item => {
                const selected = selectedCityNames.has(item.raw);
                const changed = normalizeText(item.raw) !== normalizeText(item.display);
                return (
                  <label key={normalizeText(item.raw)} className={`flex cursor-pointer items-center gap-3 border-b border-slate-800/70 px-4 py-3 transition ${selected ? "bg-cyan-500/10" : "hover:bg-white/5"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleName(item.raw)} className="h-4 w-4" />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white" title={item.raw}>{item.raw}</div>{changed && <div className="truncate text-xs font-bold text-cyan-300">→ {item.display}</div>}</div>
                    <span className={`rounded-full px-2 py-1 text-xs font-black ${item.covered ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>{item.count}</span>
                  </label>
                );
              })}
            </div>
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Seleccionadas</p><p className="mt-1 text-3xl font-black text-white">{selectedCityNames.size}</p></div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Ciudad correcta</label>
                <select value={cityAliasTarget} onChange={e => setCityAliasTarget(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400">
                  <option value="">Seleccionar...</option>
                  {CITY_COVERAGE_DATA.map(city => <option key={normalizeText(city.name)} value={city.name}>{city.name} · {city.department} · {nf(city.price)} Gs</option>)}
                </select>
              </div>
              <button onClick={applyAlias} className="w-full rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-black text-white">✅ Aplicar a seleccionadas</button>
              <button onClick={removeSelectedAliases} className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-sm font-black text-slate-300 ring-1 ring-slate-700">↩ Quitar alias seleccionados</button>
              <p className="rounded-2xl border border-rose-400/15 bg-rose-500/5 p-3 text-xs font-semibold text-rose-200">Pedro Juan Caballero ya no está en la lista de cobertura. Si aparece en el Sheet quedará como “Sin cobertura”, salvo que vos la asocies manualmente a otra ciudad.</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loadingStatuses) {
    return (
      <div className="flex h-64 items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 px-10 py-8 shadow-2xl">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm font-bold text-slate-300">Cargando pedidos...</span>
        </div>
      </div>
    );
  }

  // ─── DATOS PARA DASHBOARD PRO ───
  const pendingTotal = dashboardStats.pendientesConCobertura + dashboardStats.pendientesSinCobertura;
  const commissionTotal = dashboardOrders.reduce((sum, order) => {
    const idx = sheetOrders.indexOf(order);
    const rowKey = getRowKey(order, idx);
    const status = getRowStatus(rowKey);
    if (status !== "CARGADO" && status !== "CARGADO_MANUAL") return sum;
    const productName = order[colKeys.product] || "";
    const matched = matchProduct(productName);
    const salePrice = getAmountFromRow(order, colKeys.amount);
    const deliveryPrice = getCityDeliveryPriceForCity(order[colKeys.city] || "") || 0;
    return sum + (salePrice - ((matched?.provider_price_gs || 0) + deliveryPrice));
  }, 0);
  const avgTicket = dashboardStats.cargados > 0 ? Math.round(dashboardStats.totalVenta / dashboardStats.cargados) : 0;
  const cancelRate = dashboardStats.totalPedidos > 0 ? Math.round((dashboardStats.cancelados / dashboardStats.totalPedidos) * 100) : 0;

  const cityRanking = Object.entries(dashboardOrders.reduce((acc: Record<string, number>, order) => {
    const rawCity = order[colKeys.city] || "Sin ciudad";
    const city = rawCity === "Sin ciudad" ? rawCity : getCityDisplayName(rawCity);
    acc[city] = (acc[city] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Ranking operativo: SIEMPRE toma solo pedidos pendientes (CARGAR),
  // no depende de fecha ni del filtro de estado. Solo respeta cobertura.
  const productRanking = (() => {
    const grouped: Record<string, number> = {};

    sheetOrders.forEach((order, idx) => {
      const rowKey = getRowKey(order, idx);
      if (getRowStatus(rowKey) !== "CARGAR") return;

      const city = order[colKeys.city] || "";
      const covered = hasCoverageForCity(city);

      if (coverageFilter === "covered" && !covered) return;
      if (coverageFilter === "uncovered" && covered) return;

      const rawProduct = order[colKeys.product] || "Sin producto";
      const product = getProductDisplayName(rawProduct);
      grouped[product] = (grouped[product] || 0) + 1;
    });

    return Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  })();

  const pendingForCoverage = (() => {
    return sheetOrders.filter((order, idx) => {
      const rowKey = getRowKey(order, idx);
      if (getRowStatus(rowKey) !== "CARGAR") return false;
      const covered = hasCoverageForCity(order[colKeys.city] || "");
      if (coverageFilter === "covered") return covered;
      if (coverageFilter === "uncovered") return !covered;
      return true;
    }).length;
  })();

  const uniqueProductNames = (() => {
    const names = new Map<string, { raw: string; count: number; display: string }>();
    sheetOrders.forEach(order => {
      const raw = (order[colKeys.product] || "").trim();
      if (!raw) return;
      const key = normalizeText(raw);
      const current = names.get(key);
      if (current) current.count += 1;
      else names.set(key, { raw, count: 1, display: getProductDisplayName(raw) });
    });
    return Array.from(names.values()).sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
  })();

  const uniqueCityNames = (() => {
    const names = new Map<string, { raw: string; count: number; display: string; covered: boolean }>();
    sheetOrders.forEach(order => {
      const raw = (order[colKeys.city] || "").trim();
      if (!raw) return;
      const key = normalizeText(raw);
      const current = names.get(key);
      if (current) current.count += 1;
      else names.set(key, { raw, count: 1, display: getCityDisplayName(raw), covered: hasCoverageForCity(raw) });
    });
    return Array.from(names.values()).sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
  })();

  const maxCityCount = Math.max(1, ...cityRanking.map(([, value]) => value));
  const maxProductCount = Math.max(1, ...productRanking.map(([, value]) => value));

  const pieData = [
    { label: "Pendientes", value: pendingTotal, color: "#3b82f6" },
    { label: "Cargados", value: dashboardStats.cargados, color: "#10b981" },
    { label: "Dropear", value: dashboardStats.dropeados, color: "#f59e0b" },
    { label: "Cancelados", value: dashboardStats.cancelados, color: "#ef4444" },
  ].filter(d => d.value > 0);

  // Nombres de producto y ciudades tal como vienen del Sheet, con lo que se detectó.
  const sheetProductRows = (() => {
    const map = new Map<string, { raw: string; count: number; pending: number }>();
    sheetOrders.forEach((o, i) => {
      const raw = String(o[colKeys.product] || "").trim();
      if (!raw) return;
      const key = compactKey(raw);
      const row = map.get(key) || { raw, count: 0, pending: 0 };
      row.count++;
      if (getRowStatus(getRowKey(o, i)) === "CARGAR") row.pending++;
      map.set(key, row);
    });
    return [...map.entries()]
      .map(([key, r]) => ({ key, ...r, info: matchProductInfo(r.raw) }))
      .sort((a, b) => Number(Boolean(a.info)) - Number(Boolean(b.info)) || b.pending - a.pending || b.count - a.count);
  })();
  const unmatchedProductCount = sheetProductRows.filter((r) => !r.info).length;

  const sheetCityRows = (() => {
    const map = new Map<string, { raw: string; count: number }>();
    sheetOrders.forEach((o) => {
      const raw = String(o[colKeys.city] || "").trim();
      if (!raw) return;
      const row = map.get(raw.toLowerCase()) || { raw, count: 0 };
      row.count++;
      map.set(raw.toLowerCase(), row);
    });
    return [...map.values()]
      .map((r) => ({ ...r, match: matchCity(r.raw) }))
      .sort((a, b) => Number(Boolean(a.match)) - Number(Boolean(b.match)) || b.count - a.count);
  })();
  const unmatchedCityCount = sheetCityRows.filter((r) => !r.match).length;

  const saveSkuMapping = async (rawTitle: string, key: string) => {
    const sku = String(skuDrafts[key] || "").split(" — ")[0].trim();
    if (!sku) {
      toast.error("Elegí o escribí el SKU");
      return;
    }
    const product = productBySku.get(sku.toLowerCase());
    if (!product) {
      toast.error(`No existe un producto con el SKU "${sku}"`);
      return;
    }
    const { error } = await (supabase as any).from("product_title_mappings").upsert(
      { owner_email: myEmail.toLowerCase(), title_key: key, raw_title: rawTitle, sku: product.sku, updated_at: new Date().toISOString() },
      { onConflict: "owner_email,title_key" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`🔗 "${rawTitle}" → ${product.sku} · ${product.title}`);
    setSkuDrafts((d) => ({ ...d, [key]: "" }));
    await loadSkuMappings();
  };

  const removeSkuMapping = async (key: string) => {
    const { error } = await (supabase as any)
      .from("product_title_mappings")
      .delete()
      .eq("owner_email", myEmail.toLowerCase())
      .eq("title_key", key);
    if (error) toast.error(error.message);
    else {
      toast.success("Asignación quitada");
      await loadSkuMappings();
    }
  };

  const renderMappingPanel = () => {
    if (panel === "productos") {
      return (
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl">
          <h2 className="text-lg font-black text-white">🔗 Nombre del producto ↔ mi SKU</h2>
          <p className="mb-4 text-sm text-slate-400">
            Cada vendedor pone el título que quiere en su página. Asigná acá tu SKU una sola vez y los pedidos con ese nombre se detectan siempre bien.
          </p>
          <datalist id="dcanp-sku-options">
            {products
              .filter((p) => p?.sku)
              .map((p) => (
                <option key={p.id || p.sku} value={`${p.sku} — ${p.title}`} />
              ))}
          </datalist>
          {!sheetProductRows.length && <div className="text-sm text-slate-500">Leé el Sheet para ver los productos de tus pedidos.</div>}
          <div className="space-y-2">
            {sheetProductRows.map((r) => {
              const mapped = skuMappings[r.key];
              return (
                <div
                  key={r.key}
                  className={`grid gap-2 rounded-2xl border p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] md:items-center ${r.info ? "border-slate-800 bg-slate-950/50" : "border-rose-500/40 bg-rose-500/5"}`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-bold text-white" title={r.raw}>{r.raw}</div>
                    <div className="text-[11px] text-slate-400">{r.count} pedido(s) · {r.pending} pendiente(s)</div>
                  </div>
                  <div className="min-w-0 text-sm">
                    {r.info ? (
                      <>
                        <div className="truncate text-emerald-300" title={r.info.product.title}>✅ {r.info.product.title}</div>
                        <div className="text-[11px] text-slate-400">
                          SKU {r.info.product.sku || "—"} ·{" "}
                          {r.info.method === "sku" ? "🔗 asignado por vos" : r.info.method === "auto" ? "🤖 mismo nombre" : "🤔 nombre parecido: confirmalo"}
                        </div>
                      </>
                    ) : (
                      <div className="font-bold text-rose-300">❌ Sin detectar: no se carga</div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      list="dcanp-sku-options"
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                      placeholder={mapped ? `Asignado: ${mapped.sku}` : "Escribí tu SKU o buscá el producto"}
                      value={skuDrafts[r.key] || ""}
                      onChange={(e) => setSkuDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                    />
                    <button type="button" className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white" onClick={() => void saveSkuMapping(r.raw, r.key)}>
                      Guardar
                    </button>
                    {mapped && (
                      <button type="button" className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-black text-slate-300" onClick={() => void removeSkuMapping(r.key)} title="Quitar asignación">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl">
        <h2 className="text-lg font-black text-white">🏙️ Ciudades detectadas</h2>
        <p className="mb-4 text-sm text-slate-400">
          Se reconoce la ciudad aunque esté mal escrita o abreviada, y se usa la tarifa real de delivery de esa ciudad para la comisión. Si alguna quedó mal,
          usá 📍 Corregir ciudades en la pestaña Pedidos.
        </p>
        {!sheetCityRows.length && <div className="text-sm text-slate-500">Leé el Sheet para ver las ciudades de tus pedidos.</div>}
        <div className="space-y-1.5">
          {sheetCityRows.map((r) => (
            <div
              key={r.raw}
              className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border px-3 py-2 text-sm ${r.match ? "border-slate-800 bg-slate-950/50" : "border-rose-500/40 bg-rose-500/5"}`}
            >
              <div className="min-w-0">
                <div className="truncate font-bold text-white">{r.raw}</div>
                <div className="text-[11px] text-slate-400">{r.count} pedido(s)</div>
              </div>
              <div className="min-w-0">
                {r.match ? (
                  <>
                    <div className="truncate text-emerald-300">✅ {r.match.city.trim()}</div>
                    <div className="text-[11px] text-slate-400">
                      {r.match.departamento || getCityDepartment(r.match.city) || "—"} ·{" "}
                      {r.match.method === "exacta" ? "igual" : r.match.method === "alias" ? "abreviatura / corregida" : r.match.method === "contiene" ? "dentro del texto" : `parecida (${Math.round(r.match.score * 100)}%)`}
                    </div>
                  </>
                ) : (
                  <div className="font-bold text-rose-300">❌ Sin cobertura</div>
                )}
              </div>
              <div className="text-right font-black text-white">{r.match ? `${nf(Number(r.match.price))} Gs` : "—"}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="relative h-full w-full overflow-auto bg-slate-950 p-2 text-slate-100 md:p-3">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_32%)]" />
      <div className="relative flex w-full min-w-0 flex-col gap-3">
        {/* HEADER */}
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-2xl shadow-lg shadow-blue-950/40">📦</div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Panel operativo</p>
                <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">Pedidos Shopify</h1>
                <p className="text-sm font-medium text-slate-400">Pedidos, cobertura, carga automática y métricas en tiempo real.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/8 px-2 py-1.5">
                <span className="pl-1 text-xs font-black text-cyan-300">📅 Dashboard</span>
                <input
                  type="date"
                  value={dashboardDate}
                  onChange={(e) => setDashboardDate(e.target.value || getTodayDateKey())}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-black text-white outline-none focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={() => setDashboardDate(getTodayDateKey())}
                  className="rounded-xl bg-cyan-500/15 px-2.5 py-1.5 text-xs font-black text-cyan-200 ring-1 ring-cyan-400/20 transition hover:bg-cyan-500/25"
                >
                  Hoy
                </button>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-950/70 px-4 py-2 text-xs font-bold text-slate-300">{dashboardStats.totalPedidos} pedidos · {dashboardDateLabel}</span>
              {lastSync && <span className="rounded-full border border-slate-700 bg-slate-950/70 px-4 py-2 text-xs font-bold text-slate-400">🔄 {lastSync.toLocaleTimeString("es-PY")}</span>}
              <button className="rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-950/40 transition hover:-translate-y-0.5 disabled:opacity-50" onClick={() => readSheet()} disabled={loading}>
                {loading ? "⏳ Leyendo..." : "📊 Leer Sheet"}
              </button>
              <button className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-950/40 transition hover:-translate-y-0.5" onClick={handleBulkLoad}>
                🚀 Cargar todos
              </button>
              <button className={`rounded-2xl px-4 py-2.5 text-sm font-black shadow-lg transition hover:-translate-y-0.5 ${autoLoad ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/25" : "bg-slate-800 text-slate-300 ring-1 ring-slate-700"}`} onClick={toggleAutoLoad}>
                {autoLoad ? "🤖 Auto ON" : "🤖 Auto OFF"}
              </button>
              {autoLoad && (
                <span
                  className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-200"
                  title="La auto-carga corre en el servidor aunque cierres la app"
                >
                  ☁️ Servidor:{" "}
                  {serverAuto?.last_run_at
                    ? `revisó ${new Date(serverAuto.last_run_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}` +
                      (serverAuto.last_result?.error
                        ? ` · ⚠️ ${serverAuto.last_result.error}`
                        : ` · cargó ${serverAuto.last_result?.loaded ?? 0}`)
                    : "primera revisión en menos de 5 min"}
                </span>
              )}
              <button className="rounded-2xl bg-slate-800 px-4 py-2.5 text-sm font-black text-slate-300 ring-1 ring-slate-700 transition hover:-translate-y-0.5 hover:text-white" onClick={() => loadStatusesFromDatabase()}>
                🔄 Recargar
              </button>
            </div>
          </div>
        </div>

        {/* PESTAÑAS */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["pedidos", "📦 Pedidos"],
              ["productos", `🔗 Productos ↔ SKU${unmatchedProductCount ? ` (${unmatchedProductCount} sin detectar)` : ""}`],
              ["ciudades", `🏙️ Ciudades${unmatchedCityCount ? ` (${unmatchedCityCount} sin cobertura)` : ""}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPanel(key)}
              className={`rounded-2xl px-4 py-2.5 text-sm font-black transition ${panel === key ? "bg-white text-slate-950" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {panel !== "pedidos" && renderMappingPanel()}

        <div className={panel === "pedidos" ? "contents" : "hidden"}>
        {/* KPIS */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard title="Ventas" value={`${nf(dashboardStats.totalVenta)} Gs`} subtitle={`Cargados · ${dashboardDateLabel}`} icon="💰" tone="emerald" />
          <MetricCard title="Pedidos" value={dashboardStats.totalPedidos} subtitle={dashboardDateLabel} icon="📊" tone="violet" />
          <MetricCard title="Pendientes" value={pendingTotal} subtitle={`✅ ${dashboardStats.pendientesConCobertura} · ❌ ${dashboardStats.pendientesSinCobertura}`} icon="⏳" tone="blue" />
          <MetricCard title="Cargados" value={dashboardStats.cargados} subtitle={`Tasa ${dashboardStats.tasaCargados}%`} icon="✅" tone="emerald" />
          <MetricCard title="Comisión" value={`${nf(commissionTotal)} Gs`} subtitle={`Ticket promedio ${nf(avgTicket)} Gs`} icon="🏦" tone="cyan" />
          <MetricCard title="Cancelados" value={dashboardStats.cancelados} subtitle={`Tasa ${cancelRate}%`} icon="❌" tone="rose" />
        </div>

        {/* GRAFICOS */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl shadow-black/20 backdrop-blur-xl xl:col-span-1">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">Distribución de estados</h2>
                <p className="text-sm font-medium text-slate-400">Estados del {dashboardDateLabel}.</p>
              </div>
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-300 ring-1 ring-blue-400/20">Live</span>
            </div>
            <DonutChart data={pieData} />
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl shadow-black/20 backdrop-blur-xl xl:col-span-1">
            <h2 className="text-lg font-black text-white">Cobertura</h2>
            <p className="mb-5 text-sm font-medium text-slate-400">Pendientes del {dashboardDateLabel}.</p>
            <div className="space-y-5">
              <ProgressBar value={dashboardStats.pendientesConCobertura} total={pendingTotal} label="Con cobertura" color="#10b981" />
              <ProgressBar value={dashboardStats.pendientesSinCobertura} total={pendingTotal} label="Sin cobertura" color="#ef4444" />
              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/8 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-300">Tasa de cobertura</span>
                  <span className="text-2xl font-black text-emerald-300">{dashboardStats.tasaCobertura}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl shadow-black/20 backdrop-blur-xl xl:col-span-1">
            <h2 className="text-lg font-black text-white">Top ciudades</h2>
            <p className="mb-5 text-sm font-medium text-slate-400">Mayor volumen del {dashboardDateLabel}.</p>
            <div className="space-y-3">
              {cityRanking.length === 0 && <div className="text-sm text-slate-500">Sin datos</div>}
              {cityRanking.map(([city, value]) => (
                <div key={city} className="space-y-2">
                  <div className="flex justify-between gap-3 text-sm"><span className="truncate font-bold text-slate-200">{city}</span><span className="font-black text-white">{value}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-950"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${Math.round((value / maxCityCount) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FILTROS */}
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => changeFilter("TODOS")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeFilter === "TODOS" ? "bg-white text-slate-950" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700 hover:text-white"}`}>📋 Todos <span className="opacity-70">({counts.total})</span></button>
              <button onClick={() => changeFilter("CARGAR")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeFilter === "CARGAR" ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/25" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700 hover:text-white"}`}>⏳ Pendientes <span className="opacity-70">({counts.cargarConCobertura})</span></button>
              <button onClick={() => changeFilter("CARGADO")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeFilter === "CARGADO" ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/25" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700 hover:text-white"}`}>✅ Cargados <span className="opacity-70">({counts.cargados})</span></button>
              <button onClick={() => changeFilter("A DROPEAR")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeFilter === "A DROPEAR" ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/25" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700 hover:text-white"}`}>⚠️ Dropear <span className="opacity-70">({counts.aDropear})</span></button>
              <button onClick={() => changeFilter("CANCELADO")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${activeFilter === "CANCELADO" ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/25" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700 hover:text-white"}`}>❌ Cancelado <span className="opacity-70">({counts.cancelados})</span></button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => setCoverageFilter("all")} className={`rounded-2xl px-3 py-2 text-sm font-black transition ${coverageFilter === "all" ? "bg-white text-slate-950" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700"}`}>🌍 Todas</button>
              <button onClick={() => setCoverageFilter("covered")} className={`rounded-2xl px-3 py-2 text-sm font-black transition ${coverageFilter === "covered" ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/25" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700"}`}>✅ Con cobertura</button>
              <button onClick={() => setCoverageFilter("uncovered")} className={`rounded-2xl px-3 py-2 text-sm font-black transition ${coverageFilter === "uncovered" ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/25" : "bg-slate-800/80 text-slate-300 ring-1 ring-slate-700"}`}>❌ Sin cobertura</button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[auto_1fr_auto] xl:items-center">
            <div className="flex gap-1 rounded-2xl border border-slate-800 bg-slate-950/60 p-1">
              <button onClick={() => setSearchType("product")} className={`rounded-xl px-3 py-2 text-xs font-black transition ${searchType === "product" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>🏷️ Producto</button>
              <button onClick={() => setSearchType("city")} className={`rounded-xl px-3 py-2 text-xs font-black transition ${searchType === "city" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>📍 Ciudad</button>
              <button onClick={() => setSearchType("all")} className={`rounded-xl px-3 py-2 text-xs font-black transition ${searchType === "all" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>🔍 Todo</button>
            </div>

            <input
              className="min-w-[220px] rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10"
              placeholder={searchType === "product" ? "Buscar producto..." : searchType === "city" ? "Buscar ciudad..." : "Buscar en todos los campos..."}
              value={searchType === "product" ? productSearch : searchType === "city" ? cityFilter : search}
              onChange={(e) => {
                if (searchType === "product") setProductSearch(e.target.value);
                else if (searchType === "city") setCityFilter(e.target.value);
                else setSearch(e.target.value);
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setSelectedProductNames(new Set()); setProductAliasTarget(""); setShowProductAliasModal(true); }}
                className="rounded-2xl bg-violet-500/15 px-3 py-3 text-sm font-black text-violet-200 ring-1 ring-violet-400/25 transition hover:bg-violet-500/25"
              >
                ✏️ Unificar productos
              </button>
              <button
                onClick={() => { setSelectedCityNames(new Set()); setCityAliasTarget(""); setShowCityAliasModal(true); }}
                className="rounded-2xl bg-cyan-500/15 px-3 py-3 text-sm font-black text-cyan-200 ring-1 ring-cyan-400/25 transition hover:bg-cyan-500/25"
              >
                📍 Corregir ciudades
              </button>
            </div>
          </div>
        </div>

        {/* ACCIONES EN LOTE */}
        {selectedRows.size > 0 && (
          <div className="sticky top-3 z-20 flex flex-wrap items-center gap-2 rounded-3xl border border-blue-400/25 bg-blue-950/70 p-3 shadow-2xl shadow-blue-950/30 backdrop-blur-xl">
            <span className="rounded-full bg-blue-500/15 px-4 py-2 text-sm font-black text-blue-200">✅ {selectedRows.size} seleccionado{selectedRows.size > 1 ? "s" : ""}</span>
            <select
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white outline-none focus:border-blue-400"
              onChange={(e) => {
                const value = e.target.value;
                if (value) {
                  bulkChangeStatus(value as OrderStatus);
                  e.target.value = "";
                }
              }}
              defaultValue=""
              disabled={bulkActionLoading}
            >
              <option value="">📝 Cambiar estado...</option>
              <option value="CARGAR">⏳ Pendiente</option>
              <option value="A DROPEAR">⚠️ Dropear</option>
              <option value="CANCELADO">❌ Cancelado</option>
              <option value="CARGADO">✅ Auto</option>
              <option value="CARGADO_MANUAL">✍️ Manual</option>
            </select>
            <button className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50" onClick={bulkLoadOrders} disabled={bulkActionLoading}>🚀 Cargar seleccionados</button>
            <button className="rounded-2xl bg-slate-800 px-4 py-2 text-sm font-black text-slate-300 ring-1 ring-slate-700 transition hover:text-white disabled:opacity-50" onClick={() => { setSelectedRows(new Set()); setSelectAll(false); }} disabled={bulkActionLoading}>✖ Limpiar</button>
            {bulkActionLoading && <span className="text-sm font-black text-amber-300 animate-pulse">⏳ Procesando...</span>}
          </div>
        )}

        {/* TABLA Y RANKING */}
        <div className="grid gap-3 2xl:grid-cols-[1fr_340px]">
          <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/80 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-white">Pedidos</h2>
                <p className="text-sm font-medium text-slate-400">Mostrando {filteredOrders.length} de {sheetOrders.length} filas</p>
              </div>
            </div>

            <div className="max-h-[720px] overflow-auto">
              <table className="w-full min-w-[1220px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-xl">
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-4 py-3 text-center w-12">
                      <input type="checkbox" checked={selectAll} onChange={toggleSelectAll} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-500 focus:ring-blue-500" disabled={filteredOrders.length === 0 || bulkActionLoading} />
                    </th>
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">ID</th>
                    <th className="px-3 py-3">Fecha</th>
                    <th className="px-3 py-3">Cliente</th>
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Ciudad</th>
                    <th className="px-3 py-3">Depto.</th>
                    <th className="px-3 py-3 text-right">Delivery</th>
                    <th className="px-3 py-3">Producto</th>
                    <th className="px-3 py-3 text-center">Cant</th>
                    <th className="px-3 py-3 text-right">Venta</th>
                    <th className="px-3 py-3 text-center">Estado</th>
                    <th className="px-3 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredOrders.map(({ order, idx, rowKey }) => {
                    const status = getRowStatus(rowKey);
                    const city = order[colKeys.city] || "";
                    const deliveryPrice = getCityDeliveryPriceForCity(city);
                    const covered = deliveryPrice !== null;
                    const salePrice = getDisplayAmount(order);
                    const orderDate = getOrderDate(order);
                    const isPrepaid = /pago\s*anticipado/i.test(getCityDisplayName(city));
                    const canLoad = status === "CARGAR" && covered && salePrice > 0 && !isPrepaid;
                    const orderNumber = getRowOrderNumber(rowKey);
                    const departamento = getCityDepartmentForCity(city);
                    const rowDisplay = order.__row || String(idx + 1);
                    const isSelected = selectedRows.has(rowKey);

                    return (
                      <tr key={rowKey} className={`${getProRowClassName(status, covered)} ${isSelected ? "bg-blue-500/10 ring-1 ring-inset ring-blue-400/20" : ""} transition-colors`}>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelection(rowKey)} className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-500 focus:ring-blue-500" disabled={bulkActionLoading} />
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-bold text-slate-500">{rowDisplay}</td>
                        <td className="px-3 py-3 font-mono text-xs">{orderNumber ? <span className="font-black text-emerald-300">{orderNumber}</span> : <span className="text-slate-600">—</span>}</td>
                        <td className="px-3 py-3 font-semibold text-slate-300">{orderDate}</td>
                        <td className="px-3 py-3"><div className="max-w-[170px] truncate font-black text-white" title={order[colKeys.name] || ""}>{order[colKeys.name] || "—"}</div></td>
                        <td className="px-3 py-3 font-semibold text-slate-300">{order[colKeys.phone] || "—"}</td>
                        <td className="px-3 py-3"><div className={`max-w-[170px] truncate font-black ${covered ? "text-emerald-300" : "text-rose-300"}`} title={city}>{getCityDisplayName(city)}</div></td>
                        <td className="px-3 py-3"><span className={departamento ? "font-bold text-cyan-300" : "text-slate-500"}>{departamento || "—"}</span></td>
                        <td className="px-3 py-3 text-right">{deliveryPrice ? <span className="font-black text-amber-300">{nf(deliveryPrice)} Gs</span> : <span className="text-slate-500">—</span>}</td>
                        <td className="px-3 py-3"><div className="max-w-[220px] truncate font-semibold text-slate-300" title={order[colKeys.product] || ""}>{getProductDisplayName(order[colKeys.product] || "")}</div></td>
                        <td className="px-3 py-3 text-center font-black text-white">{parseQuantity(order[colKeys.qty])}</td>
                        <td className="px-3 py-3 text-right font-black text-emerald-300">{salePrice > 0 ? `${nf(salePrice)} Gs` : "—"}</td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <StatusBadge status={status} />
                            <select
                              className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-bold text-white outline-none transition focus:border-blue-400"
                              value={status}
                              onChange={(e) => {
                                const newStatus = e.target.value as OrderStatus;
                                if (newStatus === "CARGAR") {
                                  setRowStatuses(prev => {
                                    const next = { ...prev };
                                    delete next[rowKey];
                                    return next;
                                  });
                                  setRowOrderNumbers(prev => {
                                    const next = { ...prev };
                                    delete next[rowKey];
                                    return next;
                                  });
                                } else {
                                  setRowStatuses(prev => ({ ...prev, [rowKey]: newStatus }));
                                }
                                persistRowStatus(rowKey, newStatus, orderNumber || undefined);
                              }}
                            >
                              <option value="CARGAR">⏳ Pendiente</option>
                              <option value="A DROPEAR">⚠️ Dropear</option>
                              <option value="CANCELADO">❌ Cancelado</option>
                              <option value="CARGADO">✅ Auto</option>
                              <option value="CARGADO_MANUAL">✍️ Manual</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {canLoad && <button className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-3 py-2 text-xs font-black text-white shadow-lg shadow-blue-950/30 transition hover:-translate-y-0.5" onClick={() => handleDirectSave(order, rowKey)}>Cargar</button>}
                            <button className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-black text-slate-200 ring-1 ring-slate-700 transition hover:text-white" onClick={() => { setSelectedOrder({ order, rowKey }); setShowGuideModal(true); }}>📄 Guía</button>
                            <button className="rounded-xl bg-violet-600/90 px-3 py-2 text-xs font-black text-white transition hover:bg-violet-600" onClick={() => handleOpenForm(order, rowKey)}>{isPrepaid ? "📮 Formulario + comprobante" : "Formulario"}</button>
                            {!isPrepaid && <DropiButton
                              order={{
                                customer: order[colKeys.name] || "",
                                phone: order[colKeys.phone] || "",
                                department: departamento || "",
                                city: getCityDisplayName(city) || city,
                                address: [order[colKeys.street], order[Object.keys(order).find((k) => /referencia/i.test(k)) || ""]]
                                  .map((v) => String(v || "").trim())
                                  .filter(Boolean)
                                  .join(" · "),
                                product: getProductDisplayName(order[colKeys.product] || ""),
                                qty: parseQuantity(order[colKeys.qty]),
                                total: salePrice,
                              }}
                            />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={14} className="py-14 text-center text-sm font-bold text-slate-500">
                        {sheetOrders.length === 0 ? "📭 No hay pedidos cargados. Hacé clic en Leer Sheet para comenzar." : "🔍 No hay pedidos que coincidan con los filtros."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-white">Productos pendientes</h2>
                  <p className="mb-5 text-sm font-medium text-slate-400">Sin fecha · solo pedidos que todavía están en Pendiente.</p>
                </div>
                <button onClick={() => { setSelectedProductNames(new Set()); setProductAliasTarget(""); setShowProductAliasModal(true); }} className="rounded-xl bg-violet-500/15 px-2.5 py-1.5 text-xs font-black text-violet-200 ring-1 ring-violet-400/25">✏️ Editar</button>
              </div>
              <div className="space-y-3">
                {productRanking.length === 0 && <div className="text-sm text-slate-500">No hay productos pendientes para este filtro.</div>}
                {productRanking.map(([product, value]) => (
                  <div key={product} className="space-y-2">
                    <div className="flex justify-between gap-3 text-sm"><span className="truncate font-bold text-slate-200" title={product}>{product}</span><span className="font-black text-white">{value}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-950"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-400" style={{ width: `${Math.round((value / maxProductCount) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
              <h2 className="text-lg font-black text-white">Resumen rápido</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between rounded-2xl bg-slate-950/60 p-3"><span className="font-bold text-slate-400">Pendientes del filtro</span><span className="font-black text-white">{pendingForCoverage}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-950/60 p-3"><span className="font-bold text-slate-400">Productos distintos</span><span className="font-black text-violet-300">{productRanking.length}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-950/60 p-3"><span className="font-bold text-slate-400">Visible en tabla</span><span className="font-black text-blue-300">{filteredOrders.length}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-950/60 p-3"><span className="font-bold text-slate-400">Filtro cobertura</span><span className="font-black text-cyan-300">{coverageFilter === "covered" ? "Con cobertura" : coverageFilter === "uncovered" ? "Sin cobertura" : "Todas"}</span></div>
              </div>
            </div>
          </aside>
        </div>

        </div>

        {renderGuideModal()}
        {renderProductAliasModal()}
        {renderCityAliasModal()}
      </div>
    </div>
  );
}
