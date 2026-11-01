import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PARAGUAY_LOCATIONS, locationKey } from "@/lib/paraguayLocations";

export type BuilderProduct = {
  id: string;
  title: string;
  sku: string | null;
  suggested_price_gs: number | null;
  provider_price_gs: number | null;
  image_url: string | null;
  image_url_2: string | null;
  image_url_3: string | null;
  description: string | null;
  warranty_info: string | null;
  warehouse_city: string | null;
};

type PageStatus = "draft" | "published";
export type LandingMediaType = "image" | "video";

export type LandingMediaItem = {
  id: string;
  type: LandingMediaType;
  url: string;
  alt?: string;
};

export type LandingContentBlock =
  | {
      id: string;
      type: "heading";
      enabled: boolean;
      text: string;
      emoji?: string;
      align: "left" | "center";
      size: "md" | "lg" | "xl";
    }
  | {
      id: string;
      type: "text";
      enabled: boolean;
      text: string;
      align: "left" | "center";
    }
  | {
      id: string;
      type: "image";
      enabled: boolean;
      url: string;
      alt: string;
      width: "normal" | "wide" | "full";
      rounded: boolean;
      text: string;
      textPosition: "top" | "bottom" | "left" | "right" | "overlay-top" | "overlay-center" | "overlay-bottom";
      textAlign: "left" | "center" | "right";
      blockAlign: "left" | "center" | "right";
      marginTop: number;
      marginBottom: number;
      imageScale: number;
      imageOffsetX: number;
      imageOffsetY: number;
    }
  | {
      id: string;
      type: "video";
      enabled: boolean;
      url: string;
      poster?: string;
      autoplay: boolean;
      muted: boolean;
      loop: boolean;
      controls: boolean;
      width: "normal" | "wide" | "full";
      rounded: boolean;
    }
  | {
      id: string;
      type: "media_gallery";
      enabled: boolean;
      items: LandingMediaItem[];
      columns: 1 | 2 | 3 | 4;
      mobileColumns: 1 | 2;
      gap: number;
      width: "normal" | "wide" | "full";
      aspect: "auto" | "portrait" | "square";
      rounded: boolean;
      controls: boolean;
      autoplay: boolean;
      muted: boolean;
      loop: boolean;
    }
  | {
      id: string;
      type: "video_row";
      enabled: boolean;
      videos: LandingMediaItem[];
      desktopColumns: 1 | 2 | 3;
      mobileColumns: 1 | 2 | 3;
      gap: number;
      width: "normal" | "wide" | "full";
      aspect: "portrait" | "square" | "auto";
      rounded: boolean;
      controls: boolean;
      autoplay: boolean;
      muted: boolean;
      loop: boolean;
    }
  | {
      id: string;
      type: "buy_button";
      enabled: boolean;
      text: string;
      subtext: string;
      width: "normal" | "wide" | "full";
      align: "left" | "center" | "right";
      backgroundColor: string;
      textColor: string;
      borderColor: string;
      borderWidth: number;
      borderRadius: number;
      fontSize: number;
      paddingY: number;
      effect: "none" | "shake" | "pulse" | "bounce" | "shine";
      effectEverySeconds: number;
    }
  | {
      id: string;
      type: "quantity_offers";
      enabled: boolean;
      title: string;
      width: "normal" | "wide" | "full";
      align: "left" | "center" | "right";
    }
  | {
      id: string;
      type: "image_text";
      enabled: boolean;
      imageUrl: string;
      title: string;
      text: string;
      imagePosition: "top" | "bottom" | "left" | "right" | "overlay";
      textAlign: "left" | "center" | "right";
      width: "normal" | "wide" | "full";
      blockAlign: "left" | "center" | "right";
      marginTop: number;
      marginBottom: number;
      imageScale: number;
      imageOffsetX: number;
      imageOffsetY: number;
    }
  | {
      id: string;
      type: "custom_html";
      enabled: boolean;
      html: string;
      width: "normal" | "wide" | "full";
    }
  | {
      id: string;
      type: "spacer";
      enabled: boolean;
      height: number;
    };

type LandingRow = {
  id: string;
  owner_email: string;
  name: string;
  slug: string;
  status: PageStatus;
  config: LandingConfig;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type LandingProductSnapshot = {
  id: string;
  title: string;
  sku: string;
  price: number;
  compareAtPrice: number;
  images: string[];
  media: LandingMediaItem[];
  description: string;
  warranty: string;
  warehouseCity: string;
};

export type QuantityOffer = {
  id: string;
  quantity: number;
  priceGs: number;
  compareAtPriceGs: number;
  title: string;
  description: string;
  label: string;
  badge: string;
  imageUrl: string;
  highlight: boolean;
};

export type CheckoutCustomSection = {
  id: string;
  title: string;
  text: string;
  icon: string;
  placement:
    | "before_offers"
    | "after_offers"
    | "before_shipping"
    | "before_form"
    | "after_form";
  backgroundColor: string;
  textColor: string;
  borderColor: string;
};

export type LandingConfig = {
  version: 2;
  selectedProductIds: string[];
  productSnapshots: LandingProductSnapshot[];
  announcement: string;
  primaryColor: string;
  accentColor: string;
  buttonColor: string;
  buttonText: string;
  buttonSubtext: string;
  mainButtonTextColor: string;
  mainButtonBorderColor: string;
  mainButtonBorderWidth: number;
  mainButtonBorderRadius: number;
  mainButtonFontSize: number;
  mainButtonPaddingY: number;
  mainButtonEffect: "none" | "shake" | "pulse" | "bounce" | "shine";
  mainButtonEffectEverySeconds: number;
  quantityOffers: QuantityOffer[];
  checkoutSections: CheckoutCustomSection[];
  coverageMode: "all" | "custom" | "platform";
  hiddenDepartments: string[];
  hiddenCities: string[];
  reviewsText: string;
  rating: number;
  heroHeadline: string;
  heroDescription: string;
  checkoutTitle: string;
  shippingText: string;
  expressText: string;
  sections: {
    timeline: boolean;
    description: boolean;
    benefits: boolean;
    gallery: boolean;
    warranty: boolean;
    relatedProducts: boolean;
    faq: boolean;
  };
  benefits: string[];
  faq: { question: string; answer: string }[];
  contentBlocks: LandingContentBlock[];
};

const MEDIA_BUCKET = "landing-media";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;


const sanitizeCustomHtml = (html: string) => {
  if (!html || typeof window === "undefined") return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  doc
    .querySelectorAll(
      "script, iframe, object, embed, link, meta, base, form, input, textarea, select",
    )
    .forEach((node) => node.remove());

  doc.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }

      if (
        ["src", "href", "xlink:href", "formaction"].includes(name) &&
        (value.startsWith("javascript:") || value.startsWith("data:text/html"))
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return doc.body.innerHTML;
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const defaultConfig = (): LandingConfig => ({
  version: 2,
  selectedProductIds: [],
  productSnapshots: [],
  announcement: "🛍 ENVIOS GRATIS Y PAGAS AL RECIBIR",
  primaryColor: "#743c98",
  accentColor: "#111111",
  buttonColor: "#ff1717",
  buttonText: "👉 CLICK AQUI Y PAGA EN CASA 👈",
  buttonSubtext: "PAGAS EN TU CASA AL RECIBIR !!!",
  mainButtonTextColor: "#ffffff",
  mainButtonBorderColor: "#000000",
  mainButtonBorderWidth: 5,
  mainButtonBorderRadius: 40,
  mainButtonFontSize: 14,
  mainButtonPaddingY: 10,
  mainButtonEffect: "shake",
  mainButtonEffectEverySeconds: 5,
  quantityOffers: [],
  checkoutSections: [],
  coverageMode: "all",
  hiddenDepartments: [],
  hiddenCities: [],
  reviewsText: "(xxxx Reviews)",
  rating: 4.8,
  heroHeadline: "⚡ Una sola herramienta para hacer tu día más fácil.",
  heroDescription:
    "Una solución práctica, rápida y pensada para quienes buscan resultados sin complicaciones.",
  checkoutTitle: "PAGAS EN TU CASA AL RECIBIR ✅",
  shippingText: "Envío gratis · Periodo de entrega de 2 a 4 días 🚚",
  expressText: "Entrega express 24 horas ⚡ válido según cobertura",
  sections: {
    timeline: true,
    description: true,
    benefits: true,
    gallery: true,
    warranty: true,
    relatedProducts: true,
    faq: true,
  },
  benefits: [
    "Fácil de usar",
    "Entrega a todo Paraguay",
    "Pagás al recibir",
    "Compra rápida y segura",
  ],
  faq: [
    {
      question: "¿Cómo realizo mi pedido?",
      answer:
        "Presioná el botón de comprar, completá tus datos y confirmá el pedido.",
    },
    {
      question: "¿Cómo se realiza el pago?",
      answer:
        "En zonas habilitadas podés pagar al recibir. La modalidad final se informa al confirmar el pedido.",
    },
  ],
  contentBlocks: [],
});

const nf = (n: number) =>
  new Intl.NumberFormat("es-PY").format(Math.round(Number(n || 0)));

const mediaFromProduct = (p: BuilderProduct): LandingMediaItem[] =>
  [p.image_url, p.image_url_2, p.image_url_3]
    .filter(Boolean)
    .map((url) => ({
      id: uid(),
      type: "image" as const,
      url: String(url),
      alt: p.title,
    }));

function snapshotFromProduct(p: BuilderProduct): LandingProductSnapshot {
  const price = Number(p.suggested_price_gs || p.provider_price_gs || 0);
  const media = mediaFromProduct(p);
  return {
    id: p.id,
    title: p.title,
    sku: p.sku || "",
    price,
    compareAtPrice: price > 0 ? Math.round(price * 1.8) : 0,
    images: media.filter((m) => m.type === "image").map((m) => m.url),
    media,
    description: p.description || "",
    warranty: p.warranty_info || "",
    warehouseCity: p.warehouse_city || "",
  };
}

function normalizeConfig(raw?: Partial<LandingConfig> | null): LandingConfig {
  const base = defaultConfig();
  const config: LandingConfig = {
    ...base,
    ...(raw || {}),
    version: 2,
    sections: {
      ...base.sections,
      ...(raw?.sections || {}),
    },
    benefits: raw?.benefits || base.benefits,
    faq: raw?.faq || base.faq,
    mainButtonTextColor: raw?.mainButtonTextColor || "#ffffff",
    mainButtonBorderColor: raw?.mainButtonBorderColor || "#000000",
    mainButtonBorderWidth: Number.isFinite(Number(raw?.mainButtonBorderWidth))
      ? Number(raw?.mainButtonBorderWidth)
      : 5,
    mainButtonBorderRadius: Number.isFinite(Number(raw?.mainButtonBorderRadius))
      ? Number(raw?.mainButtonBorderRadius)
      : 40,
    mainButtonFontSize: Number.isFinite(Number(raw?.mainButtonFontSize))
      ? Number(raw?.mainButtonFontSize)
      : 14,
    mainButtonPaddingY: Number.isFinite(Number(raw?.mainButtonPaddingY))
      ? Number(raw?.mainButtonPaddingY)
      : 10,
    mainButtonEffect: ["none","shake","pulse","bounce","shine"].includes(
      String(raw?.mainButtonEffect),
    )
      ? (raw?.mainButtonEffect as "none" | "shake" | "pulse" | "bounce" | "shine")
      : "shake",
    mainButtonEffectEverySeconds: Number.isFinite(Number(raw?.mainButtonEffectEverySeconds))
      ? Math.max(2, Number(raw?.mainButtonEffectEverySeconds))
      : 5,
    quantityOffers: Array.isArray(raw?.quantityOffers)
      ? raw!.quantityOffers!.map((offer: any) => ({
          id: offer.id || uid(),
          quantity: Math.max(1, Number(offer.quantity || 1)),
          priceGs: Math.max(0, Number(offer.priceGs || 0)),
          compareAtPriceGs: Math.max(0, Number(offer.compareAtPriceGs || offer.compareAtPrice || 0)),
          title: offer.title || offer.label || "",
          description: offer.description || "",
          label: offer.label || "",
          badge: offer.badge || "",
          imageUrl: offer.imageUrl || "",
          highlight: Boolean(offer.highlight),
        }))
      : [],
    checkoutSections: Array.isArray(raw?.checkoutSections)
      ? raw!.checkoutSections!.map((section: any) => ({
          id: section.id || uid(),
          title: section.title || "",
          text: section.text || "",
          icon: section.icon || "⭐",
          placement: ["before_offers","after_offers","before_shipping","before_form","after_form"].includes(section.placement)
            ? section.placement
            : "before_form",
          backgroundColor: section.backgroundColor || "#fff8e8",
          textColor: section.textColor || "#111111",
          borderColor: section.borderColor || "#e5c76b",
        }))
      : [],
    coverageMode: ["all","custom","platform"].includes(String(raw?.coverageMode))
      ? (raw?.coverageMode as "all" | "custom" | "platform")
      : "all",
    hiddenDepartments: Array.isArray(raw?.hiddenDepartments) ? raw!.hiddenDepartments! : [],
    hiddenCities: Array.isArray(raw?.hiddenCities) ? raw!.hiddenCities! : [],
    contentBlocks: (raw?.contentBlocks || []).map((block: any) => {
      if (block?.type === "media_gallery") {
        return {
          id: block.id || uid(),
          type: "media_gallery" as const,
          enabled: block.enabled !== false,
          items: Array.isArray(block.items) ? block.items : [],
          columns: [1, 2, 3, 4].includes(Number(block.columns))
            ? Number(block.columns)
            : 3,
          mobileColumns: [1, 2].includes(Number(block.mobileColumns))
            ? Number(block.mobileColumns)
            : 1,
          gap: Number.isFinite(Number(block.gap)) ? Number(block.gap) : 14,
          width: ["normal", "wide", "full"].includes(block.width)
            ? block.width
            : "wide",
          aspect: ["auto", "portrait", "square"].includes(block.aspect)
            ? block.aspect
            : "portrait",
          rounded: block.rounded !== false,
          controls: block.controls !== false,
          autoplay: Boolean(block.autoplay),
          muted: block.muted !== false,
          loop: Boolean(block.loop),
        } as LandingContentBlock;
      }

      if (block?.type === "video_row") {
        return {
          id: block.id || uid(),
          type: "video_row" as const,
          enabled: block.enabled !== false,
          videos: Array.isArray(block.videos)
            ? block.videos.filter((item: any) => item?.type === "video").slice(0, 3)
            : [],
          desktopColumns: [1, 2, 3].includes(Number(block.desktopColumns))
            ? Number(block.desktopColumns)
            : 3,
          mobileColumns: [1, 2, 3].includes(Number(block.mobileColumns))
            ? Number(block.mobileColumns)
            : 1,
          gap: Number.isFinite(Number(block.gap)) ? Number(block.gap) : 12,
          width: ["normal", "wide", "full"].includes(block.width)
            ? block.width
            : "wide",
          aspect: ["portrait", "square", "auto"].includes(block.aspect)
            ? block.aspect
            : "portrait",
          rounded: block.rounded !== false,
          controls: block.controls !== false,
          autoplay: Boolean(block.autoplay),
          muted: block.muted !== false,
          loop: Boolean(block.loop),
        } as LandingContentBlock;
      }

      if (block?.type === "buy_button") {
        return {
          id: block.id || uid(),
          type: "buy_button" as const,
          enabled: block.enabled !== false,
          text: block.text || base.buttonText,
          subtext: block.subtext || base.buttonSubtext,
          width: ["normal", "wide", "full"].includes(block.width)
            ? block.width
            : "wide",
          align: ["left", "center", "right"].includes(block.align)
            ? block.align
            : "center",
          backgroundColor: block.backgroundColor || base.buttonColor,
          textColor: block.textColor || "#ffffff",
          borderColor: block.borderColor || "#000000",
          borderWidth: Number.isFinite(Number(block.borderWidth)) ? Number(block.borderWidth) : 4,
          borderRadius: Number.isFinite(Number(block.borderRadius)) ? Number(block.borderRadius) : 999,
          fontSize: Number.isFinite(Number(block.fontSize)) ? Number(block.fontSize) : 18,
          paddingY: Number.isFinite(Number(block.paddingY)) ? Number(block.paddingY) : 12,
          effect: ["none","shake","pulse","bounce","shine"].includes(block.effect) ? block.effect : "none",
          effectEverySeconds: Number.isFinite(Number(block.effectEverySeconds)) ? Math.max(2, Number(block.effectEverySeconds)) : 5,
        } as LandingContentBlock;
      }

      if (block?.type === "quantity_offers") {
        return {
          id: block.id || uid(),
          type: "quantity_offers" as const,
          enabled: block.enabled !== false,
          title: block.title || "🔥 OFERTAS ESPECIALES",
          width: ["normal","wide","full"].includes(block.width) ? block.width : "wide",
          align: ["left","center","right"].includes(block.align) ? block.align : "center",
        } as LandingContentBlock;
      }

      if (block?.type === "custom_html") {
        return {
          id: block.id || uid(),
          type: "custom_html" as const,
          enabled: block.enabled !== false,
          html: typeof block.html === "string" ? block.html : "",
          width: ["normal", "wide", "full"].includes(block.width)
            ? block.width
            : "wide",
        } as LandingContentBlock;
      }

      if (block?.type === "image") {
        return {
          ...block,
          text: block.text || "",
          textPosition: ["top", "bottom", "left", "right", "overlay-top", "overlay-center", "overlay-bottom"].includes(block.textPosition)
            ? block.textPosition
            : "bottom",
          textAlign: ["left", "center", "right"].includes(block.textAlign)
            ? block.textAlign
            : "left",
          blockAlign: ["left", "center", "right"].includes(block.blockAlign)
            ? block.blockAlign
            : "center",
          marginTop: Number.isFinite(Number(block.marginTop)) ? Number(block.marginTop) : 12,
          marginBottom: Number.isFinite(Number(block.marginBottom)) ? Number(block.marginBottom) : 12,
          imageScale: Number.isFinite(Number(block.imageScale)) ? Math.min(200, Math.max(50, Number(block.imageScale))) : 100,
          imageOffsetX: Number.isFinite(Number(block.imageOffsetX)) ? Math.min(200, Math.max(-200, Number(block.imageOffsetX))) : 0,
          imageOffsetY: Number.isFinite(Number(block.imageOffsetY)) ? Math.min(200, Math.max(-200, Number(block.imageOffsetY))) : 0,
        } as LandingContentBlock;
      }

      if (block?.type === "image_text") {
        return {
          ...block,
          imagePosition: ["top", "bottom", "left", "right", "overlay"].includes(block.imagePosition)
            ? block.imagePosition
            : "left",
          textAlign: ["left", "center", "right"].includes(block.textAlign)
            ? block.textAlign
            : "left",
          width: ["normal", "wide", "full"].includes(block.width) ? block.width : "wide",
          blockAlign: ["left", "center", "right"].includes(block.blockAlign) ? block.blockAlign : "center",
          marginTop: Number.isFinite(Number(block.marginTop)) ? Number(block.marginTop) : 12,
          marginBottom: Number.isFinite(Number(block.marginBottom)) ? Number(block.marginBottom) : 12,
          imageScale: Number.isFinite(Number(block.imageScale)) ? Math.min(200, Math.max(50, Number(block.imageScale))) : 100,
          imageOffsetX: Number.isFinite(Number(block.imageOffsetX)) ? Math.min(200, Math.max(-200, Number(block.imageOffsetX))) : 0,
          imageOffsetY: Number.isFinite(Number(block.imageOffsetY)) ? Math.min(200, Math.max(-200, Number(block.imageOffsetY))) : 0,
        } as LandingContentBlock;
      }

      return block as LandingContentBlock;
    }),
    productSnapshots: (raw?.productSnapshots || []).map((p: any) => {
      const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
      const media =
        Array.isArray(p.media) && p.media.length > 0
          ? p.media
          : images.map((url: string) => ({
              id: uid(),
              type: "image" as const,
              url,
              alt: p.title || "",
            }));
      return {
        ...p,
        images,
        media,
      };
    }),
  };
  return config;
}

export default function WebPageBuilder({
  products,
  userEmail,
}: {
  products: BuilderProduct[];
  userEmail: string;
}) {
  const [pages, setPages] = useState<LandingRow[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [config, setConfig] = useState<LandingConfig>(defaultConfig());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null);
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [aiTone, setAiTone] = useState("Vendedor y urgente");
  const [aiAudience, setAiAudience] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMedia, setAiMedia] = useState<LandingMediaItem[]>([]);
  // Imágenes de venta: banners diseñados por Claude, fotos realistas (OpenAI) o ninguna.
  const [aiProvider, setAiProvider] = useState<"claude" | "openai">(() => {
    try {
      return localStorage.getItem("dcanp-ai-provider") === "openai" ? "openai" : "claude";
    } catch {
      return "claude";
    }
  });
  const chooseAiProvider = (value: "claude" | "openai") => {
    setAiProvider(value);
    try {
      localStorage.setItem("dcanp-ai-provider", value);
    } catch {
      // Preferencia sólo de este navegador.
    }
  };
  const [aiImageMode, setAiImageMode] = useState<"pro" | "claude" | "openai" | "none">("claude");
  const aiMakeImages = aiImageMode === "openai" || aiImageMode === "pro";
  const aiDesignBanners = aiImageMode === "claude" || aiImageMode === "pro";

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();

    if (!query) return products;

    return products.filter((product) =>
      [product.title, product.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [products, productSearch]);

  const selectedProducts = useMemo(
    () => products.filter((p) => config.selectedProductIds.includes(p.id)),
    [products, config.selectedProductIds],
  );

  const primaryProduct = selectedProducts[0];

  const loadPages = useCallback(async () => {
    if (!userEmail) return;
    setLoadingPages(true);
    const { data, error } = await supabase
      .from("landing_pages")
      .select("*")
      .eq("owner_email", userEmail)
      .order("updated_at", { ascending: false });

    setLoadingPages(false);
    if (error) {
      console.error(error);
      toast.error(
        "No se pudieron cargar las páginas. Ejecutá primero el SQL actualizado.",
      );
      return;
    }

    setPages(
      ((data || []) as LandingRow[]).map((row) => ({
        ...row,
        config: normalizeConfig(row.config),
      })),
    );
  }, [userEmail]);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const resetEditor = () => {
    setEditingId(null);
    setName("");
    setSlug("");
    setConfig(defaultConfig());
    setPreviewMode("desktop");
    setInsertAtIndex(null);
    setDraggedBlockIndex(null);
    setProductSearch("");
    setAiMedia([]);
    setEditorOpen(true);
  };

  const editPage = (page: LandingRow) => {
    setEditingId(page.id);
    setName(page.name);
    setSlug(page.slug);
    setConfig(normalizeConfig(page.config));
    setInsertAtIndex(null);
    setDraggedBlockIndex(null);
    setProductSearch("");
    setAiMedia([]);
    setEditorOpen(true);
  };

  const toggleProduct = (id: string) => {
    setConfig((prev) => {
      const exists = prev.selectedProductIds.includes(id);
      const ids = exists
        ? prev.selectedProductIds.filter((x) => x !== id)
        : [...prev.selectedProductIds, id];

      const previousMap = new Map(prev.productSnapshots.map((p) => [p.id, p]));
      const snapshots = products
        .filter((p) => ids.includes(p.id))
        .map((p) => previousMap.get(p.id) || snapshotFromProduct(p));

      const first = products.find((p) => p.id === ids[0]);

      return {
        ...prev,
        selectedProductIds: ids,
        productSnapshots: snapshots,
        heroHeadline:
          prev.selectedProductIds.length === 0 && first
            ? `⚡ ${first.title}: la solución práctica que estabas buscando.`
            : prev.heroHeadline,
      };
    });
  };

  // ✨ Textos de la página generados con IA (Claude) a partir del producto.
  const aiPhotos = aiMedia.filter((m) => m.type === "image").slice(0, 6);
  const aiVideos = aiMedia.filter((m) => m.type === "video").slice(0, 3);

  const uploadAiMedia = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: LandingMediaItem[] = [];
      for (const file of Array.from(files).slice(0, 9)) {
        const item = await uploadFile(file, "ai-media");
        if (item) added.push(item);
      }
      if (added.length) setAiMedia((prev) => [...prev, ...added]);
    } finally {
      setUploading(false);
    }
  };

  const generateWithAI = async () => {
    const main = config.productSnapshots[0];
    if (!main) {
      toast.error("Primero elegí un producto.");
      return;
    }
    setAiLoading(true);
    const loading = toast.loading("✨ La IA está escribiendo tu página… (puede tardar hasta 1 minuto)");
    try {
      const { data, error } = await supabase.functions.invoke("ai-landing-copy", {
        body: {
          product: {
            title: main.title,
            price: main.price,
            compareAtPrice: main.compareAtPrice,
            description: main.description,
            warranty: main.warranty,
            images: main.images,
          },
          extraProducts: config.productSnapshots.slice(1).map((p) => p.title),
          photos: aiPhotos.map((m) => m.url),
          videoCount: aiVideos.length,
          generateImages: aiMakeImages ? 4 : 0,
          designBanners: aiDesignBanners ? 4 : 0,
          provider: aiProvider,
          brandColor: config.primaryColor,
          tone: aiTone,
          audience: aiAudience,
          notes: aiNotes,
        },
      });
      let message = (data as any)?.error as string | undefined;
      if (error && !message) {
        try {
          message = (await (error as any).context?.json?.())?.error;
        } catch {
          // sin detalle
        }
        message = message || "No se pudo conectar con la IA.";
      }
      const copy = (data as any)?.copy;
      if (message || !copy) {
        toast.error(message || "La IA no devolvió textos.");
        return;
      }

      // 🎨 Imágenes nuevas creadas por la IA (en paralelo), con la foto real del producto de referencia.
      const ideas: { prompt: string; caption: string }[] = aiMakeImages ? (copy.generated_images || []).slice(0, 4) : [];
      // Datos que la IA detectó que faltan (no los usó).
      const missing: string[] = Array.isArray(copy.analysis?.missing_data) ? copy.analysis.missing_data : [];
      if (missing.length) {
        toast.info(`🔎 La IA no usó estos datos porque faltan: ${missing.slice(0, 4).join(" · ")}. Si los tenés, agregalos en Indicaciones.`, {
          duration: 12000,
        });
      }
      // HERO: imagen principal aparte (pasa a ser la primera foto del producto).
      const heroIdea = aiMakeImages && copy.hero?.prompt ? copy.hero : null;
      let heroUrl = "";
      const created: { url: string; caption: string }[] = [];
      const createdByIndex: (string | null)[] = [];
      if (ideas.length) {
        toast.loading(`🎨 Creando ${ideas.length + (heroIdea ? 1 : 0)} imágenes… (1 a 2 minutos)`, { id: loading });
        const heroPromise = heroIdea
          ? supabase.functions.invoke("ai-landing-image", {
              body: {
                prompt: heroIdea.prompt,
                hook: heroIdea.hook || "",
                productTitle: main.title,
                referenceUrl: main.images[0] || "",
                quality: "high",
              },
            })
          : Promise.resolve(null);
        const results = await Promise.allSettled(
          ideas.map((idea) =>
            supabase.functions.invoke("ai-landing-image", {
              body: {
                prompt: idea.prompt,
                productTitle: main.title,
                referenceUrl: main.images[0] || "",
                quality: aiImageMode === "pro" ? "high" : "medium",
              },
            }),
          ),
        );
        try {
          const heroRes: any = await heroPromise;
          heroUrl = heroRes?.data?.url || "";
        } catch {
          heroUrl = "";
        }
        let imageError = "";
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && (r.value.data as any)?.url) {
            created.push({ url: (r.value.data as any).url, caption: ideas[i].caption });
            createdByIndex[i] = (r.value.data as any).url;
          } else if (!imageError) {
            imageError =
              (r.status === "fulfilled" ? (r.value.data as any)?.error : "") ||
              "Alguna imagen no se pudo crear.";
          }
        });
        if (imageError) {
          // El mensaje real viene en el cuerpo de la respuesta de error.
          const failed = results.find((r) => r.status === "fulfilled" && r.value.error) as
            | PromiseFulfilledResult<any>
            | undefined;
          try {
            const detail = await failed?.value.error?.context?.json?.();
            if (detail?.error) imageError = detail.error;
          } catch {
            // sin detalle
          }
          toast.warning(`🎨 ${imageError} Se armó la página con ${created.length} imagen(es) nueva(s).`, { duration: 9000 });
        }
      }

      // 🎨 Banners diseñados por Claude (HTML). Sólo se permiten las fotos del producto.
      const allowedSrc = new Set([...main.images, ...created.map((c) => c.url)]);
      const bannerBlocks: LandingContentBlock[] = [];
      if (aiDesignBanners) {
        (copy.banners || []).slice(0, 4).forEach((b: { html: string; caption: string }, bi: number) => {
          // {{FOTO_IA_N}} → foto profesional generada (si falló, la foto real del producto).
          const withPhotos = String(b.html || "").replace(/\{\{\s*FOTO_IA_(\d)\s*\}\}/g, (_m, n) => {
            const idx = Number(n) - 1;
            return createdByIndex[idx] || createdByIndex[bi] || main.images[0] || "";
          });
          const doc = new DOMParser().parseFromString(withPhotos, "text/html");
          doc.querySelectorAll("img").forEach((img) => {
            if (!allowedSrc.has(img.getAttribute("src") || "")) img.remove();
          });
          const html = sanitizeCustomHtml(doc.body.innerHTML);
          if (!html.trim()) return;
          bannerBlocks.push({ id: `ai-${uid()}`, type: "custom_html", enabled: true, html, width: "normal" });
          if (b.caption?.trim()) {
            bannerBlocks.push({ id: `ai-${uid()}`, type: "text", enabled: true, text: b.caption, align: "center" });
          }
        });
      }

      // Fotos con su texto (como las páginas que mejor venden) + fila de videos.
      const photosUsed = new Set<number>();
      // En modo PRO las fotos generadas van dentro de los banners de Claude.
      const imageBlocks: LandingContentBlock[] = (aiImageMode === "pro" ? [] : created).map((img) => ({
        id: `ai-${uid()}`,
        type: "image" as const,
        enabled: true,
        url: img.url,
        alt: main.title,
        width: "full" as const,
        rounded: true,
        text: img.caption || "",
        textPosition: "bottom" as const,
        textAlign: "left" as const,
        blockAlign: "center" as const,
        marginTop: 12,
        marginBottom: 12,
        imageScale: 100,
        imageOffsetX: 0,
        imageOffsetY: 0,
      }));
      (copy.image_blocks || []).forEach((ib: { photo: number; caption: string }) => {
        const photo = aiPhotos[Number(ib.photo) - 1];
        if (!photo || photosUsed.has(Number(ib.photo))) return;
        photosUsed.add(Number(ib.photo));
        imageBlocks.push({
          id: `ai-${uid()}`,
          type: "image",
          enabled: true,
          url: photo.url,
          alt: main.title,
          width: "full",
          rounded: true,
          text: ib.caption || "",
          textPosition: "bottom",
          textAlign: "left",
          blockAlign: "center",
          marginTop: 12,
          marginBottom: 12,
          imageScale: 100,
          imageOffsetX: 0,
          imageOffsetY: 0,
        });
      });
      // Fotos que la IA no usó: igual se muestran al final de las fotos.
      aiPhotos.forEach((photo, i) => {
        if (photosUsed.has(i + 1)) return;
        imageBlocks.push({
          id: `ai-${uid()}`,
          type: "image",
          enabled: true,
          url: photo.url,
          alt: main.title,
          width: "full",
          rounded: true,
          text: "",
          textPosition: "bottom",
          textAlign: "left",
          blockAlign: "center",
          marginTop: 12,
          marginBottom: 12,
          imageScale: 100,
          imageOffsetX: 0,
          imageOffsetY: 0,
        });
      });
      const mediaBlocks: LandingContentBlock[] = [...bannerBlocks, ...imageBlocks];
      if (aiVideos.length) {
        const visuals = bannerBlocks.filter((b) => b.type === "custom_html").length + imageBlocks.length;
        let at = Math.max(0, Math.min(visuals, Number(copy.video_position ?? visuals)));
        // Convierte "después de N imágenes" en posición dentro de la lista (los textos de banner van pegados).
        let seen = 0;
        let idx = 0;
        while (idx < mediaBlocks.length && seen < at) {
          if (mediaBlocks[idx].type !== "text") seen++;
          idx++;
          while (idx < mediaBlocks.length && mediaBlocks[idx].type === "text") idx++;
        }
        at = idx;
        mediaBlocks.splice(at, 0, {
          id: `ai-${uid()}`,
          type: "video_row",
          enabled: true,
          videos: aiVideos,
          desktopColumns: Math.min(3, aiVideos.length) as 1 | 2 | 3,
          mobileColumns: Math.min(3, aiVideos.length) as 1 | 2 | 3,
          gap: 12,
          width: "wide",
          aspect: "portrait",
          rounded: true,
          controls: true,
          autoplay: true,
          muted: true,
          loop: true,
        });
      }

      const sectionBlocks: LandingContentBlock[] = (copy.sections || []).flatMap(
        (sec: { emoji: string; heading: string; text: string }) => [
          {
            id: `ai-${uid()}`,
            type: "heading" as const,
            enabled: true,
            text: sec.heading,
            emoji: sec.emoji,
            align: "center" as const,
            size: "lg" as const,
          },
          {
            id: `ai-${uid()}`,
            type: "text" as const,
            enabled: true,
            text: sec.text,
            align: "center" as const,
          },
        ],
      );

      setConfig((prev) => ({
        ...prev,
        announcement: copy.announcement || prev.announcement,
        heroHeadline: copy.hero_headline || prev.heroHeadline,
        heroDescription: copy.hero_description || prev.heroDescription,
        buttonText: copy.button_text || prev.buttonText,
        buttonSubtext: copy.button_subtext || prev.buttonSubtext,
        checkoutTitle: copy.checkout_title || prev.checkoutTitle,
        benefits: Array.isArray(copy.benefits) && copy.benefits.length ? copy.benefits : prev.benefits,
        faq: Array.isArray(copy.faq) && copy.faq.length ? copy.faq : prev.faq,
        productSnapshots: prev.productSnapshots.map((p, i) => {
          if (i !== 0) return p;
          const next = copy.product_description ? { ...p, description: copy.product_description } : { ...p };
          if (heroUrl) {
            // La HERO va primera, fuera del cuerpo de la página.
            next.images = [heroUrl, ...p.images.filter((u) => u !== heroUrl)];
            next.media = [{ id: `ai-hero-${uid()}`, type: "image" as const, url: heroUrl, alt: p.title }, ...p.media];
          }
          return next;
        }),
        // Reemplaza sólo los bloques que puso la IA antes; los tuyos quedan.
        contentBlocks: [
          ...mediaBlocks,
          ...sectionBlocks,
          ...prev.contentBlocks.filter((b) => !String(b.id).startsWith("ai-")),
        ],
      }));
      if (!name.trim() && copy.page_name) {
        setName(copy.page_name);
        if (!editingId && !slug) setSlug(slugify(copy.page_name));
      }
      toast.success("✨ ¡Listo! Revisá los textos en la vista previa y cambiá lo que quieras antes de publicar.");
    } finally {
      toast.dismiss(loading);
      setAiLoading(false);
    }
  };

  const updateSnapshot = (
    productId: string,
    patch: Partial<LandingProductSnapshot>,
  ) => {
    setConfig((prev) => ({
      ...prev,
      productSnapshots: prev.productSnapshots.map((p) =>
        p.id === productId ? { ...p, ...patch } : p,
      ),
    }));
  };

  const sanitizeFileName = (name: string) =>
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-");

  const getFileMimeType = (file: File) => {
    if (file.type) return file.type;

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const mimeByExtension: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      m4v: "video/mp4",
    };

    return mimeByExtension[ext] || "application/octet-stream";
  };

  const uploadFile = async (
    file: File,
    folder: string,
  ): Promise<LandingMediaItem | null> => {
    try {
      const mimeType = getFileMimeType(file);
      const isImage = mimeType.startsWith("image/");
      const isVideo = mimeType.startsWith("video/");

      if (!isImage && !isVideo) {
        toast.error(`"${file.name}" no es una imagen o video compatible.`);
        return null;
      }

      const maxImageBytes = 15 * 1024 * 1024;
      const maxVideoBytes = 80 * 1024 * 1024;
      const max = isVideo ? maxVideoBytes : maxImageBytes;

      if (file.size > max) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        toast.error(
          isVideo
            ? `El video pesa ${sizeMb} MB. El máximo configurado es 80 MB.`
            : `La imagen pesa ${sizeMb} MB. El máximo configurado es 15 MB.`,
          { duration: 8000 },
        );
        return null;
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error("Error obteniendo sesión:", sessionError);
        toast.error(`No se pudo validar tu sesión: ${sessionError.message}`, {
          duration: 8000,
        });
        return null;
      }

      if (!session?.user) {
        toast.error(
          "Tu sesión no está activa. Cerrá sesión, volvé a ingresar e intentá nuevamente.",
          { duration: 8000 },
        );
        return null;
      }

      const owner = session.user.email || userEmail || session.user.id;
      const safeOwner = owner
        .toLowerCase()
        .replace(/[^a-z0-9@._-]/g, "-");

      const safeName =
        sanitizeFileName(file.name) ||
        `${isVideo ? "video" : "imagen"}-${Date.now()}`;

      const path = `${safeOwner}/${folder}/${Date.now()}-${uid()}-${safeName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: mimeType,
        });

      if (uploadError) {
        console.error("❌ ERROR STORAGE COMPLETO:", uploadError);

        const message = String(uploadError.message || "Error desconocido");
        const normalized = message.toLowerCase();

        if (normalized.includes("bucket") && normalized.includes("not found")) {
          toast.error(
            `No existe el bucket "${MEDIA_BUCKET}". Ejecutá el SQL de landing-media.`,
            { duration: 10000 },
          );
        } else if (
          normalized.includes("row-level security") ||
          normalized.includes("policy") ||
          normalized.includes("unauthorized") ||
          normalized.includes("permission")
        ) {
          toast.error(`Supabase bloqueó la subida por permisos (RLS): ${message}`, {
            duration: 10000,
          });
        } else if (
          normalized.includes("maximum") ||
          normalized.includes("too large") ||
          normalized.includes("payload") ||
          normalized.includes("size")
        ) {
          toast.error(`El archivo supera el límite de Supabase Storage: ${message}`, {
            duration: 10000,
          });
        } else {
          toast.error(`No se pudo subir "${file.name}": ${message}`, {
            duration: 10000,
          });
        }

        return null;
      }

      const storedPath = uploadData?.path || path;
      const { data: publicData } = supabase.storage
        .from(MEDIA_BUCKET)
        .getPublicUrl(storedPath);

      if (!publicData?.publicUrl) {
        toast.error("El archivo se subió, pero no se pudo generar su URL pública.");
        return null;
      }

      return {
        id: uid(),
        type: isVideo ? "video" : "image",
        url: publicData.publicUrl,
        alt: file.name,
      };
    } catch (error: any) {
      console.error("❌ Error inesperado subiendo archivo:", error);
      toast.error(
        `Error inesperado al subir "${file.name}": ${
          error?.message || "Error desconocido"
        }`,
        { duration: 10000 },
      );
      return null;
    }
  };

  const uploadProductMedia = async (
    productId: string,
    files: FileList | null,
  ) => {
    if (!files?.length) return;
    setUploading(true);
    const uploaded: LandingMediaItem[] = [];

    for (const file of Array.from(files)) {
      const item = await uploadFile(file, `products/${productId}`);
      if (item) uploaded.push(item);
    }

    setUploading(false);
    if (!uploaded.length) return;

    setConfig((prev) => ({
      ...prev,
      productSnapshots: prev.productSnapshots.map((p) => {
        if (p.id !== productId) return p;
        const media = [...(p.media || []), ...uploaded];
        return {
          ...p,
          media,
          images: media.filter((m) => m.type === "image").map((m) => m.url),
        };
      }),
    }));

    toast.success(`${uploaded.length} archivo(s) agregado(s) a la galería.`);
  };

  const removeProductMedia = (productId: string, mediaId: string) => {
    setConfig((prev) => ({
      ...prev,
      productSnapshots: prev.productSnapshots.map((p) => {
        if (p.id !== productId) return p;
        const media = (p.media || []).filter((m) => m.id !== mediaId);
        return {
          ...p,
          media,
          images: media.filter((m) => m.type === "image").map((m) => m.url),
        };
      }),
    }));
  };

  const moveProductMedia = (
    productId: string,
    mediaIndex: number,
    direction: -1 | 1,
  ) => {
    setConfig((prev) => ({
      ...prev,
      productSnapshots: prev.productSnapshots.map((p) => {
        if (p.id !== productId) return p;
        const media = [...(p.media || [])];
        const target = mediaIndex + direction;
        if (target < 0 || target >= media.length) return p;
        [media[mediaIndex], media[target]] = [media[target], media[mediaIndex]];
        return {
          ...p,
          media,
          images: media.filter((m) => m.type === "image").map((m) => m.url),
        };
      }),
    }));
  };

  const createBlock = (
    type: LandingContentBlock["type"],
  ): LandingContentBlock => {
    if (type === "heading") {
      return {
        id: uid(),
        type,
        enabled: true,
        text: "🚨 Los lugares más difíciles son los que más atención necesitan.",
        align: "left",
        size: "lg",
      };
    }

    if (type === "text") {
      return {
        id: uid(),
        type,
        enabled: true,
        text: "Escribí aquí el contenido que querés mostrar en la página.",
        align: "left",
      };
    }

    if (type === "image") {
      return {
        id: uid(),
        type,
        enabled: true,
        url: "",
        alt: "",
        width: "normal",
        rounded: true,
        text: "",
        textPosition: "bottom",
        textAlign: "left",
        blockAlign: "center",
        marginTop: 12,
        marginBottom: 12,
        imageScale: 100,
        imageOffsetX: 0,
        imageOffsetY: 0,
      };
    }

    if (type === "video") {
      return {
        id: uid(),
        type,
        enabled: true,
        url: "",
        poster: "",
        autoplay: false,
        muted: true,
        loop: false,
        controls: true,
        width: "normal",
        rounded: true,
      };
    }

    if (type === "media_gallery") {
      return {
        id: uid(),
        type,
        enabled: true,
        items: [],
        columns: 3,
        mobileColumns: 1,
        gap: 14,
        width: "wide",
        aspect: "portrait",
        rounded: false,
        controls: true,
        autoplay: false,
        muted: true,
        loop: false,
      };
    }

    if (type === "video_row") {
      return {
        id: uid(),
        type,
        enabled: true,
        videos: [],
        desktopColumns: 3,
        mobileColumns: 1,
        gap: 12,
        width: "wide",
        aspect: "portrait",
        rounded: false,
        controls: true,
        autoplay: false,
        muted: true,
        loop: false,
      };
    }

    if (type === "buy_button") {
      return {
        id: uid(),
        type,
        enabled: true,
        text: config.buttonText,
        subtext: config.buttonSubtext,
        width: "wide",
        align: "center",
        backgroundColor: config.buttonColor,
        textColor: "#ffffff",
        borderColor: "#000000",
        borderWidth: 4,
        borderRadius: 999,
        fontSize: 18,
        paddingY: 12,
        effect: "none",
        effectEverySeconds: 5,
      };
    }

    if (type === "quantity_offers") {
      return {
        id: uid(),
        type,
        enabled: true,
        title: "🔥 OFERTAS ESPECIALES",
        width: "wide",
        align: "center",
      };
    }

    if (type === "image_text") {
      return {
        id: uid(),
        type,
        enabled: true,
        imageUrl: "",
        title: "Nuevo bloque",
        text: "Agregá una imagen y escribí una descripción.",
        imagePosition: "left",
        textAlign: "left",
        width: "wide",
        blockAlign: "center",
        marginTop: 12,
        marginBottom: 12,
        imageScale: 100,
        imageOffsetX: 0,
        imageOffsetY: 0,
      };
    }

    if (type === "custom_html") {
      return {
        id: uid(),
        type,
        enabled: true,
        html: `<section style="max-width:1080px;margin:0 auto;padding:24px;border-radius:18px;background:#ffffff;color:#111111;">
  <h2 style="margin:0 0 12px;font-size:32px;line-height:1.1;">Tu nueva sección HTML</h2>
  <p style="margin:0;font-size:17px;line-height:1.6;">Pegá acá tu HTML y vas a ver la vista previa automáticamente.</p>
</section>`,
        width: "full",
      };
    }

    return {
      id: uid(),
      type: "spacer",
      enabled: true,
      height: 30,
    };
  };

  /**
   * Inserta un bloque exactamente donde el usuario quiera.
   * index = 0 -> primero
   * index = contentBlocks.length -> último
   */
  const addBlock = (
    type: LandingContentBlock["type"],
    requestedIndex?: number,
  ) => {
    const block = createBlock(type);

    setConfig((prev) => {
      const next = [...prev.contentBlocks];
      const fallbackIndex =
        insertAtIndex === null ? next.length : insertAtIndex;
      const rawIndex =
        requestedIndex === undefined ? fallbackIndex : requestedIndex;
      const targetIndex = Math.max(0, Math.min(rawIndex, next.length));

      next.splice(targetIndex, 0, block);

      return {
        ...prev,
        contentBlocks: next,
      };
    });

    setInsertAtIndex(null);
  };

  const patchBlock = (
    id: string,
    patch: Record<string, unknown>,
  ) => {
    setConfig((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.map((b) =>
        b.id === id ? ({ ...b, ...patch } as LandingContentBlock) : b,
      ),
    }));
  };

  const deleteBlock = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.filter((b) => b.id !== id),
    }));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    setConfig((prev) => {
      const next = [...prev.contentBlocks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;

      [next[index], next[target]] = [next[target], next[index]];

      return {
        ...prev,
        contentBlocks: next,
      };
    });
  };

  /**
   * Mueve directamente un bloque a una posición exacta.
   * targetPosition es base 1 para que sea natural en el selector.
   */
  const moveBlockToPosition = (
    currentIndex: number,
    targetPosition: number,
  ) => {
    setConfig((prev) => {
      const next = [...prev.contentBlocks];
      if (!next.length) return prev;

      const targetIndex = Math.max(
        0,
        Math.min(targetPosition - 1, next.length - 1),
      );

      if (targetIndex === currentIndex) return prev;

      const [block] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, block);

      return {
        ...prev,
        contentBlocks: next,
      };
    });
  };

  /**
   * Drag & drop manual usando HTML5.
   */
  const handleBlockDragStart = (index: number) => {
    setDraggedBlockIndex(index);
  };

  const handleBlockDrop = (targetIndex: number) => {
    if (draggedBlockIndex === null) return;

    setConfig((prev) => {
      const next = [...prev.contentBlocks];

      if (
        draggedBlockIndex < 0 ||
        draggedBlockIndex >= next.length ||
        targetIndex < 0 ||
        targetIndex >= next.length ||
        draggedBlockIndex === targetIndex
      ) {
        return prev;
      }

      const [block] = next.splice(draggedBlockIndex, 1);
      next.splice(targetIndex, 0, block);

      return {
        ...prev,
        contentBlocks: next,
      };
    });

    setDraggedBlockIndex(null);
  };

  const cancelBlockDrag = () => {
    setDraggedBlockIndex(null);
  };

  const uploadBlockMedia = async (
    block: LandingContentBlock,
    files: FileList | null,
  ) => {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const item = await uploadFile(file, `blocks/${block.id}`);
      if (!item) return;

      if (block.type === "image") {
        if (item.type !== "image") {
          toast.error("Este bloque requiere una imagen.");
          return;
        }
        patchBlock(block.id, { url: item.url, alt: item.alt || "" });
      } else if (block.type === "video") {
        if (item.type !== "video") {
          toast.error("Este bloque requiere un video.");
          return;
        }
        patchBlock(block.id, { url: item.url });
      } else if (block.type === "image_text") {
        if (item.type !== "image") {
          toast.error("Este bloque requiere una imagen.");
          return;
        }
        patchBlock(block.id, { imageUrl: item.url });
      }
    } finally {
      setUploading(false);
    }
  };

  const uploadGalleryMedia = async (
    blockId: string,
    files: FileList | null,
  ) => {
    if (!files?.length) return;

    setUploading(true);
    const uploaded: LandingMediaItem[] = [];

    try {
      for (const file of Array.from(files)) {
        const item = await uploadFile(file, `blocks/${blockId}/gallery`);
        if (item) uploaded.push(item);
      }

      if (!uploaded.length) return;

      setConfig((prev) => ({
        ...prev,
        contentBlocks: prev.contentBlocks.map((block) => {
          if (block.id !== blockId || block.type !== "media_gallery") {
            return block;
          }

          return {
            ...block,
            items: [...block.items, ...uploaded],
          };
        }),
      }));

      toast.success(
        `✅ ${uploaded.length} archivo(s) agregado(s) a la galería.`,
      );
    } finally {
      setUploading(false);
    }
  };

  const moveGalleryMedia = (
    blockId: string,
    mediaIndex: number,
    direction: -1 | 1,
  ) => {
    setConfig((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.map((block) => {
        if (block.id !== blockId || block.type !== "media_gallery") {
          return block;
        }

        const items = [...block.items];
        const target = mediaIndex + direction;

        if (target < 0 || target >= items.length) return block;

        [items[mediaIndex], items[target]] = [
          items[target],
          items[mediaIndex],
        ];

        return { ...block, items };
      }),
    }));
  };

  const removeGalleryMedia = (
    blockId: string,
    mediaId: string,
  ) => {
    setConfig((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.map((block) => {
        if (block.id !== blockId || block.type !== "media_gallery") {
          return block;
        }

        return {
          ...block,
          items: block.items.filter((item) => item.id !== mediaId),
        };
      }),
    }));
  };

  const uploadVideoRow = async (
    blockId: string,
    files: FileList | null,
  ) => {
    if (!files?.length) return;

    const selected = Array.from(files).slice(0, 3);

    setUploading(true);
    const uploaded: LandingMediaItem[] = [];

    try {
      for (const file of selected) {
        const item = await uploadFile(file, `blocks/${blockId}/video-row`);

        if (!item) continue;

        if (item.type !== "video") {
          toast.error(`"${file.name}" no es un video.`);
          continue;
        }

        uploaded.push(item);
      }

      if (!uploaded.length) return;

      setConfig((prev) => ({
        ...prev,
        contentBlocks: prev.contentBlocks.map((block) => {
          if (block.id !== blockId || block.type !== "video_row") {
            return block;
          }

          const nextVideos = [...block.videos, ...uploaded].slice(0, 3);

          return {
            ...block,
            videos: nextVideos,
            desktopColumns: Math.min(
              Math.max(nextVideos.length, 1),
              3,
            ) as 1 | 2 | 3,
          };
        }),
      }));

      toast.success(
        `🎬 ${uploaded.length} video(s) agregado(s). Máximo 3 por fila.`,
      );
    } finally {
      setUploading(false);
    }
  };

  const moveVideoRowItem = (
    blockId: string,
    index: number,
    direction: -1 | 1,
  ) => {
    setConfig((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.map((block) => {
        if (block.id !== blockId || block.type !== "video_row") {
          return block;
        }

        const videos = [...block.videos];
        const target = index + direction;

        if (target < 0 || target >= videos.length) return block;

        [videos[index], videos[target]] = [
          videos[target],
          videos[index],
        ];

        return {
          ...block,
          videos,
        };
      }),
    }));
  };

  const removeVideoRowItem = (
    blockId: string,
    mediaId: string,
  ) => {
    setConfig((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.map((block) => {
        if (block.id !== blockId || block.type !== "video_row") {
          return block;
        }

        const videos = block.videos.filter(
          (item) => item.id !== mediaId,
        );

        return {
          ...block,
          videos,
          desktopColumns: Math.min(
            Math.max(videos.length || 1, 1),
            3,
          ) as 1 | 2 | 3,
        };
      }),
    }));
  };

  const addBenefit = () =>
    setConfig((prev) => ({
      ...prev,
      benefits: [...prev.benefits, "Nuevo beneficio"],
    }));

  const addFaq = () =>
    setConfig((prev) => ({
      ...prev,
      faq: [
        ...prev.faq,
        { question: "Nueva pregunta", answer: "Escribí aquí la respuesta." },
      ],
    }));

  const validate = () => {
    if (!name.trim()) {
      toast.error("Ingresá un nombre para la página");
      return false;
    }
    if (!slugify(slug || name)) {
      toast.error("Ingresá una URL válida");
      return false;
    }
    if (config.selectedProductIds.length === 0) {
      toast.error("Seleccioná por lo menos un producto");
      return false;
    }
    return true;
  };

  const save = async (
    publish: boolean,
    options?: {
      silent?: boolean;
      preserveStatus?: boolean;
    },
  ) => {
    if (!validate()) return null;
    if (!userEmail) {
      toast.error("No se pudo identificar al usuario");
      return null;
    }

    setSaving(true);
    const finalSlug = slugify(slug || name);
    const freshSnapshots = config.selectedProductIds
      .map((id) => {
        const edited = config.productSnapshots.find((x) => x.id === id);
        const original = products.find((x) => x.id === id);
        return edited || (original ? snapshotFromProduct(original) : null);
      })
      .filter(Boolean);

    const existingPage = editingId
      ? pages.find((page) => page.id === editingId)
      : null;

    const preservedStatus: PageStatus =
      options?.preserveStatus && existingPage
        ? existingPage.status
        : publish
          ? "published"
          : "draft";

    const preservedPublishedAt =
      options?.preserveStatus && existingPage
        ? existingPage.published_at
        : publish
          ? existingPage?.published_at || new Date().toISOString()
          : null;

    const payload = {
      owner_email: userEmail,
      name: name.trim(),
      slug: finalSlug,
      status: preservedStatus,
      config: {
        ...config,
        version: 2,
        productSnapshots: freshSnapshots,
      },
      published_at: preservedPublishedAt,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (editingId) {
      result = await supabase
        .from("landing_pages")
        .update(payload)
        .eq("id", editingId)
        .eq("owner_email", userEmail)
        .select("*")
        .single();
    } else {
      result = await supabase
        .from("landing_pages")
        .insert(payload)
        .select("*")
        .single();
    }

    setSaving(false);

    if (result.error) {
      console.error(result.error);
      if (
        String(result.error.message || "")
          .toLowerCase()
          .includes("duplicate")
      ) {
        toast.error("Ese enlace ya está siendo usado. Elegí otro slug.");
      } else {
        toast.error(result.error.message || "No se pudo guardar la página");
      }
      return null;
    }

    const saved = result.data as LandingRow;
    setEditingId(saved.id);
    setSlug(saved.slug);
    setConfig(normalizeConfig(saved.config));
    if (!options?.silent) {
      toast.success(
        preservedStatus === "published"
          ? "🚀 Página publicada correctamente"
          : "💾 Borrador guardado",
      );
    }
    await loadPages();
    return saved;
  };

  const openRealPreview = async () => {
    if (uploading) {
      toast.error("Esperá a que terminen de subir los archivos.");
      return;
    }

    // La vista previa real usa un borrador guardado para que pueda abrirse
    // en una pestaña nueva sin publicar la página.
    const popup = window.open("", "_blank");
    const saved = await save(false, {
      silent: true,
      preserveStatus: true,
    });

    if (!saved) {
      popup?.close();
      return;
    }

    const url = `${window.location.origin}/#/preview/${saved.id}`;
    if (popup) {
      popup.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    toast.success("👁 Vista previa abierta. Los pedidos de prueba no se guardarán.");
  };

  const deletePage = async (page: LandingRow) => {
    if (!confirm(`¿Eliminar la página "${page.name}"?`)) return;
    const { error } = await supabase
      .from("landing_pages")
      .delete()
      .eq("id", page.id)
      .eq("owner_email", userEmail);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Página eliminada");
    await loadPages();
  };

  const copyLink = async (page: LandingRow) => {
    const url =
      page.status === "published"
        ? `${window.location.origin}/#/p/${page.slug}`
        : `${window.location.origin}/#/preview/${page.id}`;

    await navigator.clipboard.writeText(url);

    toast.success(
      page.status === "published"
        ? "Link público copiado"
        : "Link de vista previa copiado",
    );
  };

  const openPage = (page: LandingRow) => {
    const url =
      page.status === "published"
        ? `${window.location.origin}/#/p/${page.slug}`
        : `${window.location.origin}/#/preview/${page.id}`;

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const currentPreviewProduct =
    config.productSnapshots[0] ||
    (primaryProduct ? snapshotFromProduct(primaryProduct) : null);

  if (editorOpen) {
    return (
      <div className="space-y-5">
        <style>{`
          .sky-dropzone{border:1.5px dashed hsl(var(--border));border-radius:14px;padding:13px;text-align:center;cursor:pointer;background:hsl(var(--secondary)/.15);transition:.2s}
          .sky-dropzone:hover{background:hsl(var(--secondary)/.35);border-color:hsl(var(--primary)/.55)}
          .sky-media-row{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px}
          .sky-media-card{width:92px;flex:0 0 92px;border:1px solid hsl(var(--border));border-radius:12px;overflow:hidden;background:hsl(var(--secondary)/.2)}
          .sky-media-preview{width:100%;height:76px;object-fit:cover;background:#111}
          .sky-media-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:3px}
          .sky-media-actions button{border:0;border-radius:6px;padding:4px 2px;font-size:10px;background:hsl(var(--secondary));cursor:pointer}
          .sky-block-card{border:1px solid hsl(var(--border));border-radius:16px;overflow:hidden;background:hsl(var(--background))}
          .sky-block-head{display:flex;align-items:center;gap:6px;padding:9px 10px;background:hsl(var(--secondary)/.25);border-bottom:1px solid hsl(var(--border))}
          .sky-block-head b{flex:1;font-size:12px}
          .sky-mini-btn{border:1px solid hsl(var(--border));border-radius:8px;padding:5px 7px;font-size:11px;background:hsl(var(--background));cursor:pointer}
          .sky-mini-btn:disabled{opacity:.3;cursor:not-allowed}
          .sky-block-card[draggable="true"]{cursor:default}
          .sky-block-card[draggable="true"]:hover{border-color:hsl(var(--primary)/.45)}
        `}</style>

        <div className="rounded-[28px] border border-border/70 bg-background p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button className="nav-btn" onClick={() => setEditorOpen(false)}>
              ← Mis páginas
            </button>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-primary font-black">
                Editor de página
              </div>
              <div className="font-black text-xl truncate">
                {name || "Nueva página"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`nav-btn ${previewMode === "desktop" ? "active" : ""}`}
              onClick={() => setPreviewMode("desktop")}
            >
              🖥 Escritorio
            </button>
            <button
              className={`nav-btn ${previewMode === "mobile" ? "active" : ""}`}
              onClick={() => setPreviewMode("mobile")}
            >
              📱 Móvil
            </button>
            <button
              className="nav-btn !bg-violet-500/15 !text-violet-500"
              disabled={saving || uploading}
              onClick={openRealPreview}
            >
              👁 Vista previa real
            </button>
            <button
              className="nav-btn"
              disabled={saving || uploading}
              onClick={() => save(false)}
            >
              {saving ? "Guardando..." : "💾 Guardar borrador"}
            </button>
            <button
              className="nav-btn active"
              disabled={saving || uploading}
              onClick={() => save(true)}
            >
              🚀 Publicar página
            </button>
          </div>
        </div>

        {uploading && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-bold">
            ⏳ Subiendo archivo... esperá a que termine antes de publicar.
          </div>
        )}

        <div className="grid grid-cols-1 2xl:grid-cols-[420px_minmax(0,1fr)] gap-5 items-start">
          <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-30px)] 2xl:overflow-y-auto 2xl:pr-2">
            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3">
              <div className="font-black">1. Datos de la página</div>
              <div>
                <label className="app-label">Nombre interno</label>
                <input
                  className="app-input"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!editingId && !slug) setSlug(slugify(e.target.value));
                  }}
                  placeholder="Ej: Cepillo 9 en 1"
                />
              </div>
              <div>
                <label className="app-label">Enlace público</label>
                <div className="flex items-center rounded-xl border border-border overflow-hidden bg-secondary/20">
                  <span className="px-3 text-xs text-muted-foreground">/p/</span>
                  <input
                    className="flex-1 bg-transparent px-2 py-2.5 outline-none text-sm"
                    value={slug}
                    onChange={(e) => setSlug(slugify(e.target.value))}
                    placeholder="cepillo-9-en-1"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3">
              <div className="font-black">2. Seleccionar productos</div>

              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base">
                  🔎
                </span>
                <input
                  className="app-input !pl-10"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder="Buscar producto por nombre o SKU..."
                />
                {productSearch && (
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-muted-foreground hover:text-foreground"
                    onClick={() => setProductSearch("")}
                    title="Limpiar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="text-[11px] text-muted-foreground">
                {filteredProducts.length} producto(s) encontrados
              </div>

              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                {filteredProducts.map((p) => {
                  const active = config.selectedProductIds.includes(p.id);
                  const image = p.image_url;
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleProduct(p.id)}
                      className={`w-full text-left rounded-xl border p-2 flex items-center gap-3 transition ${
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-secondary/20 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="w-12 h-12 rounded-lg bg-secondary overflow-hidden shrink-0">
                        {image ? (
                          <img
                            src={image}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full grid place-items-center">
                            📦
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm truncate">{p.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {nf(Number(p.suggested_price_gs || p.provider_price_gs || 0))} Gs
                        </div>
                      </div>
                      <div className="text-lg">{active ? "✅" : "○"}</div>
                    </button>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                    No encontré productos con “{productSearch}”.
                  </div>
                )}
              </div>
            </div>

            {config.productSnapshots.map((product) => (
              <div
                key={product.id}
                className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3"
              >
                <div className="font-black text-sm">🖼 Galería — {product.title}</div>
                <div className="text-xs text-muted-foreground">
                  Podés agregar todas las imágenes o videos que quieras. Arrastrar no es necesario: usá ← → para ordenar.
                </div>

                <label className="sky-dropzone block">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      uploadProductMedia(product.id, e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                  <div className="font-black text-sm">＋ Subir imágenes o videos</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    JPG, PNG, WEBP, GIF o video MP4/WebM
                  </div>
                </label>

                <div className="sky-media-row">
                  {(product.media || []).map((media, index) => (
                    <div className="sky-media-card" key={media.id}>
                      {media.type === "image" ? (
                        <img className="sky-media-preview" src={media.url} alt="" />
                      ) : (
                        <video className="sky-media-preview" src={media.url} muted />
                      )}
                      <div className="text-[9px] text-center py-1 font-bold">
                        {media.type === "image" ? "IMAGEN" : "VIDEO"} {index + 1}
                      </div>
                      <div className="sky-media-actions">
                        <button onClick={() => moveProductMedia(product.id, index, -1)}>←</button>
                        <button onClick={() => moveProductMedia(product.id, index, 1)}>→</button>
                        <button onClick={() => removeProductMedia(product.id, media.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="app-label">Título en la landing</label>
                  <input
                    className="app-input"
                    value={product.title}
                    onChange={(e) =>
                      updateSnapshot(product.id, { title: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="app-label">Precio</label>
                    <input
                      type="number"
                      className="app-input"
                      value={product.price}
                      onChange={(e) =>
                        updateSnapshot(product.id, {
                          price: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="app-label">Antes</label>
                    <input
                      type="number"
                      className="app-input"
                      value={product.compareAtPrice}
                      onChange={(e) =>
                        updateSnapshot(product.id, {
                          compareAtPrice: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="app-label">Descripción</label>
                  <textarea
                    className="app-input min-h-[90px]"
                    value={product.description}
                    onChange={(e) =>
                      updateSnapshot(product.id, { description: e.target.value })
                    }
                  />
                </div>
              </div>
            ))}

            <div className="rounded-[24px] border border-violet-500/40 bg-gradient-to-br from-violet-500/10 to-sky-500/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-black">✨ Crear la página con IA</div>
                <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-200">{aiProvider === "openai" ? "OpenAI" : "Claude"}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Arma la página completa: fotos con texto de venta, videos, título, descripción, beneficios, preguntas frecuentes y botón.
              </div>
              <div>
                <label className="app-label">Tono</label>
                <select className="app-input" value={aiTone} onChange={(e) => setAiTone(e.target.value)}>
                  <option>Vendedor y urgente</option>
                  <option>Amigable y cercano</option>
                  <option>Premium y elegante</option>
                  <option>Divertido</option>
                  <option>Profesional y técnico</option>
                </select>
              </div>
              <div>
                <label className="app-label">Público (opcional)</label>
                <input
                  className="app-input"
                  value={aiAudience}
                  onChange={(e) => setAiAudience(e.target.value)}
                  placeholder="Ej: mamás, oficinistas, gamers, dueños de mascotas"
                />
              </div>
              <div>
                <label className="app-label">Indicaciones (opcional)</label>
                <textarea
                  className="app-input min-h-[60px]"
                  value={aiNotes}
                  onChange={(e) => setAiNotes(e.target.value)}
                  placeholder="Ej: destacá que es recargable, oferta 2x1 esta semana"
                />
              </div>
              <div>
                <label className="app-label">Motor de IA (textos y diseño)</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["claude", "🧠 Claude", "Anthropic"],
                      ["openai", "🤖 OpenAI", "ChatGPT"],
                    ] as const
                  ).map(([value, title, hint]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseAiProvider(value)}
                      className={`rounded-xl border p-2 text-left text-xs ${
                        aiProvider === value ? "border-violet-400 bg-violet-500/15" : "border-border bg-background/40"
                      }`}
                    >
                      <b>{title}</b>
                      <span className="block text-[10px] text-muted-foreground">{hint}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Las fotos nuevas (modo 🚀 PRO o 📸) siempre las crea OpenAI.
                </div>
              </div>
              <div>
                <label className="app-label">Imágenes de venta</label>
                <div className="grid gap-1.5">
                  {(
                    [
                      ["pro", "🚀 PRO: fotos nuevas + diseño", "Imagen HERO + 4 imágenes (problema, solución, detalles, deseo): OpenAI crea las fotos y la IA diseña el anuncio encima, sin precios. Necesita la clave de OpenAI."],
                      ["claude", "🎨 Anuncios diseñados con tu foto real", "4 anuncios (problema, solución, detalles, deseo) con tu foto real, ilustraciones e insignias. Sin fotos nuevas."],
                      ["openai", "📸 Fotos realistas con IA (OpenAI)", "HERO + 4 escenas nuevas con el producto y su texto debajo. Necesita la clave de OpenAI."],
                      ["none", "🚫 Sin imágenes nuevas", "Sólo textos (y tus fotos/videos si subís)."],
                    ] as const
                  ).map(([value, title, hint]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-xs ${
                        aiImageMode === value ? "border-violet-400 bg-violet-500/15" : "border-border bg-background/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="ai-image-mode"
                        className="mt-0.5"
                        checked={aiImageMode === value}
                        onChange={() => setAiImageMode(value)}
                      />
                      <span>
                        <b>{title}</b>
                        <span className="block text-[10px] text-muted-foreground">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="app-label">Videos (y fotos propias, opcional)</label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-violet-400/50 bg-background/40 p-3 text-center text-xs hover:bg-background/70">
                  <span className="text-2xl">📸🎬</span>
                  <span className="font-bold">{uploading ? "Subiendo…" : "Subí hasta 3 videos (y si querés, fotos propias)"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    Los videos van en una fila con reproducción automática. Si subís fotos, la IA les escribe el texto también.
                  </span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const files = e.target.files;
                      void uploadAiMedia(files).finally(() => {
                        e.target.value = "";
                      });
                    }}
                  />
                </label>
                {aiMedia.length > 0 && (
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {aiMedia.map((m, i) => (
                      <div key={m.id} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary">
                        {m.type === "image" ? (
                          <img src={m.url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <video src={m.url} muted className="h-full w-full object-cover" />
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">
                          {m.type === "image" ? `📷 ${aiMedia.slice(0, i + 1).filter((x) => x.type === "image").length}` : "🎬"}
                        </span>
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-[10px] text-white"
                          onClick={() => setAiMedia((prev) => prev.filter((x) => x.id !== m.id))}
                          title="Quitar"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {(aiMedia.filter((m) => m.type === "image").length > 6 || aiMedia.filter((m) => m.type === "video").length > 3) && (
                  <div className="mt-1 text-[10px] text-amber-300">Se usan las primeras 6 fotos y 3 videos.</div>
                )}
              </div>
              <button
                type="button"
                className="nav-btn active w-full"
                disabled={aiLoading || uploading || config.productSnapshots.length === 0}
                onClick={() => void generateWithAI()}
              >
                {aiLoading
                  ? "✨ Escribiendo…"
                  : config.productSnapshots.length === 0
                    ? "Elegí un producto primero"
                    : "✨ Armar página completa con IA"}
              </button>
              <div className="text-[10px] text-muted-foreground">
                Arma la página con tus fotos, videos y textos (no toca precios ni tus bloques propios). Revisá todo antes de publicar.
              </div>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3">
              <div className="font-black">3. Agregar y ordenar bloques</div>

              <div className="text-xs text-muted-foreground">
                Armá la landing manualmente. Podés insertar contenido exactamente
                entre dos bloques, moverlo a una posición específica o arrastrarlo
                desde el símbolo ☰.
              </div>

              {insertAtIndex !== null && (
                <div className="rounded-xl border border-primary/40 bg-primary/10 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <div className="font-black text-sm">
                        📍 Insertar en posición {insertAtIndex + 1}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Elegí qué tipo de bloque querés poner exactamente aquí.
                      </div>
                    </div>
                    <button
                      className="sky-mini-btn"
                      onClick={() => setInsertAtIndex(null)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="nav-btn"
                  onClick={() => addBlock("heading")}
                >
                  ＋ Título
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("text")}
                >
                  ＋ Texto
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("image")}
                >
                  ＋ Imagen
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("video")}
                >
                  ＋ Video
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("media_gallery")}
                >
                  ＋ Galería multimedia
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("video_row")}
                >
                  🎬 Hasta 3 videos
                </button>
                <button className="nav-btn" onClick={() => addBlock("buy_button")}>
                  🛒 Botón Comprar
                </button>
                <button className="nav-btn" onClick={() => addBlock("quantity_offers")}>
                  💰 Ofertas por cantidad
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("image_text")}
                >
                  ＋ Imagen + texto
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("custom_html")}
                >
                  💻 Agregar HTML
                </button>
                <button
                  className="nav-btn"
                  onClick={() => addBlock("spacer")}
                >
                  ＋ Espacio
                </button>
              </div>

              <div className="rounded-2xl border-2 border-primary/40 bg-primary/10 p-4 text-xs">
                <div className="font-black text-primary text-sm">
                  ➕ ¿Dónde querés agregar la nueva sección?
                </div>
                <div className="mt-1 text-muted-foreground">
                  Tocá uno de los botones grandes <b className="text-foreground">“AGREGAR SECCIÓN AQUÍ”</b>.
                  La franja queda marcada y después elegís Título, Texto, Imagen, Imagen + texto,
                  Video, Galería, Ofertas, Botón o <b className="text-foreground">HTML personalizado</b>.
                </div>
              </div>

              {config.contentBlocks.length === 0 ? (
                <>
                  <button
                    className="w-full rounded-2xl border-2 border-primary bg-primary/20 hover:bg-primary/30 transition px-4 py-5 text-sm font-black text-primary shadow-sm"
                    onClick={() => setInsertAtIndex(0)}
                  >
                    ➕ AGREGAR LA PRIMERA SECCIÓN AQUÍ
                  </button>

                  <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                    Todavía no agregaste bloques.
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Punto de inserción ANTES del primer bloque */}
                  <button
                    className={`w-full rounded-2xl border-2 px-4 py-3 text-xs font-black transition shadow-sm ${
                      insertAtIndex === 0
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-primary/60 bg-primary/10 hover:bg-primary/20 text-primary"
                    }`}
                    onClick={() => setInsertAtIndex(0)}
                  >
                    ➕ AGREGAR SECCIÓN AQUÍ · POSICIÓN 1
                  </button>

                  {config.contentBlocks.map((block, index) => (
                    <div key={block.id} className="space-y-2">
                      <div
                        className={`sky-block-card transition ${
                          draggedBlockIndex === index
                            ? "opacity-50 ring-2 ring-primary"
                            : ""
                        }`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleBlockDrop(index);
                        }}
                      >
                        <div className="sky-block-head">
                          <span
                            draggable
                            onDragStart={() => handleBlockDragStart(index)}
                            onDragEnd={cancelBlockDrag}
                            title="Arrastrá desde aquí para mover"
                            className="cursor-grab active:cursor-grabbing select-none text-base px-1"
                          >
                            ☰
                          </span>

                          <b>
                            {index + 1}.{" "}
                            {block.type === "heading" && "TÍTULO"}
                            {block.type === "text" && "TEXTO"}
                            {block.type === "image" && "IMAGEN"}
                            {block.type === "video" && "VIDEO"}
                            {block.type === "media_gallery" && "GALERÍA MULTIMEDIA"}
                            {block.type === "video_row" && "HASTA 3 VIDEOS"}
                            {block.type === "buy_button" && "BOTÓN COMPRAR"}
                            {block.type === "quantity_offers" && "OFERTAS POR CANTIDAD"}
                            {block.type === "image_text" && "IMAGEN + TEXTO"}
                            {block.type === "custom_html" && "💻 HTML PERSONALIZADO"}
                            {block.type === "spacer" && "ESPACIO"}
                          </b>

                          <button
                            className="sky-mini-btn"
                            disabled={index === 0}
                            title="Subir una posición"
                            onClick={() => moveBlock(index, -1)}
                          >
                            ↑
                          </button>

                          <button
                            className="sky-mini-btn"
                            disabled={index === config.contentBlocks.length - 1}
                            title="Bajar una posición"
                            onClick={() => moveBlock(index, 1)}
                          >
                            ↓
                          </button>

                          <button
                            className="sky-mini-btn"
                            title={block.enabled ? "Ocultar" : "Mostrar"}
                            onClick={() =>
                              patchBlock(block.id, {
                                enabled: !block.enabled,
                              })
                            }
                          >
                            {block.enabled ? "👁" : "🚫"}
                          </button>

                          <button
                            className="sky-mini-btn"
                            title="Eliminar"
                            onClick={() => deleteBlock(block.id)}
                          >
                            ✕
                          </button>
                        </div>

                        <div className="p-3 space-y-3">
                          {/* Posición exacta */}
                          <div className="rounded-xl border border-border bg-secondary/10 p-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold whitespace-nowrap">
                                Mover a posición:
                              </span>
                              <select
                                className="app-input !py-1.5"
                                value={index + 1}
                                onChange={(e) =>
                                  moveBlockToPosition(
                                    index,
                                    Number(e.target.value),
                                  )
                                }
                              >
                                {config.contentBlocks.map((_, positionIndex) => (
                                  <option
                                    key={positionIndex}
                                    value={positionIndex + 1}
                                  >
                                    {positionIndex + 1}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {block.type === "heading" && (
                            <>
                              <textarea
                                className="app-input min-h-[70px]"
                                value={block.text}
                                onChange={(e) =>
                                  patchBlock(block.id, {
                                    text: e.target.value,
                                  })
                                }
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  className="app-input"
                                  value={block.size}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      size: e.target.value,
                                    })
                                  }
                                >
                                  <option value="md">Mediano</option>
                                  <option value="lg">Grande</option>
                                  <option value="xl">Muy grande</option>
                                </select>

                                <select
                                  className="app-input"
                                  value={block.align}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      align: e.target.value,
                                    })
                                  }
                                >
                                  <option value="left">Izquierda</option>
                                  <option value="center">Centrado</option>
                                </select>
                              </div>
                            </>
                          )}

                          {block.type === "text" && (
                            <>
                              <textarea
                                className="app-input min-h-[100px]"
                                value={block.text}
                                onChange={(e) =>
                                  patchBlock(block.id, {
                                    text: e.target.value,
                                  })
                                }
                              />
                              <select
                                className="app-input"
                                value={block.align}
                                onChange={(e) =>
                                  patchBlock(block.id, {
                                    align: e.target.value,
                                  })
                                }
                              >
                                <option value="left">Izquierda</option>
                                <option value="center">Centrado</option>
                              </select>
                            </>
                          )}

                          {block.type === "image" && (
                            <>
                              {block.url && (
                                <div className="overflow-visible rounded-xl bg-black/5 p-2">
                                  <img
                                    src={block.url}
                                    alt=""
                                    className="w-full max-h-52 object-contain rounded-xl"
                                    style={{
                                      transform: `translate(${block.imageOffsetX}px, ${block.imageOffsetY}px) scale(${block.imageScale / 100})`,
                                      transformOrigin: "center center",
                                    }}
                                  />
                                </div>
                              )}
                              <label className="sky-dropzone block">
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => { uploadBlockMedia(block, e.target.files); e.currentTarget.value = ""; }} />
                                <b>{block.url ? "Cambiar imagen" : "Subir imagen"}</b>
                              </label>
                              <textarea className="app-input min-h-[80px]" value={block.text} onChange={(e) => patchBlock(block.id, { text: e.target.value })} placeholder="Texto que querés mostrar con la imagen" />
                              <div className="grid grid-cols-2 gap-2">
                                <select className="app-input" value={block.textPosition} onChange={(e) => patchBlock(block.id, { textPosition: e.target.value })}>
                                  <option value="top">Texto arriba</option>
                                  <option value="bottom">Texto debajo</option>
                                  <option value="left">Texto izquierda</option>
                                  <option value="right">Texto derecha</option>
                                  <option value="overlay-top">Texto encima · arriba</option>
                                  <option value="overlay-center">Texto encima · centro</option>
                                  <option value="overlay-bottom">Texto encima · abajo</option>
                                </select>
                                <select className="app-input" value={block.textAlign} onChange={(e) => patchBlock(block.id, { textAlign: e.target.value })}>
                                  <option value="left">Texto izquierda</option>
                                  <option value="center">Texto centrado</option>
                                  <option value="right">Texto derecha</option>
                                </select>
                                <select className="app-input" value={block.width} onChange={(e) => patchBlock(block.id, { width: e.target.value })}>
                                  <option value="normal">Ancho normal</option>
                                  <option value="wide">Ancho grande</option>
                                  <option value="full">Ancho completo</option>
                                </select>
                                <select className="app-input" value={block.blockAlign} onChange={(e) => patchBlock(block.id, { blockAlign: e.target.value })}>
                                  <option value="left">Bloque izquierda</option>
                                  <option value="center">Bloque centro</option>
                                  <option value="right">Bloque derecha</option>
                                </select>
                              </div>
                              <input className="app-input" value={block.alt} onChange={(e) => patchBlock(block.id, { alt: e.target.value })} placeholder="Texto alternativo" />
                              <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                                <input type="checkbox" checked={block.rounded} onChange={(e) => patchBlock(block.id, { rounded: e.target.checked })} /> Redondeada
                              </label>

                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                                <div className="font-black text-sm">🎚 Ajustar tamaño y posición</div>
                                <div>
                                  <label className="app-label">Tamaño / Zoom: {block.imageScale}%</label>
                                  <input type="range" min="50" max="200" step="5" className="w-full" value={block.imageScale} onChange={(e) => patchBlock(block.id, { imageScale: Number(e.target.value) })} />
                                </div>
                                <div>
                                  <label className="app-label">Mover izquierda / derecha: {block.imageOffsetX}px</label>
                                  <input type="range" min="-200" max="200" step="5" className="w-full" value={block.imageOffsetX} onChange={(e) => patchBlock(block.id, { imageOffsetX: Number(e.target.value) })} />
                                </div>
                                <div>
                                  <label className="app-label">Mover arriba / abajo: {block.imageOffsetY}px</label>
                                  <input type="range" min="-200" max="200" step="5" className="w-full" value={block.imageOffsetY} onChange={(e) => patchBlock(block.id, { imageOffsetY: Number(e.target.value) })} />
                                </div>
                                <button type="button" className="nav-btn w-full !text-xs" onClick={() => patchBlock(block.id, { imageScale: 100, imageOffsetX: 0, imageOffsetY: 0 })}>↺ Restablecer imagen</button>
                              </div>

                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                                <div className="font-black text-sm">🎚 Ajustar tamaño y posición</div>
                                <div>
                                  <label className="app-label">Tamaño / Zoom: {block.imageScale}%</label>
                                  <input type="range" min="50" max="200" step="5" className="w-full" value={block.imageScale} onChange={(e) => patchBlock(block.id, { imageScale: Number(e.target.value) })} />
                                </div>
                                <div>
                                  <label className="app-label">Mover izquierda / derecha: {block.imageOffsetX}px</label>
                                  <input type="range" min="-200" max="200" step="5" className="w-full" value={block.imageOffsetX} onChange={(e) => patchBlock(block.id, { imageOffsetX: Number(e.target.value) })} />
                                </div>
                                <div>
                                  <label className="app-label">Mover arriba / abajo: {block.imageOffsetY}px</label>
                                  <input type="range" min="-200" max="200" step="5" className="w-full" value={block.imageOffsetY} onChange={(e) => patchBlock(block.id, { imageOffsetY: Number(e.target.value) })} />
                                </div>
                                <button type="button" className="nav-btn w-full !text-xs" onClick={() => patchBlock(block.id, { imageScale: 100, imageOffsetX: 0, imageOffsetY: 0 })}>↺ Restablecer imagen</button>
                              </div>

                              <label className="app-label">Espacio arriba: {block.marginTop}px</label>
                              <input type="range" min="0" max="120" step="2" className="w-full" value={block.marginTop} onChange={(e) => patchBlock(block.id, { marginTop: Number(e.target.value) })} />
                              <label className="app-label">Espacio abajo: {block.marginBottom}px</label>
                              <input type="range" min="0" max="120" step="2" className="w-full" value={block.marginBottom} onChange={(e) => patchBlock(block.id, { marginBottom: Number(e.target.value) })} />
                            </>
                          )}

                          {block.type === "video" && (
                            <>
                              {block.url && (
                                <video
                                  src={block.url}
                                  controls
                                  className="w-full max-h-52 rounded-xl bg-black"
                                />
                              )}

                              <label className="sky-dropzone block">
                                <input
                                  type="file"
                                  accept="video/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    uploadBlockMedia(
                                      block,
                                      e.target.files,
                                    );
                                    e.currentTarget.value = "";
                                  }}
                                />
                                <b>
                                  {block.url
                                    ? "Cambiar video"
                                    : "Subir video"}
                                </b>
                              </label>

                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {[
                                  ["autoplay", "Autoplay"],
                                  ["muted", "Sin sonido"],
                                  ["loop", "Repetir"],
                                  ["controls", "Controles"],
                                  ["rounded", "Redondeado"],
                                ].map(([key, label]) => (
                                  <label
                                    key={key}
                                    className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(
                                        (block as any)[key],
                                      )}
                                      onChange={(e) =>
                                        patchBlock(block.id, {
                                          [key]: e.target.checked,
                                        })
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>

                              <select
                                className="app-input"
                                value={block.width}
                                onChange={(e) =>
                                  patchBlock(block.id, {
                                    width: e.target.value,
                                  })
                                }
                              >
                                <option value="normal">Normal</option>
                                <option value="wide">Ancho</option>
                                <option value="full">
                                  Ancho completo
                                </option>
                              </select>
                            </>
                          )}

                          {block.type === "media_gallery" && (
                            <>
                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                                <div className="font-black text-sm">
                                  🎞 Galería de imágenes y videos
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-1">
                                  Para el formato de tu ejemplo usá 3 columnas,
                                  aspecto vertical y 1 columna en móvil.
                                </div>
                              </div>

                              <label className="sky-dropzone block">
                                <input
                                  type="file"
                                  accept="image/*,video/*"
                                  multiple
                                  className="hidden"
                                  onChange={(e) => {
                                    uploadGalleryMedia(
                                      block.id,
                                      e.target.files,
                                    );
                                    e.currentTarget.value = "";
                                  }}
                                />
                                <b>＋ Subir imágenes o videos</b>
                                <div className="text-[11px] text-muted-foreground mt-1">
                                  Podés seleccionar varios archivos juntos.
                                </div>
                              </label>

                              {block.items.length > 0 ? (
                                <div className="sky-media-row">
                                  {block.items.map((item, mediaIndex) => (
                                    <div
                                      className="sky-media-card"
                                      key={item.id}
                                    >
                                      {item.type === "image" ? (
                                        <img
                                          className="sky-media-preview"
                                          src={item.url}
                                          alt=""
                                        />
                                      ) : (
                                        <div className="relative">
                                          <video
                                            className="sky-media-preview"
                                            src={item.url}
                                            muted
                                            playsInline
                                          />
                                          <div className="absolute inset-0 grid place-items-center text-white text-xl pointer-events-none">
                                            ▶
                                          </div>
                                        </div>
                                      )}

                                      <div className="text-[9px] text-center py-1 font-bold">
                                        {item.type === "image"
                                          ? "IMAGEN"
                                          : "VIDEO"}{" "}
                                        {mediaIndex + 1}
                                      </div>

                                      <div className="sky-media-actions">
                                        <button
                                          disabled={mediaIndex === 0}
                                          onClick={() =>
                                            moveGalleryMedia(
                                              block.id,
                                              mediaIndex,
                                              -1,
                                            )
                                          }
                                        >
                                          ←
                                        </button>
                                        <button
                                          disabled={
                                            mediaIndex ===
                                            block.items.length - 1
                                          }
                                          onClick={() =>
                                            moveGalleryMedia(
                                              block.id,
                                              mediaIndex,
                                              1,
                                            )
                                          }
                                        >
                                          →
                                        </button>
                                        <button
                                          onClick={() =>
                                            removeGalleryMedia(
                                              block.id,
                                              item.id,
                                            )
                                          }
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                                  Todavía no cargaste archivos en esta galería.
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="app-label">
                                    Columnas escritorio
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.columns}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        columns: Number(e.target.value),
                                      })
                                    }
                                  >
                                    <option value={1}>1 columna</option>
                                    <option value={2}>2 columnas</option>
                                    <option value={3}>3 columnas</option>
                                    <option value={4}>4 columnas</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">
                                    Columnas móvil
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.mobileColumns}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        mobileColumns: Number(
                                          e.target.value,
                                        ),
                                      })
                                    }
                                  >
                                    <option value={1}>1 columna</option>
                                    <option value={2}>2 columnas</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">Formato</label>
                                  <select
                                    className="app-input"
                                    value={block.aspect}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        aspect: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="portrait">
                                      Vertical 9:16
                                    </option>
                                    <option value="square">
                                      Cuadrado 1:1
                                    </option>
                                    <option value="auto">
                                      Tamaño original
                                    </option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">
                                    Ancho del bloque
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.width}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        width: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="normal">Normal</option>
                                    <option value="wide">Ancho</option>
                                    <option value="full">
                                      Ancho completo
                                    </option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="app-label">
                                  Separación: {block.gap}px
                                </label>
                                <input
                                  type="range"
                                  min="0"
                                  max="40"
                                  step="1"
                                  className="w-full"
                                  value={block.gap}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      gap: Number(e.target.value),
                                    })
                                  }
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {[
                                  ["controls", "Controles"],
                                  ["autoplay", "Autoplay"],
                                  ["muted", "Sin sonido"],
                                  ["loop", "Repetir"],
                                  ["rounded", "Redondeado"],
                                ].map(([key, label]) => (
                                  <label
                                    key={key}
                                    className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(
                                        (block as any)[key],
                                      )}
                                      onChange={(e) =>
                                        patchBlock(block.id, {
                                          [key]: e.target.checked,
                                        })
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </>
                          )}

                          {block.type === "video_row" && (
                            <>
                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                                <div className="font-black text-sm">
                                  🎬 Hasta 3 videos uno al lado del otro
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-1">
                                  Subí 1, 2 o 3 videos. En escritorio podés
                                  mostrarlos juntos en la misma fila.
                                </div>
                              </div>

                              <label className="sky-dropzone block">
                                <input
                                  type="file"
                                  accept="video/*"
                                  multiple
                                  className="hidden"
                                  onChange={(e) => {
                                    uploadVideoRow(
                                      block.id,
                                      e.target.files,
                                    );
                                    e.currentTarget.value = "";
                                  }}
                                />
                                <b>
                                  ＋ Subir videos ({block.videos.length}/3)
                                </b>
                                <div className="text-[11px] text-muted-foreground mt-1">
                                  Máximo 3 videos por bloque.
                                </div>
                              </label>

                              {block.videos.length > 0 && (
                                <div className="sky-media-row">
                                  {block.videos.map((item, mediaIndex) => (
                                    <div
                                      className="sky-media-card"
                                      key={item.id}
                                    >
                                      <video
                                        className="sky-media-preview"
                                        src={item.url}
                                        muted
                                        playsInline
                                      />

                                      <div className="text-[9px] text-center py-1 font-bold">
                                        VIDEO {mediaIndex + 1}
                                      </div>

                                      <div className="sky-media-actions">
                                        <button
                                          disabled={mediaIndex === 0}
                                          onClick={() =>
                                            moveVideoRowItem(
                                              block.id,
                                              mediaIndex,
                                              -1,
                                            )
                                          }
                                        >
                                          ←
                                        </button>
                                        <button
                                          disabled={
                                            mediaIndex ===
                                            block.videos.length - 1
                                          }
                                          onClick={() =>
                                            moveVideoRowItem(
                                              block.id,
                                              mediaIndex,
                                              1,
                                            )
                                          }
                                        >
                                          →
                                        </button>
                                        <button
                                          onClick={() =>
                                            removeVideoRowItem(
                                              block.id,
                                              item.id,
                                            )
                                          }
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="app-label">
                                    Columnas escritorio
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.desktopColumns}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        desktopColumns: Number(
                                          e.target.value,
                                        ),
                                      })
                                    }
                                  >
                                    <option value={1}>1 video por fila</option>
                                    <option value={2}>2 videos juntos</option>
                                    <option value={3}>
                                      ✅ 3 videos juntos
                                    </option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">
                                    Columnas móvil
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.mobileColumns}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        mobileColumns: Number(
                                          e.target.value,
                                        ),
                                      })
                                    }
                                  >
                                    <option value={1}>
                                      1 por fila
                                    </option>
                                    <option value={2}>
                                      2 juntos
                                    </option>
                                    <option value={3}>
                                      3 juntos
                                    </option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">
                                    Formato
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.aspect}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        aspect: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="portrait">
                                      ✅ Vertical 9:16
                                    </option>
                                    <option value="square">
                                      Cuadrado 1:1
                                    </option>
                                    <option value="auto">
                                      Original
                                    </option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">
                                    Ancho
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.width}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        width: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="normal">Normal</option>
                                    <option value="wide">Ancho</option>
                                    <option value="full">
                                      Ancho completo
                                    </option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="app-label">
                                  Separación: {block.gap}px
                                </label>
                                <input
                                  type="range"
                                  min="0"
                                  max="40"
                                  step="1"
                                  className="w-full"
                                  value={block.gap}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      gap: Number(e.target.value),
                                    })
                                  }
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {[
                                  ["controls", "Controles"],
                                  ["autoplay", "Autoplay"],
                                  ["muted", "Sin sonido"],
                                  ["loop", "Repetir"],
                                  ["rounded", "Redondeado"],
                                ].map(([key, label]) => (
                                  <label
                                    key={key}
                                    className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(
                                        (block as any)[key],
                                      )}
                                      onChange={(e) =>
                                        patchBlock(block.id, {
                                          [key]: e.target.checked,
                                        })
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </>
                          )}

                          {block.type === "buy_button" && (
                            <>
                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
                                🛒 Este botón abre el checkout lateral sobre la
                                misma página. No redirige al cliente.
                              </div>

                              <div>
                                <label className="app-label">
                                  Texto principal
                                </label>
                                <input
                                  className="app-input"
                                  value={block.text}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      text: e.target.value,
                                    })
                                  }
                                />
                              </div>

                              <div>
                                <label className="app-label">Subtexto</label>
                                <input
                                  className="app-input"
                                  value={block.subtext}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      subtext: e.target.value,
                                    })
                                  }
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="app-label">Ancho</label>
                                  <select
                                    className="app-input"
                                    value={block.width}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        width: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="normal">Normal</option>
                                    <option value="wide">Ancho</option>
                                    <option value="full">
                                      Ancho completo
                                    </option>
                                  </select>
                                </div>

                                <div>
                                  <label className="app-label">
                                    Alineación
                                  </label>
                                  <select
                                    className="app-input"
                                    value={block.align}
                                    onChange={(e) =>
                                      patchBlock(block.id, {
                                        align: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="left">Izquierda</option>
                                    <option value="center">Centro</option>
                                    <option value="right">Derecha</option>
                                  </select>
                                </div>
                              </div>

                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                                <div className="font-black text-sm">🎨 Diseño + efecto</div>
                                <div className="grid grid-cols-3 gap-2">
                                  <label className="text-[10px]">Fondo<input type="color" className="w-full h-10" value={block.backgroundColor} onChange={(e) => patchBlock(block.id,{backgroundColor:e.target.value})}/></label>
                                  <label className="text-[10px]">Texto<input type="color" className="w-full h-10" value={block.textColor} onChange={(e) => patchBlock(block.id,{textColor:e.target.value})}/></label>
                                  <label className="text-[10px]">Borde<input type="color" className="w-full h-10" value={block.borderColor} onChange={(e) => patchBlock(block.id,{borderColor:e.target.value})}/></label>
                                </div>
                                <label className="app-label">Texto: {block.fontSize}px</label>
                                <input type="range" min="12" max="36" value={block.fontSize} className="w-full" onChange={(e)=>patchBlock(block.id,{fontSize:Number(e.target.value)})}/>
                                <label className="app-label">Altura: {block.paddingY}px</label>
                                <input type="range" min="6" max="32" value={block.paddingY} className="w-full" onChange={(e)=>patchBlock(block.id,{paddingY:Number(e.target.value)})}/>
                                <label className="app-label">Redondeado: {block.borderRadius}px</label>
                                <input type="range" min="0" max="999" step="5" value={block.borderRadius} className="w-full" onChange={(e)=>patchBlock(block.id,{borderRadius:Number(e.target.value)})}/>
                                <label className="app-label">Borde: {block.borderWidth}px</label>
                                <input type="range" min="0" max="8" value={block.borderWidth} className="w-full" onChange={(e)=>patchBlock(block.id,{borderWidth:Number(e.target.value)})}/>
                                <div className="grid grid-cols-2 gap-2">
                                  <select className="app-input" value={block.effect} onChange={(e)=>patchBlock(block.id,{effect:e.target.value})}>
                                    <option value="none">Sin efecto</option>
                                    <option value="shake">🔥 Agitar</option>
                                    <option value="pulse">💓 Pulso</option>
                                    <option value="bounce">⬆ Rebote</option>
                                    <option value="shine">✨ Brillo</option>
                                  </select>
                                  <select className="app-input" value={block.effectEverySeconds} onChange={(e)=>patchBlock(block.id,{effectEverySeconds:Number(e.target.value)})}>
                                    <option value={2}>Cada 2s</option><option value={3}>Cada 3s</option><option value={5}>Cada 5s</option><option value={8}>Cada 8s</option>
                                  </select>
                                </div>
                              </div>

                              <button
                                type="button"
                                style={{
                                  width:
                                    block.width === "normal"
                                      ? "70%"
                                      : "100%",
                                  margin:
                                    block.align === "center"
                                      ? "0 auto"
                                      : block.align === "right"
                                        ? "0 0 0 auto"
                                        : "0",
                                  display: "block",
                                  border: `${block.borderWidth}px solid ${block.borderColor}`,
                                  borderRadius: block.borderRadius,
                                  background: block.backgroundColor,
                                  color: block.textColor,
                                  padding: `${block.paddingY}px 14px`,
                                  fontSize: block.fontSize,
                                  fontWeight: 900,
                                }}
                              >
                                <div>{block.text}</div>
                                {block.subtext && (
                                  <div
                                    style={{
                                      fontSize: 10,
                                      marginTop: 2,
                                    }}
                                  >
                                    {block.subtext}
                                  </div>
                                )}
                              </button>
                            </>
                          )}

                          {block.type === "quantity_offers" && (
                            <>
                              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
                                💰 Usa las ofertas configuradas abajo. Este bloque lo podés mover a cualquier posición.
                              </div>
                              <input className="app-input" value={block.title} onChange={(e)=>patchBlock(block.id,{title:e.target.value})}/>
                              <div className="grid grid-cols-2 gap-2">
                                <select className="app-input" value={block.width} onChange={(e)=>patchBlock(block.id,{width:e.target.value})}><option value="normal">Normal</option><option value="wide">Ancho</option><option value="full">Completo</option></select>
                                <select className="app-input" value={block.align} onChange={(e)=>patchBlock(block.id,{align:e.target.value})}><option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option></select>
                              </div>
                              {config.quantityOffers.map((offer)=>(
                                <div key={offer.id} className="rounded-xl border border-border p-2 text-xs flex justify-between"><b>{offer.quantity} unidad(es)</b><b>Gs. {nf(offer.priceGs)}</b></div>
                              ))}
                            </>
                          )}

                          {block.type === "image_text" && (
                            <>
                              {block.imageUrl && (
                                <div className="overflow-visible rounded-xl bg-black/5 p-2">
                                  <img
                                    src={block.imageUrl}
                                    alt=""
                                    className="w-full max-h-52 object-contain rounded-xl"
                                    style={{
                                      transform: `translate(${block.imageOffsetX}px, ${block.imageOffsetY}px) scale(${block.imageScale / 100})`,
                                      transformOrigin: "center center",
                                    }}
                                  />
                                </div>
                              )}
                              <label className="sky-dropzone block">
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => { uploadBlockMedia(block, e.target.files); e.currentTarget.value = ""; }} />
                                <b>{block.imageUrl ? "Cambiar imagen" : "Subir imagen"}</b>
                              </label>
                              <input className="app-input" value={block.title} onChange={(e) => patchBlock(block.id, { title: e.target.value })} placeholder="Título" />
                              <textarea className="app-input min-h-[90px]" value={block.text} onChange={(e) => patchBlock(block.id, { text: e.target.value })} />
                              <div className="grid grid-cols-2 gap-2">
                                <select className="app-input" value={block.imagePosition} onChange={(e) => patchBlock(block.id, { imagePosition: e.target.value })}>
                                  <option value="top">Texto arriba / imagen debajo</option>
                                  <option value="bottom">✅ Imagen arriba / TEXTO DEBAJO</option>
                                  <option value="left">Imagen izquierda / texto a la derecha</option>
                                  <option value="right">Texto a la izquierda / imagen derecha</option>
                                  <option value="overlay">Texto encima de la imagen</option>
                                </select>
                                <select className="app-input" value={block.textAlign} onChange={(e) => patchBlock(block.id, { textAlign: e.target.value })}>
                                  <option value="left">Texto izquierda</option>
                                  <option value="center">Texto centro</option>
                                  <option value="right">Texto derecha</option>
                                </select>
                                <select className="app-input" value={block.width} onChange={(e) => patchBlock(block.id, { width: e.target.value })}>
                                  <option value="normal">Ancho normal</option>
                                  <option value="wide">Ancho grande</option>
                                  <option value="full">Ancho completo</option>
                                </select>
                                <select className="app-input" value={block.blockAlign} onChange={(e) => patchBlock(block.id, { blockAlign: e.target.value })}>
                                  <option value="left">Bloque izquierda</option>
                                  <option value="center">Bloque centro</option>
                                  <option value="right">Bloque derecha</option>
                                </select>
                              </div>
                              <label className="app-label">Espacio arriba: {block.marginTop}px</label>
                              <input type="range" min="0" max="120" step="2" className="w-full" value={block.marginTop} onChange={(e) => patchBlock(block.id, { marginTop: Number(e.target.value) })} />
                              <label className="app-label">Espacio abajo: {block.marginBottom}px</label>
                              <input type="range" min="0" max="120" step="2" className="w-full" value={block.marginBottom} onChange={(e) => patchBlock(block.id, { marginBottom: Number(e.target.value) })} />
                            </>
                          )}

                          {block.type === "custom_html" && (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs">
                                <b className="text-primary">💻 HTML personalizado</b>
                                <div className="mt-1 text-muted-foreground">
                                  Pegá HTML con estilos inline. La vista previa aparece automáticamente.
                                  Por seguridad se eliminan scripts, iframes y atributos JavaScript.
                                </div>
                              </div>

                              <div>
                                <label className="app-label">Ancho de la sección</label>
                                <select
                                  className="app-input"
                                  value={block.width}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      width: e.target.value,
                                    })
                                  }
                                >
                                  <option value="normal">Normal</option>
                                  <option value="wide">Ancho</option>
                                  <option value="full">Todo el ancho</option>
                                </select>
                              </div>

                              <div>
                                <label className="app-label">Código HTML</label>
                                <textarea
                                  className="app-input min-h-[260px] font-mono text-xs leading-5"
                                  value={block.html}
                                  onChange={(e) =>
                                    patchBlock(block.id, {
                                      html: e.target.value,
                                    })
                                  }
                                  spellCheck={false}
                                  placeholder={`<section style="padding:24px;background:#173a74;color:white;border-radius:18px;">
  <h2>Mi sección</h2>
  <p>Contenido...</p>
</section>`}
                                />
                              </div>

                              <div>
                                <div className="app-label">Vista previa automática</div>
                                <div
                                  className="rounded-xl border border-border bg-white overflow-hidden"
                                  style={{ minHeight: 80 }}
                                >
                                  {block.html.trim() ? (
                                    <div
                                      dangerouslySetInnerHTML={{
                                        __html: sanitizeCustomHtml(block.html),
                                      }}
                                    />
                                  ) : (
                                    <div className="p-5 text-center text-xs text-gray-500">
                                      Pegá HTML arriba para ver la vista previa.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {block.type === "spacer" && (
                            <div>
                              <label className="app-label">
                                Altura: {block.height}px
                              </label>
                              <input
                                type="range"
                                min="10"
                                max="180"
                                step="5"
                                className="w-full"
                                value={block.height}
                                onChange={(e) =>
                                  patchBlock(block.id, {
                                    height: Number(
                                      e.target.value,
                                    ),
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Punto de inserción DESPUÉS de cada bloque */}
                      <button
                        className={`w-full rounded-2xl border-2 px-4 py-3 text-xs font-black transition shadow-sm ${
                          insertAtIndex === index + 1
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-primary/60 bg-primary/10 hover:bg-primary/20 text-primary"
                        }`}
                        onClick={() =>
                          setInsertAtIndex(index + 1)
                        }
                      >
                        ➕ AGREGAR SECCIÓN AQUÍ · POSICIÓN {index + 2}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3">
              <div className="font-black">4. Tema Shrine / Skyline</div>
              <div>
                <label className="app-label">Barra superior</label>
                <input
                  className="app-input"
                  value={config.announcement}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, announcement: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="app-label text-[10px]">Principal</label>
                  <input
                    type="color"
                    className="w-full h-10 rounded-lg"
                    value={config.primaryColor}
                    onChange={(e) =>
                      setConfig((p) => ({ ...p, primaryColor: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="app-label text-[10px]">Texto</label>
                  <input
                    type="color"
                    className="w-full h-10 rounded-lg"
                    value={config.accentColor}
                    onChange={(e) =>
                      setConfig((p) => ({ ...p, accentColor: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="app-label text-[10px]">Comprar</label>
                  <input
                    type="color"
                    className="w-full h-10 rounded-lg"
                    value={config.buttonColor}
                    onChange={(e) =>
                      setConfig((p) => ({ ...p, buttonColor: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="app-label">Texto botón</label>
                <input
                  className="app-input"
                  value={config.buttonText}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, buttonText: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="app-label">Subtexto botón</label>
                <input
                  className="app-input"
                  value={config.buttonSubtext}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, buttonSubtext: e.target.value }))
                  }
                />
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="font-black text-sm">🛒 Botón principal de compra</div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[10px]">Fondo<input type="color" className="w-full h-10" value={config.buttonColor} onChange={(e)=>setConfig((p)=>({...p,buttonColor:e.target.value}))}/></label>
                  <label className="text-[10px]">Texto<input type="color" className="w-full h-10" value={config.mainButtonTextColor} onChange={(e)=>setConfig((p)=>({...p,mainButtonTextColor:e.target.value}))}/></label>
                  <label className="text-[10px]">Borde<input type="color" className="w-full h-10" value={config.mainButtonBorderColor} onChange={(e)=>setConfig((p)=>({...p,mainButtonBorderColor:e.target.value}))}/></label>
                </div>
                <label className="app-label">Tamaño texto: {config.mainButtonFontSize}px</label>
                <input type="range" min="11" max="28" className="w-full" value={config.mainButtonFontSize} onChange={(e)=>setConfig((p)=>({...p,mainButtonFontSize:Number(e.target.value)}))}/>
                <label className="app-label">Altura: {config.mainButtonPaddingY}px</label>
                <input type="range" min="5" max="28" className="w-full" value={config.mainButtonPaddingY} onChange={(e)=>setConfig((p)=>({...p,mainButtonPaddingY:Number(e.target.value)}))}/>
                <label className="app-label">Redondeado: {config.mainButtonBorderRadius}px</label>
                <input type="range" min="0" max="80" step="2" className="w-full" value={config.mainButtonBorderRadius} onChange={(e)=>setConfig((p)=>({...p,mainButtonBorderRadius:Number(e.target.value)}))}/>
                <label className="app-label">Grosor borde: {config.mainButtonBorderWidth}px</label>
                <input type="range" min="0" max="8" className="w-full" value={config.mainButtonBorderWidth} onChange={(e)=>setConfig((p)=>({...p,mainButtonBorderWidth:Number(e.target.value)}))}/>
                <div className="grid grid-cols-2 gap-2">
                  <select className="app-input" value={config.mainButtonEffect} onChange={(e)=>setConfig((p)=>({...p,mainButtonEffect:e.target.value as LandingConfig["mainButtonEffect"]}))}>
                    <option value="none">Sin efecto</option><option value="shake">🔥 Agitar</option><option value="pulse">💓 Pulso</option><option value="bounce">⬆ Rebote</option><option value="shine">✨ Brillo</option>
                  </select>
                  <select className="app-input" value={config.mainButtonEffectEverySeconds} onChange={(e)=>setConfig((p)=>({...p,mainButtonEffectEverySeconds:Number(e.target.value)}))}>
                    <option value={2}>Cada 2s</option><option value={3}>Cada 3s</option><option value={5}>Cada 5s</option><option value={8}>Cada 8s</option><option value={12}>Cada 12s</option>
                  </select>
                </div>
                <button type="button" className={`w-full font-black sky-builder-main-${config.mainButtonEffect}`} style={{background:config.buttonColor,color:config.mainButtonTextColor,border:`${config.mainButtonBorderWidth}px solid ${config.mainButtonBorderColor}`,borderRadius:config.mainButtonBorderRadius,padding:`${config.mainButtonPaddingY}px 16px`,fontSize:config.mainButtonFontSize,animationDuration:`${config.mainButtonEffectEverySeconds}s`}}>
                  <div>{config.buttonText}</div><div style={{fontSize:11,marginTop:3}}>{config.buttonSubtext}</div>
                </button>
              </div>

              <div>
                <label className="app-label">Texto reviews</label>
                <input
                  className="app-input"
                  value={config.reviewsText}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, reviewsText: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-4">
              <div>
                <div className="font-black">5. 💰 Ofertas por cantidad</div>
                <div className="text-xs text-muted-foreground mt-1">Tarjetas editables como tu ejemplo: imagen, título, descripción, precio anterior, precio actual y badge.</div>
              </div>
              {config.quantityOffers.map((offer,index)=>(
                <div key={offer.id} className={`rounded-xl border p-3 space-y-3 ${offer.highlight?"border-primary bg-primary/5":"border-border"}`}>
                  <div className="flex justify-between gap-2"><b>Oferta {index+1}</b><label className="text-xs flex gap-2"><input type="checkbox" checked={offer.highlight} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,highlight:e.target.checked}:o)}))}/> Destacada</label></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="app-label">Cantidad</label><input type="number" min="1" className="app-input" value={offer.quantity} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,quantity:Math.max(1,Number(e.target.value||1))}:o)}))}/></div>
                    <div><label className="app-label">Precio actual total</label><input type="number" min="0" className="app-input" value={offer.priceGs} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,priceGs:Math.max(0,Number(e.target.value||0))}:o)}))}/></div>
                  </div>
                  <div><label className="app-label">Precio anterior tachado</label><input type="number" min="0" className="app-input" value={offer.compareAtPriceGs} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,compareAtPriceGs:Math.max(0,Number(e.target.value||0))}:o)}))}/></div>
                  <input className="app-input" placeholder="Título: PROMO 2X1..." value={offer.title} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,title:e.target.value}:o)}))}/>
                  <textarea className="app-input min-h-[70px]" placeholder="Descripción de la oferta" value={offer.description} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,description:e.target.value}:o)}))}/>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="app-input" placeholder="Texto corto" value={offer.label} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,label:e.target.value}:o)}))}/>
                    <input className="app-input" placeholder="Badge: OFERTA MEJORADA 🔥" value={offer.badge} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,badge:e.target.value}:o)}))}/>
                  </div>
                  <div>
                    <label className="app-label">Imagen</label>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input className="app-input" placeholder="URL imagen" value={offer.imageUrl} onChange={(e)=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,imageUrl:e.target.value}:o)}))}/>
                      <label className="nav-btn cursor-pointer">📷 Subir<input type="file" accept="image/*" className="hidden" onChange={async(e)=>{const file=e.target.files?.[0];e.currentTarget.value="";if(!file)return;const uploaded=await uploadFile(file,`offers/${offer.id}`);if(!uploaded||uploaded.type!=="image")return;setConfig((p)=>({...p,quantityOffers:p.quantityOffers.map((o)=>o.id===offer.id?{...o,imageUrl:uploaded.url}:o)}));}}/></label>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3 bg-background flex gap-3">
                    {offer.imageUrl&&(
                      <img
                        src={offer.imageUrl}
                        alt=""
                        style={{
                          width: 56,
                          height: 50,
                          minWidth: 56,
                          maxWidth: 56,
                          maxHeight: 50,
                          objectFit: "cover",
                          borderRadius: 5,
                          display: "block",
                        }}
                      />
                    )}
                    <div className="flex-1 min-w-0"><b className="text-sm">{offer.title||`${offer.quantity} unidad(es)`}</b>{offer.description&&<div className="text-xs mt-1">{offer.description}</div>}{offer.badge&&<span className="inline-flex mt-1 rounded bg-primary px-2 py-0.5 text-[9px] font-black text-primary-foreground">{offer.badge}</span>}</div>
                    <div className="text-right">{offer.compareAtPriceGs>offer.priceGs&&<div className="line-through text-[10px] text-muted-foreground">Gs. {nf(offer.compareAtPriceGs)}</div>}<b>Gs. {nf(offer.priceGs)}</b></div>
                  </div>
                  <button className="nav-btn !text-xs" onClick={()=>setConfig((p)=>({...p,quantityOffers:p.quantityOffers.filter((o)=>o.id!==offer.id)}))}>✕ Eliminar oferta</button>
                </div>
              ))}
              <button className="nav-btn active w-full" onClick={()=>{const quantity=config.quantityOffers.length+1;const unit=config.productSnapshots[0]?.price||0;setConfig((p)=>({...p,quantityOffers:[...p.quantityOffers,{id:uid(),quantity,priceGs:unit*quantity,compareAtPriceGs:unit*quantity,title:`PROMO ${quantity} UNIDAD${quantity>1?"ES":""}`,description:"",label:"",badge:p.quantityOffers.length===1?"MÁS VENDIDO 🔥":"",imageUrl:p.productSnapshots[0]?.media?.find((item)=>item.type==="image")?.url||"",highlight:p.quantityOffers.length===0}]}));}}>＋ Agregar otra oferta</button>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-4">
              <div><div className="font-black">6. 🧩 Secciones extra del checkout</div><div className="text-xs text-muted-foreground mt-1">Agregá avisos, beneficios, garantías o instrucciones dentro del panel de compra.</div></div>
              {config.checkoutSections.map((section,index)=>(
                <div key={section.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex justify-between"><b>Sección {index+1}</b><button className="nav-btn !text-xs" onClick={()=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.filter((s)=>s.id!==section.id)}))}>✕</button></div>
                  <div className="grid grid-cols-[80px_1fr] gap-2"><input className="app-input text-center" value={section.icon} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,icon:e.target.value}:s)}))}/><input className="app-input" placeholder="Título" value={section.title} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,title:e.target.value}:s)}))}/></div>
                  <textarea className="app-input min-h-[70px]" value={section.text} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,text:e.target.value}:s)}))}/>
                  <select className="app-input" value={section.placement} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,placement:e.target.value as CheckoutCustomSection["placement"]}:s)}))}><option value="before_offers">Antes de ofertas</option><option value="after_offers">Después de ofertas</option><option value="before_shipping">Antes de envío</option><option value="before_form">Antes de datos</option><option value="after_form">Después de datos</option></select>
                  <div className="grid grid-cols-3 gap-2"><label className="text-[10px]">Fondo<input type="color" className="w-full h-9" value={section.backgroundColor} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,backgroundColor:e.target.value}:s)}))}/></label><label className="text-[10px]">Texto<input type="color" className="w-full h-9" value={section.textColor} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,textColor:e.target.value}:s)}))}/></label><label className="text-[10px]">Borde<input type="color" className="w-full h-9" value={section.borderColor} onChange={(e)=>setConfig((p)=>({...p,checkoutSections:p.checkoutSections.map((s)=>s.id===section.id?{...s,borderColor:e.target.value}:s)}))}/></label></div>
                </div>
              ))}
              <button className="nav-btn active w-full" onClick={()=>setConfig((p)=>({...p,checkoutSections:[...p.checkoutSections,{id:uid(),title:"ATENCIÓN",text:"Agregá aquí información importante para el cliente.",icon:"⭐",placement:"before_form",backgroundColor:"#fff8e8",textColor:"#111111",borderColor:"#e5c76b"}]}))}>＋ Agregar sección al checkout</button>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3">
              <div className="font-black">7. 🇵🇾 Cobertura</div>
              <div className="grid gap-2">
                <button className={`nav-btn ${config.coverageMode==="all"?"active":""}`} onClick={()=>setConfig((p)=>({...p,coverageMode:"all"}))}>🇵🇾 Todo Paraguay</button>
                <button className={`nav-btn ${config.coverageMode==="platform"?"active":""}`} onClick={()=>setConfig((p)=>({...p,coverageMode:"platform"}))}>✅ Cobertura de la plataforma</button>
                <button className={`nav-btn ${config.coverageMode==="custom"?"active":""}`} onClick={()=>setConfig((p)=>({...p,coverageMode:"custom"}))}>🎯 Elegir / ocultar manualmente</button>
              </div>
              {config.coverageMode==="platform" && <div className="rounded-xl bg-primary/5 border border-primary/30 p-3 text-xs">Usará únicamente las ciudades activas de <b>platform_delivery_coverage</b>.</div>}
              {config.coverageMode==="custom" && (
                <div className="space-y-2 max-h-[520px] overflow-auto">
                  <div className="flex gap-2 sticky top-0 bg-background py-2 z-10">
                    <button className="nav-btn !text-xs" onClick={()=>setConfig((p)=>({...p,hiddenDepartments:[],hiddenCities:[]}))}>✓ Mostrar todas</button>
                    <button className="nav-btn !text-xs" onClick={()=>setConfig((p)=>({...p,hiddenDepartments:PARAGUAY_LOCATIONS.map((d)=>d.department),hiddenCities:[]}))}>✕ Ocultar todas</button>
                  </div>
                  {PARAGUAY_LOCATIONS.map((dep)=>{
                    const off=config.hiddenDepartments.includes(dep.department);
                    return <details key={dep.department} className="rounded-xl border border-border p-3">
                      <summary className="font-black cursor-pointer flex gap-2 items-center">
                        <input type="checkbox" checked={!off} onClick={(e)=>e.stopPropagation()} onChange={(e)=>setConfig((p)=>({...p,hiddenDepartments:e.target.checked?p.hiddenDepartments.filter((d)=>d!==dep.department):Array.from(new Set([...p.hiddenDepartments,dep.department]))}))}/>
                        {dep.department}<span className="ml-auto text-[10px] text-muted-foreground">{dep.cities.length}</span>
                      </summary>
                      {!off && <div className="grid sm:grid-cols-2 gap-1.5 mt-2">{dep.cities.map((city)=>{
                        const key=locationKey(dep.department,city); const hidden=config.hiddenCities.includes(key);
                        return <label key={key} className="text-xs border rounded-lg p-2 flex gap-2"><input type="checkbox" checked={!hidden} onChange={(e)=>setConfig((p)=>({...p,hiddenCities:e.target.checked?p.hiddenCities.filter((x)=>x!==key):Array.from(new Set([...p.hiddenCities,key]))}))}/>{city}</label>
                      })}</div>}
                    </details>
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[24px] border border-border/70 bg-background p-4 space-y-3">
              <div className="font-black">8. Secciones automáticas</div>
              <div>
                <label className="app-label">Titular grande</label>
                <textarea
                  className="app-input min-h-[70px]"
                  value={config.heroHeadline}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, heroHeadline: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="app-label">Texto</label>
                <textarea
                  className="app-input min-h-[90px]"
                  value={config.heroDescription}
                  onChange={(e) =>
                    setConfig((p) => ({ ...p, heroDescription: e.target.value }))
                  }
                />
              </div>

              <div className="font-bold text-sm pt-2">Secciones visibles</div>
              {Object.entries(config.sections).map(([key, value]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border p-2.5 cursor-pointer"
                >
                  <span className="text-sm capitalize">{key}</span>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        sections: {
                          ...p.sections,
                          [key]: e.target.checked,
                        },
                      }))
                    }
                  />
                </label>
              ))}

              <div className="font-bold text-sm pt-2">Beneficios</div>
              {config.benefits.map((benefit, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    className="app-input"
                    value={benefit}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        benefits: p.benefits.map((x, i) =>
                          i === index ? e.target.value : x,
                        ),
                      }))
                    }
                  />
                  <button
                    className="nav-btn !px-3"
                    onClick={() =>
                      setConfig((p) => ({
                        ...p,
                        benefits: p.benefits.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="nav-btn w-full" onClick={addBenefit}>
                + Agregar beneficio
              </button>

              <div className="font-bold text-sm pt-2">Preguntas frecuentes</div>
              {config.faq.map((item, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-border p-3 space-y-2"
                >
                  <input
                    className="app-input"
                    value={item.question}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        faq: p.faq.map((x, i) =>
                          i === index ? { ...x, question: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <textarea
                    className="app-input min-h-[70px]"
                    value={item.answer}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        faq: p.faq.map((x, i) =>
                          i === index ? { ...x, answer: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <button
                    className="nav-btn !text-xs"
                    onClick={() =>
                      setConfig((p) => ({
                        ...p,
                        faq: p.faq.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Eliminar pregunta
                  </button>
                </div>
              ))}
              <button className="nav-btn w-full" onClick={addFaq}>
                + Agregar pregunta
              </button>
            </div>
          </aside>

          <section className="rounded-[28px] border border-border/70 bg-[#e9e9e9] p-3 sm:p-5 overflow-auto min-h-[800px]">
            <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-background border border-border px-3 py-2">
              <div className="text-xs">
                <b>Vista rápida del editor.</b>{" "}
                <span className="text-muted-foreground">
                  Para probar botones, videos y checkout como un cliente, abrí la Vista previa real.
                </span>
              </div>
              <button
                className="nav-btn !text-xs !py-1.5"
                disabled={saving || uploading}
                onClick={openRealPreview}
              >
                👁 Abrir página completa
              </button>
            </div>
            <div
              className={`mx-auto bg-white shadow-2xl overflow-hidden transition-all ${
                previewMode === "mobile"
                  ? "w-[390px] max-w-full rounded-[28px]"
                  : "w-full rounded-xl"
              }`}
            >
              <ShrinePreview
                config={config}
                product={currentPreviewProduct}
                mobile={previewMode === "mobile"}
              />
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-border/70 bg-gradient-to-br from-background via-secondary/20 to-background p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-black">
            Generador de páginas
          </div>
          <h3 className="text-3xl font-black tracking-tight mt-1">
            🌐 Páginas Web
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Seleccioná productos, subí imágenes/videos, agregá bloques y publicá tu landing.
          </p>
        </div>
        <button className="nav-btn active !px-5 !py-3" onClick={resetEditor}>
          ＋ Crear nueva página
        </button>
      </div>

      {loadingPages ? (
        <div className="rounded-2xl border border-border p-10 text-center">
          Cargando páginas...
        </div>
      ) : pages.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-border p-12 text-center bg-secondary/10">
          <div className="text-5xl">🌐</div>
          <div className="font-black text-xl mt-3">Todavía no creaste páginas</div>
          <div className="text-sm text-muted-foreground mt-1">
            Creá la primera landing seleccionando un producto del catálogo.
          </div>
          <button className="nav-btn active mt-5" onClick={resetEditor}>
            Crear página
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
          {pages.map((page) => {
            const first = page.config?.productSnapshots?.[0];
            const cover =
              first?.media?.find((m) => m.type === "image")?.url ||
              first?.images?.[0];
            return (
              <div
                key={page.id}
                className="rounded-[24px] border border-border bg-background overflow-hidden"
              >
                <div className="h-44 bg-secondary relative overflow-hidden">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-5xl">
                      🌐
                    </div>
                  )}
                  <div
                    className={`absolute top-3 left-3 text-xs font-black px-2.5 py-1 rounded-full ${
                      page.status === "published"
                        ? "bg-emerald-500 text-white"
                        : "bg-amber-400 text-black"
                    }`}
                  >
                    {page.status === "published" ? "● PUBLICADA" : "● BORRADOR"}
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <div className="font-black text-lg">{page.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 break-all">
                      {page.status === "published"
                        ? `${window.location.origin}/#/p/${page.slug}`
                        : `${window.location.origin}/#/preview/${page.id}`}
                    </div>
                    {page.status !== "published" && (
                      <div className="text-[11px] text-amber-500 font-bold mt-1">
                        Borrador: el link público todavía no está habilitado.
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {page.config?.productSnapshots?.length || 0} producto(s) ·{" "}
                    {page.config?.contentBlocks?.length || 0} bloque(s)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="nav-btn" onClick={() => editPage(page)}>
                      ✏️ Editar
                    </button>
                    <button
                      className="nav-btn"
                      onClick={() => openPage(page)}
                    >
                      {page.status === "published"
                        ? "👁 Ver página"
                        : "👁 Vista previa"}
                    </button>
                    <button className="nav-btn" onClick={() => copyLink(page)}>
                      🔗 Copiar link
                    </button>
                    <button
                      className="nav-btn !bg-red-500/10 !text-red-500"
                      onClick={() => deletePage(page)}
                    >
                      🗑 Eliminar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShrinePreview({
  config,
  product,
  mobile,
}: {
  config: LandingConfig;
  product: LandingProductSnapshot | null;
  mobile: boolean;
}) {
  const media = product?.media?.length
    ? product.media
    : (product?.images || []).map((url) => ({
        id: url,
        type: "image" as const,
        url,
      }));

  const firstImage = media.find((m) => m.type === "image")?.url;
  const firstMedia = media[0];

  const blockWidth = (width: "normal" | "wide" | "full") => {
    if (width === "full") return "100%";
    if (width === "wide") return mobile ? "100%" : "940px";
    return mobile ? "100%" : "700px";
  };

  return (
    <div
      style={
        {
          "--primary": config.primaryColor,
          "--accent": config.accentColor,
          "--buy": config.buttonColor,
          color: config.accentColor,
          fontFamily: "Arial, Helvetica, sans-serif",
          background: "#fff",
        } as React.CSSProperties
      }
    >
      <div
        style={{
          background: config.primaryColor,
          color: "white",
          textAlign: "center",
          padding: mobile ? "12px 8px" : "16px 10px",
          fontWeight: 800,
          fontSize: mobile ? 13 : 18,
          letterSpacing: ".3px",
        }}
      >
        {config.announcement}
      </div>

      {!product ? (
        <div style={{ padding: 60, textAlign: "center" }}>
          <div style={{ fontSize: 55 }}>📦</div>
          <b>Seleccioná un producto para ver la vista previa</b>
        </div>
      ) : (
        <>
          <div
            style={{
              maxWidth: 1180,
              margin: mobile ? "18px auto" : "36px auto",
              padding: mobile ? "0 14px" : "0 20px",
              display: "grid",
              gridTemplateColumns: mobile ? "1fr" : "1.08fr .82fr",
              gap: mobile ? 20 : 48,
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  aspectRatio: "1/1",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#f3f3f3",
                }}
              >
                {firstMedia?.type === "video" ? (
                  <video
                    src={firstMedia.url}
                    controls
                    muted
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : firstImage ? (
                  <img
                    src={firstImage}
                    alt={product.title}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 60,
                    }}
                  >
                    📷
                  </div>
                )}
              </div>
              {media.length > 1 && (
                <div style={{ display: "flex", gap: 9, marginTop: 9, overflowX: "auto" }}>
                  {media.slice(0, 7).map((item, i) => (
                    <div
                      key={item.id || i}
                      style={{
                        width: 76,
                        height: 76,
                        borderRadius: 9,
                        overflow: "hidden",
                        border: "1px solid #ddd",
                        flex: "0 0 76px",
                        position: "relative",
                        background: "#111",
                      }}
                    >
                      {item.type === "image" ? (
                        <img
                          src={item.url}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <>
                          <video src={item.url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 25 }}>▶</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h1
                style={{
                  fontSize: mobile ? 30 : 40,
                  lineHeight: 1.05,
                  margin: "4px 0 8px",
                  fontWeight: 900,
                }}
              >
                {product.title.toUpperCase()}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ color: "#ffbf00", fontSize: 22 }}>★★★★★</span>
                <span style={{ fontSize: 17 }}>{config.reviewsText}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "center",
                  flexWrap: "wrap",
                  margin: "15px 0 19px",
                }}
              >
                <strong style={{ color: config.primaryColor, fontSize: 23 }}>
                  Gs. {nf(product.price)}
                </strong>
                {product.compareAtPrice > product.price && (
                  <>
                    <b style={{ textDecoration: "line-through", fontSize: 16 }}>
                      Gs. {nf(product.compareAtPrice)}
                    </b>
                    <span
                      style={{
                        background: config.primaryColor,
                        color: "#fff",
                        borderRadius: 4,
                        padding: "4px 7px",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      SAVE{" "}
                      {Math.max(
                        0,
                        Math.round(
                          (1 - product.price / product.compareAtPrice) * 100,
                        ),
                      )}
                      %
                    </span>
                  </>
                )}
              </div>

              <b style={{ fontSize: 13 }}>Cantidad</b>
              <div
                style={{
                  marginTop: 5,
                  width: 142,
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  height: 48,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  placeItems: "center",
                  background: "#faf8fb",
                }}
              >
                <span>−</span><span>1</span><span>＋</span>
              </div>

              <button
                className={`sky-builder-main-${config.mainButtonEffect}`}
                style={{
                  width: "100%",
                  marginTop: 16,
                  minHeight: 66,
                  borderRadius: config.mainButtonBorderRadius,
                  border: `${config.mainButtonBorderWidth}px solid ${config.mainButtonBorderColor}`,
                  background: config.buttonColor,
                  color: config.mainButtonTextColor,
                  fontSize: config.mainButtonFontSize,
                  fontWeight: 900,
                  boxShadow: "0 4px 10px rgba(0,0,0,.22)",
                  padding: `${config.mainButtonPaddingY}px 18px`,
                  animationDuration: `${config.mainButtonEffectEverySeconds}s`,
                }}
              >
                <div>{config.buttonText}</div>
                <div style={{ fontSize: 11, marginTop: 3 }}>{config.buttonSubtext}</div>
              </button>

              {config.sections.timeline && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 6,
                    textAlign: "center",
                    marginTop: 28,
                  }}
                >
                  {[
                    ["🛒", "Hoy", "Ordenado"],
                    ["🚚", "1 - 2 días", "Orden lista"],
                    ["🎁", "2 - 4 días", "Entregado"],
                  ].map(([icon, date, label]) => (
                    <div key={label}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          background: "#151515",
                          color: "#fff",
                          borderRadius: "50%",
                          display: "grid",
                          placeItems: "center",
                          margin: "auto",
                          fontSize: 21,
                        }}
                      >
                        {icon}
                      </div>
                      <b style={{ display: "block", marginTop: 7 }}>{date}</b>
                      <span style={{ fontSize: 14 }}>{label}</span>
                    </div>
                  ))}
                </div>
              )}

              <h2
                style={{
                  fontWeight: 900,
                  fontSize: mobile ? 31 : 39,
                  lineHeight: 1.18,
                  marginTop: 30,
                  whiteSpace: "pre-line",
                }}
              >
                {config.heroHeadline}
              </h2>
              <p style={{ fontSize: 17, lineHeight: 1.6 }}>
                {config.heroDescription}
              </p>
            </div>
          </div>

          {config.contentBlocks.filter((b) => b.enabled).map((block) => {
            if (block.type === "heading") {
              const sizes = { md: mobile ? 24 : 30, lg: mobile ? 29 : 38, xl: mobile ? 34 : 48 };
              return (
                <div key={block.id} style={{ maxWidth: 940, margin: "22px auto", padding: "0 18px" }}>
                  <h2 style={{ margin: 0, fontSize: sizes[block.size], lineHeight: 1.13, fontWeight: 900, textAlign: block.align, whiteSpace: "pre-line" }}>
                    {block.text}
                  </h2>
                </div>
              );
            }
            if (block.type === "text") {
              return (
                <div key={block.id} style={{ maxWidth: 820, margin: "14px auto", padding: "0 18px", textAlign: block.align }}>
                  <p style={{ fontSize: 17, lineHeight: 1.65, whiteSpace: "pre-line" }}>{block.text}</p>
                </div>
              );
            }
            if (block.type === "image") {
              if (!block.url) return null;

              const width = blockWidth(block.width);
              const margin =
                block.blockAlign === "left"
                  ? `${block.marginTop}px auto ${block.marginBottom}px 14px`
                  : block.blockAlign === "right"
                    ? `${block.marginTop}px 14px ${block.marginBottom}px auto`
                    : `${block.marginTop}px auto ${block.marginBottom}px`;

              const isSide =
                block.textPosition === "left" ||
                block.textPosition === "right";
              const isOverlay =
                block.textPosition.startsWith("overlay");

              const textNode = block.text ? (
                <div
                  style={{
                    textAlign: block.textAlign,
                    fontSize: mobile ? 20 : 26,
                    fontWeight: 900,
                    lineHeight: 1.18,
                    whiteSpace: "pre-line",
                    width: "100%",
                  }}
                >
                  {block.text}
                </div>
              ) : null;

              const imageNode = (
                <div
                  style={{
                    position: "relative",
                    minWidth: 0,
                    width: "100%",
                  }}
                >
                  <img
                    src={block.url}
                    alt={block.alt || ""}
                    style={{
                      display: "block",
                      width: "100%",
                      height: "auto",
                      borderRadius: block.rounded ? 12 : 0,
                      transform: `translate(${block.imageOffsetX}px, ${block.imageOffsetY}px) scale(${block.imageScale / 100})`,
                      transformOrigin: "center center",
                    }}
                  />

                  {isOverlay && textNode && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top:
                          block.textPosition === "overlay-top"
                            ? 0
                            : block.textPosition === "overlay-center"
                              ? "50%"
                              : undefined,
                        bottom:
                          block.textPosition === "overlay-bottom"
                            ? 0
                            : undefined,
                        transform:
                          block.textPosition === "overlay-center"
                            ? "translateY(-50%)"
                            : undefined,
                        padding: mobile ? "12px 14px" : "18px 20px",
                        color: "#fff",
                        background:
                          block.textPosition === "overlay-center"
                            ? "rgba(0,0,0,.45)"
                            : "rgba(0,0,0,.55)",
                      }}
                    >
                      {textNode}
                    </div>
                  )}
                </div>
              );

              if (isSide && !mobile) {
                return (
                  <div
                    key={block.id}
                    style={{
                      width,
                      maxWidth: "100%",
                      margin,
                      padding:
                        block.width === "full" ? 0 : "0 14px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 22,
                      alignItems: "center",
                    }}
                  >
                    {block.textPosition === "left" && textNode}
                    {imageNode}
                    {block.textPosition === "right" && textNode}
                  </div>
                );
              }

              return (
                <div
                  key={block.id}
                  style={{
                    width,
                    maxWidth: "100%",
                    margin,
                    padding:
                      block.width === "full" ? 0 : "0 14px",
                  }}
                >
                  {(block.textPosition === "top" ||
                    (mobile && block.textPosition === "left")) &&
                    textNode}

                  {(block.textPosition === "top" ||
                    (mobile && block.textPosition === "left")) &&
                    textNode && <div style={{ height: 10 }} />}

                  {imageNode}

                  {(block.textPosition === "bottom" ||
                    (mobile && block.textPosition === "right")) &&
                    textNode && <div style={{ height: 10 }} />}

                  {(block.textPosition === "bottom" ||
                    (mobile && block.textPosition === "right")) &&
                    textNode}
                </div>
              );
            }
            if (block.type === "video") {
              if (!block.url) return null;
              return (
                <div key={block.id} style={{ width: blockWidth(block.width), maxWidth: "100%", margin: "12px auto", padding: block.width === "full" ? 0 : "0 14px" }}>
                  <video
                    src={block.url}
                    poster={block.poster}
                    autoPlay={block.autoplay}
                    muted={block.muted}
                    loop={block.loop}
                    controls={block.controls}
                    playsInline
                    style={{ display: "block", width: "100%", height: "auto", borderRadius: block.rounded ? 12 : 0, background: "#000" }}
                  />
                </div>
              );
            }
            if (block.type === "media_gallery") {
              if (!block.items.length) return null;

              const galleryWidth =
                block.width === "full"
                  ? "100%"
                  : block.width === "wide"
                    ? mobile
                      ? "100%"
                      : "1040px"
                    : mobile
                      ? "100%"
                      : "760px";

              const galleryAspect =
                block.aspect === "portrait"
                  ? "9 / 16"
                  : block.aspect === "square"
                    ? "1 / 1"
                    : "auto";

              return (
                <div
                  key={block.id}
                  style={{
                    width: galleryWidth,
                    maxWidth: "100%",
                    margin: "20px auto",
                    padding:
                      block.width === "full" ? 0 : "0 14px",
                    display: "grid",
                    gridTemplateColumns: `repeat(${
                      mobile
                        ? block.mobileColumns
                        : block.columns
                    }, minmax(0, 1fr))`,
                    gap: block.gap,
                  }}
                >
                  {block.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        overflow: "hidden",
                        borderRadius: block.rounded ? 12 : 0,
                        background: "#000",
                        aspectRatio: galleryAspect,
                      }}
                    >
                      {item.type === "image" ? (
                        <img
                          src={item.url}
                          alt={item.alt || ""}
                          style={{
                            width: "100%",
                            height:
                              block.aspect === "auto"
                                ? "auto"
                                : "100%",
                            display: "block",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <video
                          src={item.url}
                          controls={block.controls}
                          autoPlay={block.autoplay}
                          muted={block.muted}
                          loop={block.loop}
                          playsInline
                          style={{
                            width: "100%",
                            height:
                              block.aspect === "auto"
                                ? "auto"
                                : "100%",
                            display: "block",
                            objectFit: "cover",
                            background: "#000",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              );
            }

            if (block.type === "video_row") {
              if (!block.videos.length) return null;

              const width =
                block.width === "full"
                  ? "100%"
                  : block.width === "wide"
                    ? mobile
                      ? "100%"
                      : "1050px"
                    : mobile
                      ? "100%"
                      : "760px";

              const columns = mobile
                ? block.mobileColumns
                : block.desktopColumns;

              const aspect =
                block.aspect === "portrait"
                  ? "9 / 16"
                  : block.aspect === "square"
                    ? "1 / 1"
                    : "auto";

              return (
                <div
                  key={block.id}
                  style={{
                    width,
                    maxWidth: "100%",
                    margin: "22px auto",
                    padding:
                      block.width === "full" ? 0 : "0 14px",
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(
                      columns,
                      Math.max(block.videos.length, 1),
                    )}, minmax(0, 1fr))`,
                    gap: block.gap,
                  }}
                >
                  {block.videos.map((video) => (
                    <div
                      key={video.id}
                      style={{
                        overflow: "hidden",
                        borderRadius: block.rounded ? 12 : 0,
                        background: "#000",
                        aspectRatio: aspect,
                      }}
                    >
                      <video
                        src={video.url}
                        controls={block.controls}
                        autoPlay={block.autoplay}
                        muted={block.muted}
                        loop={block.loop}
                        playsInline
                        style={{
                          width: "100%",
                          height:
                            block.aspect === "auto"
                              ? "auto"
                              : "100%",
                          display: "block",
                          objectFit: "cover",
                        }}
                      />
                    </div>
                  ))}
                </div>
              );
            }

            if (block.type === "buy_button") {
              const btnWidth =
                block.width === "full"
                  ? "100%"
                  : block.width === "wide"
                    ? mobile
                      ? "calc(100% - 28px)"
                      : "760px"
                    : mobile
                      ? "calc(100% - 28px)"
                      : "520px";

              return (
                <div
                  key={block.id}
                  style={{
                    width: btnWidth,
                    maxWidth: "100%",
                    margin:
                      block.align === "center"
                        ? "24px auto"
                        : block.align === "right"
                          ? "24px 14px 24px auto"
                          : "24px auto 24px 14px",
                  }}
                >
                  <button
                    type="button"
                    style={{
                      width: "100%",
                      minHeight: 62,
                      borderRadius: 999,
                      border: "5px solid #000",
                      background: config.buttonColor,
                      color: "#fff",
                      fontWeight: 900,
                      padding: "9px 18px",
                      boxShadow: "0 4px 10px rgba(0,0,0,.2)",
                    }}
                  >
                    <div>{block.text}</div>
                    {block.subtext && (
                      <div style={{ fontSize: 11, marginTop: 3 }}>
                        {block.subtext}
                      </div>
                    )}
                  </button>
                </div>
              );
            }

            if (block.type === "quantity_offers") {
              if (!config.quantityOffers.length) return null;
              return <div key={block.id} style={{maxWidth:block.width==="wide"?760:520,margin:"24px auto",padding:14}}>
                <div style={{fontWeight:950,fontSize:22,textAlign:"center",marginBottom:10}}>{block.title}</div>
                <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":`repeat(${Math.min(config.quantityOffers.length,3)},1fr)`,gap:8}}>
                  {config.quantityOffers.map((o)=><div key={o.id} style={{border:"2px solid #111",borderRadius:14,padding:12}}><b>{o.quantity} unidad(es)</b><div>Gs. {nf(o.priceGs)}</div></div>)}
                </div>
              </div>;
            }

            if (block.type === "custom_html") {
              const width =
                block.width === "full"
                  ? "100%"
                  : block.width === "wide"
                    ? mobile
                      ? "calc(100% - 28px)"
                      : "1040px"
                    : mobile
                      ? "calc(100% - 28px)"
                      : "760px";

              return (
                <div
                  key={block.id}
                  style={{
                    width,
                    maxWidth: "100%",
                    margin: "20px auto",
                    overflow: "hidden",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: sanitizeCustomHtml(block.html),
                  }}
                />
              );
            }

            if (block.type === "image_text") {
              const width =
                block.width === "full"
                  ? "100%"
                  : block.width === "wide"
                    ? mobile
                      ? "calc(100% - 28px)"
                      : "900px"
                    : mobile
                      ? "calc(100% - 28px)"
                      : "620px";

              const margin =
                block.blockAlign === "left"
                  ? `${block.marginTop}px auto ${block.marginBottom}px 14px`
                  : block.blockAlign === "right"
                    ? `${block.marginTop}px 14px ${block.marginBottom}px auto`
                    : `${block.marginTop}px auto ${block.marginBottom}px`;

              const textContent = (
                <div
                  style={{
                    textAlign: block.textAlign,
                    width: "100%",
                  }}
                >
                  {block.title && (
                    <h2
                      style={{
                        fontSize: mobile ? 27 : 36,
                        lineHeight: 1.12,
                        margin: "0 0 10px",
                        fontWeight: 900,
                      }}
                    >
                      {block.title}
                    </h2>
                  )}
                  {block.text && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 17,
                        lineHeight: 1.55,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {block.text}
                    </p>
                  )}
                </div>
              );

              const imageContent = block.imageUrl ? (
                <div style={{ overflow: "visible", width: "100%" }}>
                  <img
                    src={block.imageUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                      borderRadius: 14,
                      transform: `translate(${block.imageOffsetX}px, ${block.imageOffsetY}px) scale(${block.imageScale / 100})`,
                      transformOrigin: "center center",
                    }}
                  />
                </div>
              ) : null;

              if (block.imagePosition === "overlay") {
                return (
                  <div
                    key={block.id}
                    style={{
                      width,
                      maxWidth: "100%",
                      margin,
                      position: "relative",
                      overflow: "hidden",
                      borderRadius: 14,
                    }}
                  >
                    {imageContent}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: mobile ? 18 : 30,
                        color: "#fff",
                        background: "rgba(0,0,0,.4)",
                      }}
                    >
                      {textContent}
                    </div>
                  </div>
                );
              }

              if (
                !mobile &&
                (block.imagePosition === "left" ||
                  block.imagePosition === "right")
              ) {
                return (
                  <div
                    key={block.id}
                    style={{
                      width,
                      maxWidth: "100%",
                      margin,
                      padding:
                        block.width === "full" ? 0 : "0 14px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 24,
                      alignItems: "center",
                    }}
                  >
                    {block.imagePosition === "left" && imageContent}
                    {textContent}
                    {block.imagePosition === "right" && imageContent}
                  </div>
                );
              }

              const textFirst =
                block.imagePosition === "top" ||
                (mobile && block.imagePosition === "right");

              return (
                <div
                  key={block.id}
                  style={{
                    width,
                    maxWidth: "100%",
                    margin,
                    padding:
                      block.width === "full" ? 0 : "0 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {textFirst && textContent}
                  {imageContent}
                  {!textFirst && textContent}
                </div>
              );
            }
            return <div key={block.id} style={{ height: block.height }} />;
          })}

          {config.sections.description && (
            <div
              style={{
                maxWidth: 930,
                margin: "30px auto",
                padding: mobile ? "0 18px" : "0 20px",
                textAlign: "center",
              }}
            >
              <h2 style={{ fontSize: mobile ? 27 : 38, fontWeight: 900 }}>
                Conocé todo lo que puede hacer por vos
              </h2>
              <p style={{ fontSize: 17, lineHeight: 1.7 }}>
                {product.description || config.heroDescription}
              </p>
            </div>
          )}

          {config.sections.benefits && (
            <div style={{ background: "#f7f7f7", padding: mobile ? "30px 18px" : "48px 20px" }}>
              <div
                style={{
                  maxWidth: 980,
                  margin: "auto",
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr" : "repeat(2,1fr)",
                  gap: 14,
                }}
              >
                {config.benefits.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #e1e1e1",
                      borderRadius: 15,
                      background: "#fff",
                      padding: 20,
                      fontWeight: 800,
                      fontSize: 18,
                    }}
                  >
                    ✅ {b}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
