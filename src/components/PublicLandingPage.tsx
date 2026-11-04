import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PARAGUAY_LOCATIONS, locationKey } from "@/lib/paraguayLocations";
import type {
  LandingConfig,
  LandingContentBlock,
  LandingMediaItem,
} from "@/components/WebPageBuilder";

const nf = (n: number) =>
  new Intl.NumberFormat("es-PY").format(Math.round(Number(n || 0)));


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

type PublicLandingRow = {
  id: string;
  owner_email: string;
  name: string;
  slug: string;
  status: "draft" | "published";
  config: LandingConfig;
};

const legacyMedia = (product: any): LandingMediaItem[] =>
  Array.isArray(product?.media) && product.media.length
    ? product.media
    : (product?.images || []).map((url: string, i: number) => ({
        id: `legacy-${i}-${url}`,
        type: "image" as const,
        url,
        alt: product?.title || "",
      }));

const normalizePublicConfig = (raw: any): LandingConfig => {
  const blocks = Array.isArray(raw?.contentBlocks)
    ? raw.contentBlocks.map((block: any) => {
        if (!block?.id || !block?.type) return null;

        if (block.type === "video_row") {
          return {
            ...block,
            videos: Array.isArray(block.videos)
              ? block.videos.filter((video: any) => video?.type === "video" && typeof video?.url === "string" && video.url.trim()).slice(0, 3)
              : [],
            desktopColumns: [1,2,3].includes(Number(block.desktopColumns)) ? Number(block.desktopColumns) : 3,
            mobileColumns: [1,2,3].includes(Number(block.mobileColumns)) ? Number(block.mobileColumns) : 1,
            gap: Number.isFinite(Number(block.gap)) ? Number(block.gap) : 12,
            width: ["normal","wide","full"].includes(block.width) ? block.width : "wide",
            aspect: ["portrait","square","auto"].includes(block.aspect) ? block.aspect : "portrait",
            rounded: block.rounded !== false,
            controls: block.controls !== false,
            autoplay: Boolean(block.autoplay),
            muted: block.muted !== false,
            loop: Boolean(block.loop),
          };
        }

        if (block.type === "buy_button") {
          return {
            ...block,
            backgroundColor: block.backgroundColor || raw?.buttonColor || "#ff1717",
            textColor: block.textColor || "#ffffff",
            borderColor: block.borderColor || "#000000",
            borderWidth: Number.isFinite(Number(block.borderWidth)) ? Number(block.borderWidth) : 4,
            borderRadius: Number.isFinite(Number(block.borderRadius)) ? Number(block.borderRadius) : 999,
            fontSize: Number.isFinite(Number(block.fontSize)) ? Number(block.fontSize) : 18,
            paddingY: Number.isFinite(Number(block.paddingY)) ? Number(block.paddingY) : 12,
            effect: ["none","shake","pulse","bounce","shine"].includes(block.effect) ? block.effect : "none",
            effectEverySeconds: Number.isFinite(Number(block.effectEverySeconds)) ? Math.max(2, Number(block.effectEverySeconds)) : 5,
          };
        }

        if (block.type === "quantity_offers") {
          return {
            ...block,
            title: block.title || "🔥 OFERTAS ESPECIALES",
            width: ["normal","wide","full"].includes(block.width) ? block.width : "wide",
            align: ["left","center","right"].includes(block.align) ? block.align : "center",
          };
        }

        if (block.type === "media_gallery") {
          return {
            ...block,
            items: Array.isArray(block.items)
              ? block.items.filter((item: any) => ["image","video"].includes(item?.type) && typeof item?.url === "string" && item.url.trim())
              : [],
          };
        }

        if (block.type === "custom_html") {
          return {
            ...block,
            html: typeof block.html === "string" ? block.html : "",
            width: ["normal", "wide", "full"].includes(block.width)
              ? block.width
              : "wide",
          };
        }

        if (block.type === "image" || block.type === "image_text") {
          return {
            ...block,
            imageScale: Number.isFinite(Number(block.imageScale)) ? Math.min(200, Math.max(50, Number(block.imageScale))) : 100,
            imageOffsetX: Number.isFinite(Number(block.imageOffsetX)) ? Math.min(200, Math.max(-200, Number(block.imageOffsetX))) : 0,
            imageOffsetY: Number.isFinite(Number(block.imageOffsetY)) ? Math.min(200, Math.max(-200, Number(block.imageOffsetY))) : 0,
          };
        }

        return block;
      }).filter(Boolean)
    : [];

  return {
    ...raw,
    mainButtonTextColor: raw?.mainButtonTextColor || "#ffffff",
    mainButtonBorderColor: raw?.mainButtonBorderColor || "#000000",
    mainButtonBorderWidth: Number.isFinite(Number(raw?.mainButtonBorderWidth))
      ? Number(raw.mainButtonBorderWidth)
      : 5,
    mainButtonBorderRadius: Number.isFinite(Number(raw?.mainButtonBorderRadius))
      ? Number(raw.mainButtonBorderRadius)
      : 40,
    mainButtonFontSize: Number.isFinite(Number(raw?.mainButtonFontSize))
      ? Number(raw.mainButtonFontSize)
      : 14,
    mainButtonPaddingY: Number.isFinite(Number(raw?.mainButtonPaddingY))
      ? Number(raw.mainButtonPaddingY)
      : 10,
    mainButtonEffect: ["none","shake","pulse","bounce","shine"].includes(
      raw?.mainButtonEffect,
    )
      ? raw.mainButtonEffect
      : "shake",
    mainButtonEffectEverySeconds: Number.isFinite(
      Number(raw?.mainButtonEffectEverySeconds),
    )
      ? Math.max(2, Number(raw.mainButtonEffectEverySeconds))
      : 5,
    quantityOffers: Array.isArray(raw?.quantityOffers)
      ? raw.quantityOffers.map((offer: any) => ({
          ...offer,
          compareAtPriceGs: Number(
            offer.compareAtPriceGs || offer.compareAtPrice || 0,
          ),
          title: offer.title || offer.label || "",
          description: offer.description || "",
          imageUrl: offer.imageUrl || "",
          highlight: Boolean(offer.highlight),
        }))
      : [],
    checkoutSections: Array.isArray(raw?.checkoutSections)
      ? raw.checkoutSections
      : [],
    coverageMode: ["all","custom","platform"].includes(raw?.coverageMode)
      ? raw.coverageMode
      : "all",
    hiddenDepartments: Array.isArray(raw?.hiddenDepartments)
      ? raw.hiddenDepartments
      : [],
    hiddenCities: Array.isArray(raw?.hiddenCities)
      ? raw.hiddenCities
      : [],
    contentBlocks: blocks,
  } as LandingConfig;
};


const getStoreSessionId = () => {
  const key = "sky_store_session_id";
  let value = localStorage.getItem(key);

  if (!value) {
    value =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(key, value);
  }

  return value;
};

const initMetaPixel = (pixelId: string) => {
  if (!pixelId || typeof window === "undefined") return false;

  const w = window as any;

  // Si ya existe un script de Meta cargándose/cargado, no agregamos otro.
  const existingScript = document.querySelector(
    'script[src*="connect.facebook.net"][src*="fbevents.js"]',
  );

  if (!w.fbq) {
    const fbq: any = function (...args: any[]) {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, args);
      } else {
        fbq.queue.push(args);
      }
    };

    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    w.fbq = fbq;

    if (!existingScript) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.dataset.skyMetaPixel = "true";
      document.head.appendChild(script);
    }
  }

  // IMPORTANTE:
  // No usamos sessionStorage. sessionStorage sobrevive a un reload,
  // pero window.fbq NO. Eso podía dejar el Pixel sin "init" al recargar.
  if (!w.__skyInitializedMetaPixels) {
    w.__skyInitializedMetaPixels = new Set<string>();
  }

  if (!w.__skyInitializedMetaPixels.has(pixelId)) {
    w.fbq("init", pixelId);
    w.__skyInitializedMetaPixels.add(pixelId);

    console.info(`[META] Pixel inicializado: ${pixelId}`);
  }

  return true;
};

const trackMeta = (
  pixelId: string,
  eventName: string,
  payload?: Record<string, unknown>,
  eventId?: string,
) => {
  if (!pixelId || typeof window === "undefined") return;

  const fbq = (window as any).fbq;

  if (!fbq) {
    console.warn(`[META] fbq no disponible para ${eventName}`);
    return;
  }

  // trackSingle evita que, si existen otros Pixels en el dominio,
  // este evento se mande accidentalmente a todos ellos.
  if (eventId) {
    fbq(
      "trackSingle",
      pixelId,
      eventName,
      payload || {},
      { eventID: eventId },
    );
  } else {
    fbq("trackSingle", pixelId, eventName, payload || {});
  }

  console.info(
    `[META] ${eventName} enviado al Pixel ${pixelId}`,
    eventId ? { eventId } : "",
  );
};

const getBrowserCookie = (name: string) => {
  if (typeof document === "undefined") return "";

  const prefix = `${name}=`;

  const match = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));

  if (!match) return "";

  return decodeURIComponent(match.slice(prefix.length));
};


export default function PublicLandingPage({
  slug,
  pageId,
  preview = false,
}: {
  slug?: string;
  pageId?: string;
  preview?: boolean;
}) {
  const [page, setPage] = useState<PublicLandingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProductId, setActiveProductId] = useState("");
  const [mediaIndex, setMediaIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [metaPixelId, setMetaPixelId] = useState("");
  const [platformCoverage, setPlatformCoverage] = useState<string[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    department: "",
    city: "",
    address: "",
    reference: "",
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      let query = supabase
        .from("landing_pages")
        .select("id,owner_email,name,slug,status,config");

      if (preview && pageId) {
        // Vista previa: el usuario autenticado puede leer su propio borrador
        // gracias a la política owner_select.
        query = query.eq("id", pageId);
      } else if (slug) {
        // Página pública normal: solo publicadas.
        query = query.eq("slug", slug).eq("status", "published");
      } else {
        setLoading(false);
        setPage(null);
        return;
      }

      const { data, error } = await query.maybeSingle();

      if (!mounted) return;
      setLoading(false);
      if (error) {
        console.error(error);
        setPage(null);
        return;
      }

      const rawRow = data as PublicLandingRow | null;
      const row = rawRow
        ? { ...rawRow, config: normalizePublicConfig(rawRow.config) }
        : null;
      setPage(row);
      const firstId = row?.config?.productSnapshots?.[0]?.id || "";
      setActiveProductId(firstId);
    })();

    return () => {
      mounted = false;
    };
  }, [slug, pageId, preview]);

  useEffect(() => {
    if (!page || preview) return;

    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.rpc(
        "get_public_store_pixel",
        {
          p_landing_page_id: page.id,
        },
      );

      if (cancelled || error) {
        if (error) console.error("Error cargando Pixel:", error);
        return;
      }

      const pixelId =
        typeof data === "string"
          ? data
          : Array.isArray(data)
            ? data[0]?.meta_pixel_id || data[0] || ""
            : data?.meta_pixel_id || "";

      if (!pixelId) return;

      const resolvedPixelId = String(pixelId);

      setMetaPixelId(resolvedPixelId);

      const initialized = initMetaPixel(resolvedPixelId);

      if (initialized) {
        trackMeta(resolvedPixelId, "PageView");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page?.id, preview]);

  const trackStoreEvent = async (
    eventType: string,
    extra?: {
      productId?: string;
      valueGs?: number;
      department?: string;
      city?: string;
      metadata?: Record<string, unknown>;
    },
  ) => {
    if (!page || preview) return;

    try {
      await supabase.from("landing_page_events").insert({
        landing_page_id: page.id,
        session_id: getStoreSessionId(),
        event_type: eventType,
        product_id: extra?.productId || null,
        value_gs: Number(extra?.valueGs || 0) || null,
        department: extra?.department || null,
        city: extra?.city || null,
        metadata: {
          slug: page.slug,
          page_name: page.name,
          ...(extra?.metadata || {}),
        },
      });
    } catch (error) {
      console.error("Error tracking store event:", error);
    }
  };

  useEffect(() => {
    if (!page || preview) return;

    trackStoreEvent("page_view");
  }, [page?.id, preview]);

  const config = page?.config;

  useEffect(() => {
    if (!config || config.coverageMode !== "platform") {
      setPlatformCoverage([]);
      return;
    }
    (async () => {
      // La cobertura de la plataforma se define en client_prices.
      // La antigua tabla platform_delivery_coverage no existe en este proyecto.
      const { data, error } = await supabase
        .from("client_prices")
        .select("departamento,city");
      if (error) {
        console.error("Error cobertura plataforma:", error);
        return;
      }
      const normalizePlace = (value: unknown) => String(value ?? "")
        .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const covered = new Set<string>();
      for (const dep of PARAGUAY_LOCATIONS) {
        for (const city of dep.cities) {
          const cityName = normalizePlace(city);
          const departmentName = normalizePlace(dep.department);
          if ((data || []).some((row: any) => {
            if (normalizePlace(row.city) !== cityName) return false;
            // Asunción es Distrito Capital; en client_prices figura como Central.
            if (cityName === "asuncion") return true;
            return normalizePlace(row.departamento) === departmentName;
          })) {
            covered.add(locationKey(dep.department, city));
          }
        }
      }
      setPlatformCoverage([...covered]);
    })();
  }, [config?.coverageMode]);
  const products = config?.productSnapshots || [];
  const product =
    products.find((p) => p.id === activeProductId) || products[0] || null;
  const media = legacyMedia(product);
  const activeMedia = media[mediaIndex] || media[0];
  const firstImage = media.find((m) => m.type === "image")?.url || "";

  const availableLocations = useMemo(() => {
    if (!config) return PARAGUAY_LOCATIONS;
    if (config.coverageMode === "platform") {
      return PARAGUAY_LOCATIONS.map((dep) => ({
        ...dep,
        cities: dep.cities.filter((city) => platformCoverage.includes(locationKey(dep.department, city))),
      })).filter((dep) => dep.cities.length > 0);
    }
    if (config.coverageMode === "custom") {
      return PARAGUAY_LOCATIONS
        .filter((dep) => !config.hiddenDepartments?.includes(dep.department))
        .map((dep) => ({
          ...dep,
          cities: dep.cities.filter((city) => !config.hiddenCities?.includes(locationKey(dep.department, city))),
        }))
        .filter((dep) => dep.cities.length > 0);
    }
    return PARAGUAY_LOCATIONS;
  }, [config?.coverageMode, JSON.stringify(config?.hiddenDepartments || []), JSON.stringify(config?.hiddenCities || []), platformCoverage.join("|")]);

  const availableCities =
    availableLocations.find((dep) => dep.department === form.department)?.cities || [];

  useEffect(() => {
    if (!page || !product || preview) return;

    trackStoreEvent("view_content", {
      productId: product.id,
      valueGs: Number(product.price || 0),
      metadata: {
        product_title: product.title,
      },
    });

    if (metaPixelId) {
      trackMeta(metaPixelId, "ViewContent", {
        content_ids: [product.id],
        content_name: product.title,
        content_type: "product",
        currency: "PYG",
        value: Number(product.price || 0),
      });
    }
  }, [page?.id, product?.id, preview, metaPixelId]);

  useEffect(() => {
    setMediaIndex(0);
    setQuantity(1);
  }, [activeProductId]);

  useEffect(() => {
    if (!checkoutOpen) return;

    if (!preview && page && product) {
      trackStoreEvent("checkout_open", {
        productId: product.id,
        valueGs: total,
        department: form.department || undefined,
        city: form.city || undefined,
        metadata: {
          quantity,
          product_title: product.title,
        },
      });

      if (metaPixelId) {
        trackMeta(metaPixelId, "InitiateCheckout", {
          content_ids: [product.id],
          content_name: product.title,
          content_type: "product",
          currency: "PYG",
          value: total,
          num_items: quantity,
        });
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCheckoutOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [checkoutOpen]);

  const selectedOffer = config?.quantityOffers?.find((offer: any) => offer.id === selectedOfferId);
  const total = useMemo(
    () => selectedOffer ? Number(selectedOffer.priceGs || 0) : Number(product?.price || 0) * quantity,
    [product?.price, quantity, selectedOfferId, selectedOffer?.priceGs],
  );

  useEffect(() => {
    if (!checkoutOpen) return;
    if (selectedOfferId) return;
    if (!config?.quantityOffers?.length) return;

    const first =
      config.quantityOffers.find((offer: any) => offer.highlight) ||
      config.quantityOffers[0];

    if (!first) return;

    setSelectedOfferId(first.id);
    setQuantity(Math.max(1, Number(first.quantity || 1)));
  }, [checkoutOpen, selectedOfferId, config?.quantityOffers]);

  const chooseOffer = (offer: any, open = true) => {
    setSelectedOfferId(offer.id);
    setQuantity(Math.max(1, Number(offer.quantity || 1)));
    if (open) setCheckoutOpen(true);
  };

  const submitOrder = async () => {
    if (!page || !product) return;
    if (!form.full_name.trim() || !form.phone.trim() || !form.department.trim() || !form.city.trim()) {
      alert("Completá nombre, teléfono y ciudad.");
      return;
    }

    if (preview) {
      alert(
        "✅ PRUEBA CORRECTA\n\nEl checkout funciona. Como estás en VISTA PREVIA, este pedido NO fue guardado.",
      );
      return;
    }

    setSending(true);

    const orderId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { error } = await supabase
      .from("landing_page_orders")
      .insert({
        id: orderId,
        landing_page_id: page.id,
        product_id: product.id,
        product_title: product.title,
        quantity,
        unit_price_gs: product.price,
        total_gs: total,
        customer_name: form.full_name.trim(),
        phone: form.phone.trim(),
        department: form.department.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        reference: form.reference.trim(),
        source: "landing_page",
        status: "nuevo",
        raw_payload: {
          slug: page.slug,
          sku: product.sku,
          quantity_offer_id: selectedOffer?.id || null,
          quantity_offer_label: selectedOffer?.label || null,
        },
      });

    setSending(false);

    if (error) {
      console.error("Error creando landing_page_order:", error);

      const details = [
        error.message,
        error.details,
        error.hint,
        error.code ? `Código: ${error.code}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      alert(
        `No se pudo registrar el pedido.\n\n${details || "Error desconocido de Supabase."}`,
      );
      return;
    }

    const metaEventId = `landing-order-${orderId}`;

    try {
      const { data: capiResult, error: capiError } = await (
        supabase as any
      ).rpc("send_meta_purchase", {
        p_order_id: orderId,
        p_event_source_url: window.location.href,
        p_fbp: getBrowserCookie("_fbp") || null,
        p_fbc: getBrowserCookie("_fbc") || null,
      });

      if (capiError) {
        console.error("Meta CAPI SQL error:", capiError);
      } else if (capiResult?.ok === false) {
        console.error("Meta CAPI rechazó Purchase:", capiResult);
      } else {
        console.info("✅ Meta CAPI Purchase enviado:", capiResult);
      }
    } catch (capiUnexpectedError) {
      console.error(
        "Meta CAPI SQL unexpected error:",
        capiUnexpectedError,
      );
    }

    await trackStoreEvent("purchase", {
      productId: product.id,
      valueGs: total,
      department: form.department.trim(),
      city: form.city.trim(),
      metadata: {
        order_id: orderId,
        event_id: metaEventId,
        quantity,
        product_title: product.title,
      },
    });

    if (metaPixelId) {
      trackMeta(
        metaPixelId,
        "Purchase",
        {
          content_ids: [product.id],
          content_name: product.title,
          content_type: "product",
          currency: "PYG",
          value: total,
          num_items: quantity,
        },
        metaEventId,
      );
    }

    setCheckoutOpen(false);
    alert("✅ Pedido recibido correctamente. Nos comunicaremos contigo.");
    setForm({
      full_name: "",
      phone: "",
      department: "",
      city: "",
      address: "",
      reference: "",
    });
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        Cargando...
      </div>
    );
  }

  if (!page || !config || !product) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "Arial, sans-serif",
          textAlign: "center",
          padding: 30,
        }}
      >
        <div>
          <div style={{ fontSize: 55 }}>🌐</div>
          <h1>Página no disponible</h1>
          <p>El enlace no existe o la página todavía no fue publicada.</p>
        </div>
      </div>
    );
  }

  const discount =
    product.compareAtPrice > product.price
      ? Math.round((1 - product.price / product.compareAtPrice) * 100)
      : 0;

  const blocks = (config.contentBlocks || []).filter((b) => b.enabled);

  const blockMaxWidth = (width: "normal" | "wide" | "full") => {
    if (width === "full") return "100%";
    if (width === "wide") return "1040px";
    return "760px";
  };

  const renderCheckoutSections = (placement: string) =>
    (config?.checkoutSections || [])
      .filter((section: any) => section.placement === placement)
      .map((section: any) => (
        <div
          key={section.id}
          className="sky-checkout-custom"
          style={{
            background: section.backgroundColor || "#fff8e8",
            color: section.textColor || "#111",
            borderColor: section.borderColor || "#e5c76b",
          }}
        >
          <div className="sky-checkout-custom-title">
            <span>{section.icon || "⭐"}</span>
            <b>{section.title}</b>
          </div>
          {section.text && (
            <div className="sky-checkout-custom-text">{section.text}</div>
          )}
        </div>
      ));

  const renderBlock = (block: LandingContentBlock) => {
    if (block.type === "heading") {
      const sizes = { md: "32px", lg: "42px", xl: "52px" };
      return (
        <section
          key={block.id}
          className="sky-free-block"
          style={{ maxWidth: 980, textAlign: block.align }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: sizes[block.size],
              lineHeight: 1.1,
              fontWeight: 900,
              whiteSpace: "pre-line",
            }}
          >
            {block.text}
          </h2>
        </section>
      );
    }

    if (block.type === "text") {
      return (
        <section
          key={block.id}
          className="sky-free-block"
          style={{ maxWidth: 820, textAlign: block.align }}
        >
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.7, whiteSpace: "pre-line" }}>
            {block.text}
          </p>
        </section>
      );
    }

    if (block.type === "image") {
      if (!block.url) return null;
      const width = blockMaxWidth(block.width);
      const margin = block.blockAlign === "left"
        ? `${block.marginTop}px auto ${block.marginBottom}px 14px`
        : block.blockAlign === "right"
          ? `${block.marginTop}px 14px ${block.marginBottom}px auto`
          : `${block.marginTop}px auto ${block.marginBottom}px`;
      const overlay = block.textPosition.startsWith("overlay");
      const side = block.textPosition === "left" || block.textPosition === "right";
      const textNode = block.text ? (
        <div style={{ textAlign: block.textAlign, fontSize: 22, fontWeight: 900, lineHeight: 1.2, whiteSpace: "pre-line" }}>
          {block.text}
        </div>
      ) : null;
      const imageNode = (
        <div style={{ position: "relative", minWidth: 0 }}>
          <img
            src={block.url}
            alt={block.alt || ""}
            loading="lazy"
            style={{
              width: "100%",
              display: "block",
              borderRadius: block.rounded ? 14 : 0,
              transform: `translate(${block.imageOffsetX}px, ${block.imageOffsetY}px) scale(${block.imageScale / 100})`,
              transformOrigin: "center center",
            }}
          />
          {overlay && textNode && (
            <div style={{ position: "absolute", left: 0, right: 0, top: block.textPosition === "overlay-top" ? 0 : block.textPosition === "overlay-center" ? "50%" : undefined, bottom: block.textPosition === "overlay-bottom" ? 0 : undefined, transform: block.textPosition === "overlay-center" ? "translateY(-50%)" : undefined, color: "#fff", padding: "18px 20px", background: block.textPosition === "overlay-center" ? "rgba(0,0,0,.42)" : "rgba(0,0,0,.52)" }}>
              {textNode}
            </div>
          )}
        </div>
      );
      if (side) {
        return (
          <section key={block.id} className="sky-free-image-block side" style={{ maxWidth: width, width: block.width === "full" ? "100%" : "calc(100% - 28px)", margin, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22, alignItems: "center" }}>
            {block.textPosition === "left" && textNode}
            {imageNode}
            {block.textPosition === "right" && textNode}
          </section>
        );
      }
      return (
        <section key={block.id} className="sky-free-image-block" style={{ maxWidth: width, width: block.width === "full" ? "100%" : "calc(100% - 28px)", margin }}>
          {block.textPosition === "top" && textNode}
          {block.textPosition === "top" && textNode && <div style={{height:10}} />}
          {imageNode}
          {block.textPosition === "bottom" && textNode && <div style={{height:10}} />}
          {block.textPosition === "bottom" && textNode}
        </section>
      );
    }

    if (block.type === "video") {
      if (!block.url) return null;
      return (
        <section
          key={block.id}
          className={`sky-media-block ${block.width === "full" ? "full" : ""}`}
          style={{ maxWidth: blockMaxWidth(block.width) }}
        >
          <video
            src={block.url}
            poster={block.poster}
            autoPlay={block.autoplay}
            muted={block.muted}
            loop={block.loop}
            controls={block.controls}
            playsInline
            style={{
              width: "100%",
              display: "block",
              height: "auto",
              borderRadius: block.rounded ? 12 : 0,
              background: "#000",
            }}
          />
        </section>
      );
    }

    if (block.type === "media_gallery") {
      if (!block.items.length) return null;

      const galleryWidth = blockMaxWidth(block.width);

      return (
        <section
          key={block.id}
          className="sky-custom-gallery"
          style={
            {
              maxWidth: galleryWidth,
              width: block.width === "full" ? "100%" : "calc(100% - 28px)",
              padding: block.width === "full" ? 0 : undefined,
              "--gallery-cols": block.columns,
              "--gallery-mobile-cols": block.mobileColumns,
              "--gallery-gap": `${block.gap}px`,
            } as React.CSSProperties
          }
        >
          {block.items.map((item) => (
            <div
              key={item.id}
              className={`sky-custom-gallery-item ${
                block.aspect === "portrait"
                  ? "portrait"
                  : block.aspect === "square"
                    ? "square"
                    : ""
              }`}
              style={{
                borderRadius: block.rounded ? 12 : 0,
              }}
            >
              {item.type === "image" ? (
                <img
                  src={item.url}
                  alt={item.alt || ""}
                  loading="lazy"
                />
              ) : (
                <video
                  src={item.url}
                  controls={block.controls || !block.autoplay}
                  autoPlay={block.autoplay}
                  muted={block.autoplay ? true : block.muted}
                  loop={block.loop}
                  playsInline
                  preload="metadata"
                  onError={(event) => {
                    console.error("No se pudo cargar video de galería:", item.url, event.currentTarget.error);
                  }}
                />
              )}
            </div>
          ))}
        </section>
      );
    }

    if (block.type === "video_row") {
      if (!block.videos.length) return null;

      const width = blockMaxWidth(block.width);

      return (
        <section
          key={block.id}
          className="sky-video-row"
          style={
            {
              maxWidth: width,
              width:
                block.width === "full"
                  ? "100%"
                  : "calc(100% - 28px)",
              margin: "22px auto",
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(
                block.desktopColumns,
                Math.max(block.videos.length, 1),
              )}, minmax(0, 1fr))`,
              gap: `${block.gap}px`,
              "--video-row-mobile-cols": Math.min(
                block.mobileColumns,
                Math.max(block.videos.length, 1),
              ),
            } as React.CSSProperties
          }
        >
          {block.videos.map((video) => (
            <div
              key={video.id}
              className={`sky-video-row-item ${
                block.aspect === "portrait"
                  ? "portrait"
                  : block.aspect === "square"
                    ? "square"
                    : ""
              }`}
              style={{
                borderRadius: block.rounded ? 12 : 0,
              }}
            >
              <video
                src={video.url}
                controls={block.controls || !block.autoplay}
                autoPlay={block.autoplay}
                muted={block.autoplay ? true : block.muted}
                loop={block.loop}
                playsInline
                preload="metadata"
                onError={(event) => {
                  console.error("No se pudo cargar video publicado:", video.url, event.currentTarget.error);
                }}
              />
            </div>
          ))}
        </section>
      );
    }

    if (block.type === "buy_button") {
      const maxWidth =
        block.width === "full"
          ? "100%"
          : block.width === "wide"
            ? "820px"
            : "560px";

      const margin =
        block.align === "center"
          ? "24px auto"
          : block.align === "right"
            ? "24px 14px 24px auto"
            : "24px auto 24px 14px";

      return (
        <section
          key={block.id}
          className="sky-block-buy-wrap"
          style={{
            maxWidth,
            margin,
            padding: block.width === "full" ? 0 : undefined,
          }}
        >
          <button
            type="button"
            className={`sky-block-buy sky-buy-effect-${block.effect}`}
            style={{
              background: block.backgroundColor,
              color: block.textColor,
              borderColor: block.borderColor,
              borderWidth: block.borderWidth,
              borderStyle: "solid",
              borderRadius: block.borderRadius,
              fontSize: block.fontSize,
              paddingTop: block.paddingY,
              paddingBottom: block.paddingY,
              ["--sky-effect-duration" as any]: `${Math.max(2, block.effectEverySeconds || 5)}s`,
            }}
            onClick={() => setCheckoutOpen(true)}
          >
            <div className="sky-buy-main">
              {block.text || config.buttonText}
            </div>
            {(block.subtext || config.buttonSubtext) && (
              <div className="sky-buy-sub">
                {block.subtext || config.buttonSubtext}
              </div>
            )}
          </button>
        </section>
      );
    }

    if (block.type === "quantity_offers") {
      if (!config.quantityOffers?.length) return null;

      return (
        <section
          key={block.id}
          style={{
            width: "calc(100% - 28px)",
            maxWidth:
              block.width === "full"
                ? "100%"
                : block.width === "wide"
                  ? 760
                  : 560,
            margin:
              block.align === "right"
                ? "22px 14px 22px auto"
                : block.align === "left"
                  ? "22px auto 22px 14px"
                  : "22px auto",
          }}
        >
          <div
            style={{
              textAlign: "center",
              fontSize: 22,
              lineHeight: 1.2,
              fontWeight: 950,
              marginBottom: 10,
            }}
          >
            {block.title}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {config.quantityOffers.map((offer: any) => {
              const compare =
                Number(offer.compareAtPriceGs || 0) >
                Number(offer.priceGs || 0);

              return (
                <button
                  type="button"
                  key={offer.id}
                  onClick={() => chooseOffer(offer, true)}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: offer.imageUrl
                      ? "62px minmax(0,1fr) auto"
                      : "minmax(0,1fr) auto",
                    gap: 10,
                    alignItems: "center",
                    background: offer.highlight ? "#e8f4fd" : "#fff",
                    border: offer.highlight
                      ? "2px solid #0b82db"
                      : "1px solid #d2d2d2",
                    borderRadius: 8,
                    padding: 9,
                    color: "#111",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {offer.imageUrl && (
                    <img
                      src={offer.imageUrl}
                      alt=""
                      style={{
                        width: 62,
                        height: 56,
                        minWidth: 62,
                        maxWidth: 62,
                        maxHeight: 56,
                        objectFit: "cover",
                        borderRadius: 5,
                        margin: 0,
                      }}
                    />
                  )}

                  <span
                    style={{
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                    }}
                  >
                    <strong style={{ fontSize: 12, lineHeight: 1.15 }}>
                      {offer.title ||
                        `${offer.quantity} unidad(es)`}
                    </strong>

                    {offer.description && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          lineHeight: 1.2,
                          marginTop: 3,
                        }}
                      >
                        {offer.description}
                      </span>
                    )}

                    {offer.badge && (
                      <span
                        style={{
                          marginTop: 5,
                          background: "#1479f5",
                          color: "#fff",
                          borderRadius: 2,
                          padding: "3px 6px",
                          fontSize: 8,
                          fontWeight: 950,
                        }}
                      >
                        {offer.badge}
                      </span>
                    )}
                  </span>

                  <span
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {compare && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 9,
                          color: "#666",
                          textDecoration: "line-through",
                        }}
                      >
                        Gs. {nf(offer.compareAtPriceGs)}
                      </span>
                    )}

                    <strong style={{ fontSize: 12 }}>
                      Gs. {nf(offer.priceGs)}
                    </strong>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      );
    }

    if (block.type === "custom_html") {
      const width = blockMaxWidth(block.width);

      if (!block.html?.trim()) return null;

      return (
        <section
          key={block.id}
          className="sky-free-block sky-custom-html"
          style={{
            width: "100%",
            maxWidth: width,
            margin: "20px auto",
            padding: 0,
            overflow: "hidden",
          }}
          dangerouslySetInnerHTML={{
            __html: sanitizeCustomHtml(block.html),
          }}
        />
      );
    }

    if (block.type === "image_text") {
      const width = blockMaxWidth(block.width);
      const margin = block.blockAlign === "left"
        ? `${block.marginTop}px auto ${block.marginBottom}px 14px`
        : block.blockAlign === "right"
          ? `${block.marginTop}px 14px ${block.marginBottom}px auto`
          : `${block.marginTop}px auto ${block.marginBottom}px`;
      const textContent = (
        <div style={{ textAlign: block.textAlign, position: "relative", zIndex: 2 }}>
          {block.title && <h2>{block.title}</h2>}
          {block.text && <p>{block.text}</p>}
        </div>
      );
      const imageContent = block.imageUrl ? (
        <div style={{ overflow: "visible", width: "100%" }}>
          <img
            src={block.imageUrl}
            alt=""
            loading="lazy"
            style={{
              width: "100%",
              display: "block",
              transform: `translate(${block.imageOffsetX}px, ${block.imageOffsetY}px) scale(${block.imageScale / 100})`,
              transformOrigin: "center center",
            }}
          />
        </div>
      ) : null;
      if (block.imagePosition === "overlay") {
        return (
          <section key={block.id} className="sky-image-text" style={{ maxWidth: width, width: block.width === "full" ? "100%" : "calc(100% - 28px)", margin, position: "relative", display: "block", overflow: "hidden" }}>
            {imageContent}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, color: "#fff", background: "rgba(0,0,0,.38)" }}>{textContent}</div>
          </section>
        );
      }
      if (block.imagePosition === "left" || block.imagePosition === "right") {
        return (
          <section key={block.id} className="sky-image-text" style={{ maxWidth: width, width: block.width === "full" ? "100%" : "calc(100% - 28px)", margin, gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
            {block.imagePosition === "left" && imageContent}
            {textContent}
            {block.imagePosition === "right" && imageContent}
          </section>
        );
      }
      return (
        <section
          key={block.id}
          className="sky-image-text"
          style={{
            maxWidth: width,
            width:
              block.width === "full"
                ? "100%"
                : "calc(100% - 28px)",
            margin,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            alignItems: "stretch",
          }}
        >
          {block.imagePosition === "top" && textContent}
          {imageContent}
          {block.imagePosition === "bottom" && textContent}
        </section>
      );
    }

    if (block.type === "spacer") {
      return <div key={block.id} style={{ height: block.height }} />;
    }

    return null;
  };

  return (
    <div
      style={
        {
          "--primary": config.primaryColor,
          "--buy": config.buttonColor,
          "--text": config.accentColor,
        } as React.CSSProperties
      }
      className="sky-landing"
    >
      <style>{`
        *{box-sizing:border-box}
        html,body,#root{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif;color:var(--text,#111);background:#fff}
        button,input,select,textarea{font:inherit}
        .sky-announcement{background:var(--primary);color:#fff;text-align:center;padding:17px 12px;font-size:19px;font-weight:800;letter-spacing:.35px}
        .sky-product{max-width:1170px;margin:36px auto 0;padding:0 18px;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(380px,.82fr);gap:48px;align-items:start}
        .sky-main-image{width:100%;aspect-ratio:1/1;border-radius:12px;overflow:hidden;background:#f2f2f2;position:relative}
        .sky-main-image img,.sky-main-image video{width:100%;height:100%;object-fit:cover;display:block}
        .sky-thumbs{display:flex;gap:9px;margin-top:9px;overflow:auto;padding:2px}
        .sky-thumb{width:82px;height:82px;border-radius:9px;overflow:hidden;border:1px solid #ddd;padding:0;background:#111;cursor:pointer;flex:0 0 auto;position:relative}
        .sky-thumb.active{outline:2px solid #111;outline-offset:1px}
        .sky-thumb img,.sky-thumb video{width:100%;height:100%;object-fit:cover}
        .sky-play{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:25px;text-shadow:0 2px 8px #000}
        .sky-title{font-size:40px;line-height:1.05;margin:4px 0 8px;font-weight:900;letter-spacing:-.8px}
        .sky-rating{display:flex;align-items:center;gap:10px;font-size:18px}
        .sky-stars{color:#ffbc00;font-size:23px;letter-spacing:-2px}
        .sky-price-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:16px 0 19px}
        .sky-price{font-size:22px;font-weight:900;color:var(--primary)}
        .sky-compare{font-weight:800;text-decoration:line-through;color:#333}
        .sky-save{background:var(--primary);color:#fff;font-weight:900;font-size:12px;border-radius:4px;padding:4px 7px}
        .sky-qty-label{font-size:14px;font-weight:800;margin-bottom:5px}
        .sky-qty{display:grid;grid-template-columns:47px 47px 47px;height:47px;border:1px solid #ddd;border-radius:10px;overflow:hidden;background:#faf8fb;width:max-content}
        .sky-qty button,.sky-qty span{border:0;background:transparent;display:grid;place-items:center;cursor:pointer}
        .sky-buy{margin-top:16px;width:100%;min-height:68px;border-style:solid;background:var(--buy);box-shadow:0 3px 8px rgba(0,0,0,.28);font-weight:900;cursor:pointer;padding-left:20px;padding-right:20px;transform-origin:center}
        .sky-buy-main{font-size:14px;letter-spacing:.45px}
        .sky-buy-sub{font-size:11px;margin-top:4px}
        .sky-timeline{margin:26px 5px 25px;display:grid;grid-template-columns:1fr 1fr 1fr;position:relative;text-align:center}
        .sky-timeline:before{content:"";position:absolute;left:15%;right:15%;top:24px;height:4px;background:#171717}
        .sky-step{position:relative;z-index:1}
        .sky-circle{width:49px;height:49px;border-radius:50%;background:#151515;color:#fff;display:grid;place-items:center;margin:auto;font-size:22px}
        .sky-step b{display:block;margin-top:8px;font-size:15px}
        .sky-step span{display:block;margin-top:2px;color:#444;font-size:14px}
        .sky-headline{font-size:39px;line-height:1.18;font-weight:900;letter-spacing:-1px;margin:28px 0 14px;white-space:pre-line}
        .sky-hero-text{font-size:17px;line-height:1.65;color:#333}
        .sky-free-block{margin:26px auto;padding:0 18px}
        .sky-media-block{margin:16px auto;padding:0 14px}
        .sky-media-block.full{padding:0}
        .sky-image-text{max-width:1040px;margin:36px auto;padding:0 18px;display:grid;grid-template-columns:1fr 1fr;gap:30px;align-items:center}
        .sky-image-text img{width:100%;height:auto;border-radius:14px}
        .sky-image-text h2{font-size:40px;line-height:1.12;margin:0 0 14px;font-weight:900}
        .sky-image-text p{font-size:18px;line-height:1.7;white-space:pre-line}
        .sky-video-row{display:grid;margin:22px auto}
        .sky-video-row-item{overflow:hidden;background:#000}
        .sky-video-row-item video{width:100%;display:block;background:#000}
        .sky-video-row-item.portrait{aspect-ratio:9/16}
        .sky-video-row-item.square{aspect-ratio:1/1}
        .sky-video-row-item.portrait video,.sky-video-row-item.square video{height:100%;object-fit:cover}
        @keyframes skyBuyShake{0%,88%,100%{transform:translateX(0)}90%{transform:translateX(-6px)}92%{transform:translateX(6px)}94%{transform:translateX(-5px)}96%{transform:translateX(5px)}98%{transform:translateX(0)}}
        @keyframes skyBuyPulse{0%,80%,100%{transform:scale(1)}90%{transform:scale(1.045)}}
        @keyframes skyBuyBounce{0%,82%,100%{transform:translateY(0)}88%{transform:translateY(-8px)}94%{transform:translateY(0)}}
        @keyframes skyBuyShine{0%,78%,100%{filter:brightness(1)}88%{filter:brightness(1.35);box-shadow:0 0 26px rgba(255,255,255,.55)}}
        .sky-buy-effect-shake{animation:skyBuyShake var(--sky-effect-duration,5s) infinite}
        .sky-buy-effect-pulse{animation:skyBuyPulse var(--sky-effect-duration,5s) infinite}
        .sky-buy-effect-bounce{animation:skyBuyBounce var(--sky-effect-duration,5s) infinite}
        .sky-buy-effect-shine{animation:skyBuyShine var(--sky-effect-duration,5s) infinite}
        .sky-offer-block{max-width:920px;margin:24px auto;padding:0 14px}
        .sky-offer-block h3{text-align:center;font-size:24px;font-weight:950;margin:0 0 12px}
        .sky-offer-grid{display:grid;gap:10px}
        .sky-offer-card{position:relative;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;width:100%;background:#fff;border:2px solid #d4d4d4;border-radius:10px;padding:10px;text-align:left;cursor:pointer}
        .sky-offer-card.highlight{border-color:#0879d9;background:#e9f5ff}
        .sky-offer-card:hover{border-color:#111}
        .sky-offer-badge{position:absolute;left:66px;bottom:7px;background:#1677ff;color:#fff;font-size:8px;font-weight:900;border-radius:3px;padding:3px 6px}
        .sky-offer-image{width:58px;height:58px;border-radius:7px;object-fit:cover}
        .sky-offer-body{min-width:0}
        .sky-offer-qty{font-size:13px;font-weight:950}
        .sky-offer-description{font-size:11px;font-weight:700;margin-top:2px;white-space:pre-line}
        .sky-offer-label{font-size:10px;opacity:.65;margin-top:3px}
        .sky-offer-money{text-align:right;white-space:nowrap}
        .sky-offer-compare{font-size:10px;text-decoration:line-through;color:#777}
        .sky-offer-price{font-size:14px;font-weight:950;color:#111;margin-top:2px}
        .sky-custom-gallery{display:grid;grid-template-columns:repeat(var(--gallery-cols,3),minmax(0,1fr));gap:var(--gallery-gap,14px);margin:22px auto}
        .sky-custom-gallery-item{overflow:hidden;background:#000}
        .sky-custom-gallery-item img,.sky-custom-gallery-item video{width:100%;display:block;background:#000}
        .sky-custom-gallery-item.portrait{aspect-ratio:9/16}
        .sky-custom-gallery-item.square{aspect-ratio:1/1}
        .sky-custom-gallery-item.portrait img,.sky-custom-gallery-item.portrait video,.sky-custom-gallery-item.square img,.sky-custom-gallery-item.square video{height:100%;object-fit:cover}
        .sky-block-buy-wrap{margin:24px auto;padding:0 14px}
        .sky-block-buy{width:100%;min-height:66px;border-radius:999px;border:5px solid #000;background:var(--buy);color:#fff;font-weight:900;cursor:pointer;padding:9px 18px;box-shadow:0 4px 11px rgba(0,0,0,.25)}
        .sky-block-buy:hover,.sky-buy:hover{filter:brightness(.97)}
        .sky-section{max-width:1020px;margin:0 auto;padding:56px 20px}
        .sky-section h2{font-size:38px;line-height:1.15;text-align:center;font-weight:900;margin:0 0 18px}
        .sky-section p{font-size:17px;line-height:1.7;color:#333}
        .sky-benefits-wrap{background:#f6f6f6}
        .sky-benefits{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
        .sky-benefit{background:#fff;border:1px solid #e3e3e3;border-radius:16px;padding:20px;font-size:18px;font-weight:800}
        .sky-gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .sky-gallery > *{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;background:#000}
        .sky-related{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        .sky-card{border:1px solid #e4e4e4;border-radius:14px;overflow:hidden;background:#fff}
        .sky-card img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#f3f3f3}
        .sky-card-body{padding:14px}
        .sky-card-title{font-weight:900;font-size:16px}
        .sky-card-price{font-weight:900;color:var(--primary);margin-top:6px}
        .sky-card button{width:100%;margin-top:10px;background:#111;color:#fff;border:0;border-radius:9px;padding:11px;font-weight:800;cursor:pointer}
        .sky-faq{max-width:850px;margin:auto}
        .sky-faq details{border-bottom:1px solid #ddd;padding:16px 0}
        .sky-faq summary{font-weight:900;font-size:18px;cursor:pointer}
        .sky-faq p{text-align:left;margin:10px 0 0}
        .sky-footer{background:#111;color:#fff;text-align:center;padding:30px 20px;font-size:13px}
        .sky-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998}
        .sky-checkout{position:fixed;left:14px;top:10px;bottom:10px;width:390px;max-width:calc(100vw - 28px);z-index:9999;background:#fff;border:2px solid #111;border-radius:8px;box-shadow:0 7px 30px rgba(0,0,0,.35);overflow:auto}
        .sky-ck-head{display:flex;justify-content:space-between;align-items:center;padding:14px 15px;border-bottom:1px solid #ddd;font-size:13px;font-weight:900}
        .sky-close{background:transparent;border:0;font-size:25px;cursor:pointer}
        .sky-ck-product{display:flex;gap:10px;align-items:center;padding:13px;border-bottom:1px solid #ddd}
        .sky-ck-product img{width:54px;height:54px;object-fit:cover;border-radius:7px}
        .sky-ck-title{font-weight:900;font-size:13px}
        .sky-ck-price{margin-left:auto;font-weight:900;font-size:12px;white-space:nowrap}
        .sky-summary{padding:12px 15px;border-bottom:1px solid #ddd;font-size:13px}
        .sky-summary div{display:flex;justify-content:space-between;margin:5px 0}
        .sky-delivery{margin:12px;border:1px solid #aaa;border-radius:6px;padding:11px;font-size:12px;line-height:1.5}
        .sky-form{padding:4px 14px 18px}
        .sky-form h3{text-align:center;font-size:14px}
        .sky-field{margin:10px 0}
        .sky-field label{display:block;font-size:11px;font-weight:900;margin-bottom:4px;text-transform:uppercase}
        .sky-field input,.sky-field select{width:100%;height:40px;border:1px solid #aaa;border-radius:6px;padding:0 9px}
        .sky-submit{width:100%;border:3px solid #111;border-radius:24px;background:#21ed32;padding:12px 10px;font-weight:900;cursor:pointer}
        .sky-attention{margin:16px 0 0;border-radius:9px;background:#fff4dc;border:1px solid #f0d59a;padding:13px;font-size:12px;line-height:1.55}
        .sky-preview-toolbar{position:sticky;top:0;z-index:10050;min-height:48px;background:#111;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:8px 16px;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.2)}
        .sky-preview-toolbar span{opacity:.75}
        .sky-preview-toolbar button{border:1px solid #555;background:#242424;color:#fff;border-radius:9px;padding:7px 11px;cursor:pointer;font-weight:800}
        @media(max-width:860px){
          .sky-preview-toolbar{font-size:11px;padding:7px 10px}
          .sky-preview-toolbar span{display:none}
          .sky-preview-toolbar button{padding:6px 8px;font-size:10px}
          .sky-announcement{font-size:14px;padding:13px 9px}
          .sky-product{grid-template-columns:1fr;margin-top:18px;gap:20px;padding:0 14px}
          .sky-title{font-size:31px}
          .sky-headline{font-size:31px}
          .sky-free-block h2{font-size:30px!important}
          .sky-image-text{grid-template-columns:1fr;margin:26px auto}
          .sky-image-text h2{font-size:30px}
          .sky-free-image-block.side{grid-template-columns:1fr!important}
          .sky-video-row{grid-template-columns:repeat(var(--video-row-mobile-cols,1),minmax(0,1fr))!important}
          .sky-custom-gallery{grid-template-columns:repeat(var(--gallery-mobile-cols,1),minmax(0,1fr))!important}
          .sky-block-buy-wrap{padding:0 14px!important}
          .sky-section{padding:38px 17px}
          .sky-section h2{font-size:29px}
          .sky-benefits,.sky-related{grid-template-columns:1fr}
          .sky-gallery{grid-template-columns:repeat(2,1fr)}
          .sky-checkout{left:7px;right:7px;top:7px;bottom:7px;width:auto;max-width:none}
        }
      `}</style>

      {preview && (
        <div className="sky-preview-toolbar">
          <div>
            <b>👁 VISTA PREVIA</b>
            <span> — No está publicada y los pedidos no se guardan.</span>
          </div>
          <button onClick={() => window.close()}>✕ Cerrar vista previa</button>
        </div>
      )}

      <div className="sky-announcement">{config.announcement}</div>

      <main className="sky-product">
        <div>
          <div className="sky-main-image">
            {activeMedia?.type === "video" ? (
              <video
                key={activeMedia.url}
                src={activeMedia.url}
                controls
                playsInline
                poster={firstImage}
              />
            ) : activeMedia?.url ? (
              <img src={activeMedia.url} alt={product.title} />
            ) : (
              <div style={{ height: "100%", display: "grid", placeItems: "center", fontSize: 70 }}>📷</div>
            )}
          </div>
          {media.length > 1 && (
            <div className="sky-thumbs">
              {media.map((item, i) => (
                <button
                  key={item.id || i}
                  className={`sky-thumb ${i === mediaIndex ? "active" : ""}`}
                  onClick={() => setMediaIndex(i)}
                >
                  {item.type === "image" ? (
                    <img src={item.url} alt={`${product.title} ${i + 1}`} />
                  ) : (
                    <>
                      <video src={item.url} muted playsInline />
                      <span className="sky-play">▶</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="sky-title">{product.title.toUpperCase()}</h1>
          <div className="sky-rating">
            <span className="sky-stars">★★★★★</span>
            <span>{config.reviewsText}</span>
          </div>

          <div className="sky-price-row">
            <span className="sky-price">Gs. {nf(product.price)}</span>
            {product.compareAtPrice > product.price && (
              <>
                <span className="sky-compare">Gs. {nf(product.compareAtPrice)}</span>
                <span className="sky-save">🏷 SAVE {discount}%</span>
              </>
            )}
          </div>

          <div className="sky-qty-label">Cantidad</div>
          <div className="sky-qty">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity((q) => q + 1)}>＋</button>
          </div>

          <button
            type="button"
            className={`sky-buy sky-buy-effect-${config.mainButtonEffect}`}
            style={{
              background: config.buttonColor,
              color: config.mainButtonTextColor,
              borderColor: config.mainButtonBorderColor,
              borderWidth: config.mainButtonBorderWidth,
              borderRadius: config.mainButtonBorderRadius,
              fontSize: config.mainButtonFontSize,
              paddingTop: config.mainButtonPaddingY,
              paddingBottom: config.mainButtonPaddingY,
              ["--sky-effect-duration" as any]: `${Math.max(
                2,
                config.mainButtonEffectEverySeconds || 5,
              )}s`,
            }}
            onClick={() => setCheckoutOpen(true)}
          >
            <div className="sky-buy-main">{config.buttonText}</div>
            <div className="sky-buy-sub">{config.buttonSubtext}</div>
          </button>

          {config.sections.timeline && (
            <div className="sky-timeline">
              <div className="sky-step"><div className="sky-circle">🛒</div><b>Hoy</b><span>Ordenado</span></div>
              <div className="sky-step"><div className="sky-circle">🚚</div><b>1 - 2 días</b><span>Orden lista</span></div>
              <div className="sky-step"><div className="sky-circle">🎁</div><b>2 - 4 días</b><span>Entregado</span></div>
            </div>
          )}

          <div className="sky-headline">{config.heroHeadline}</div>
          <div className="sky-hero-text">{config.heroDescription}</div>
        </div>
      </main>

      {blocks.map(renderBlock)}

      {config.sections.description && (
        <section className="sky-section">
          <h2>Conocé por qué este producto puede hacer la diferencia</h2>
          <p style={{ textAlign: "center" }}>
            {product.description || config.heroDescription}
          </p>
        </section>
      )}

      {config.sections.gallery && media.length > 1 && (
        <section className="sky-section">
          <h2>Mirá el producto en detalle</h2>
          <div className="sky-gallery">
            {media.map((item, i) =>
              item.type === "image" ? (
                <img key={item.id || i} src={item.url} alt="" />
              ) : (
                <video key={item.id || i} src={item.url} controls playsInline />
              ),
            )}
          </div>
        </section>
      )}

      {config.sections.benefits && (
        <div className="sky-benefits-wrap">
          <section className="sky-section">
            <h2>Todo lo que necesitás en una sola compra</h2>
            <div className="sky-benefits">
              {config.benefits.map((benefit, index) => (
                <div className="sky-benefit" key={index}>✅ {benefit}</div>
              ))}
            </div>
          </section>
        </div>
      )}

      {config.sections.warranty && product.warranty && (
        <section className="sky-section">
          <h2>Compra con tranquilidad</h2>
          <p style={{ textAlign: "center" }}>{product.warranty}</p>
        </section>
      )}

      {config.sections.relatedProducts && products.length > 1 && (
        <section className="sky-section">
          <h2>También te puede interesar</h2>
          <div className="sky-related">
            {products.map((p) => {
              const cover = legacyMedia(p).find((m) => m.type === "image")?.url;
              return (
                <div className="sky-card" key={p.id}>
                  {cover ? <img src={cover} alt={p.title} /> : <div style={{aspectRatio:"1/1",display:"grid",placeItems:"center",fontSize:50}}>📦</div>}
                  <div className="sky-card-body">
                    <div className="sky-card-title">{p.title}</div>
                    <div className="sky-card-price">Gs. {nf(p.price)}</div>
                    <button onClick={() => setActiveProductId(p.id)}>Ver / Comprar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {config.sections.faq && config.faq.length > 0 && (
        <section className="sky-section">
          <h2>Preguntas frecuentes</h2>
          <div className="sky-faq">
            {config.faq.map((item, index) => (
              <details key={index}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <footer className="sky-footer">
        Compra segura · Atención al cliente · Envíos según cobertura
      </footer>

      {checkoutOpen && (
        <>
          <div className="sky-overlay" onClick={() => setCheckoutOpen(false)} />
          <aside className="sky-checkout" role="dialog" aria-modal="true" aria-label="Finalizar compra">
            <div className="sky-ck-head">
              {config.checkoutTitle}
              <button className="sky-close" onClick={() => setCheckoutOpen(false)}>×</button>
            </div>

            <div className="sky-ck-product">
              {firstImage && <img src={firstImage} alt="" />}
              <div>
                <div className="sky-ck-title">{product.title}</div>
                <div style={{ fontSize: 11 }}>Cantidad: {quantity}</div>
              </div>
              <div className="sky-ck-price">Gs. {nf(total)}</div>
            </div>

            <div className="sky-summary">
              <div><span>Subtotal</span><b>Gs. {nf(total)}</b></div>
              <div><span>Envío</span><b>A confirmar</b></div>
              <div style={{ borderTop: "1px solid #ddd", paddingTop: 7 }}><b>Total</b><b>Gs. {nf(total)}</b></div>
            </div>

            {renderCheckoutSections("before_offers")}

            {config.quantityOffers?.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  margin: "8px 0 10px",
                }}
              >
                {config.quantityOffers.map((offer: any) => {
                  const active = selectedOfferId === offer.id;
                  const compare =
                    Number(offer.compareAtPriceGs || 0) >
                    Number(offer.priceGs || 0);

                  return (
                    <button
                      type="button"
                      key={offer.id}
                      onClick={() => chooseOffer(offer, false)}
                      style={{
                        width: "100%",
                        position: "relative",
                        display: "grid",
                        gridTemplateColumns: offer.imageUrl
                          ? "56px minmax(0,1fr) auto"
                          : "minmax(0,1fr) auto",
                        gap: 8,
                        alignItems: "center",
                        padding: "8px 9px",
                        borderRadius: 5,
                        border: active
                          ? "2px solid #0b82db"
                          : "1px solid #d2d2d2",
                        background: active ? "#e8f4fd" : "#ffffff",
                        color: "#111111",
                        cursor: "pointer",
                        textAlign: "left",
                        boxSizing: "border-box",
                        minHeight: 66,
                      }}
                    >
                      {offer.imageUrl && (
                        <img
                          src={offer.imageUrl}
                          alt=""
                          style={{
                            display: "block",
                            width: 56,
                            height: 50,
                            minWidth: 56,
                            maxWidth: 56,
                            maxHeight: 50,
                            objectFit: "cover",
                            borderRadius: 4,
                            border: "1px solid #e2e2e2",
                            margin: 0,
                            padding: 0,
                          }}
                        />
                      )}

                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          minWidth: 0,
                          lineHeight: 1.15,
                        }}
                      >
                        <strong
                          style={{
                            display: "block",
                            fontSize: 11,
                            fontWeight: 950,
                            lineHeight: 1.15,
                            whiteSpace: "normal",
                          }}
                        >
                          {offer.title ||
                            `${offer.quantity} unidad(es)`}
                        </strong>

                        {offer.description && (
                          <span
                            style={{
                              display: "block",
                              fontSize: 10,
                              fontWeight: 700,
                              lineHeight: 1.15,
                              marginTop: 3,
                              whiteSpace: "normal",
                            }}
                          >
                            {offer.description}
                          </span>
                        )}

                        {offer.badge && (
                          <span
                            style={{
                              display: "inline-flex",
                              marginTop: 5,
                              background: "#1479f5",
                              color: "#ffffff",
                              borderRadius: 2,
                              padding: "3px 6px",
                              fontSize: 8,
                              lineHeight: 1,
                              fontWeight: 950,
                              whiteSpace: "nowrap",
                              maxWidth: "100%",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {offer.badge}
                          </span>
                        )}
                      </span>

                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          whiteSpace: "nowrap",
                          paddingLeft: 3,
                        }}
                      >
                        {compare && (
                          <span
                            style={{
                              fontSize: 9,
                              color: "#666666",
                              lineHeight: 1.1,
                              textDecoration: "line-through",
                            }}
                          >
                            Gs. {nf(offer.compareAtPriceGs)}
                          </span>
                        )}

                        <strong
                          style={{
                            fontSize: 11,
                            lineHeight: 1.15,
                            fontWeight: 950,
                            marginTop: compare ? 2 : 0,
                          }}
                        >
                          Gs. {nf(offer.priceGs)}
                        </strong>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {renderCheckoutSections("after_offers")}
            {renderCheckoutSections("before_shipping")}

            <div className="sky-delivery">
              <b>◉ {config.shippingText}</b><br /><br />☆ {config.expressText}
            </div>

            {renderCheckoutSections("before_form")}

            <div className="sky-form">
              <h3>Ingrese su dirección de envío</h3>

              <div className="sky-field">
                <label>Nombre y apellido *</label>
                <input value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="Nombre y apellido" />
              </div>
              <div className="sky-field">
                <label>Celular con WhatsApp *</label>
                <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="0981..." />
              </div>
              <div className="sky-field">
                <label>Departamento *</label>
                <select value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value, city: "" }))}>
                  <option value="">Seleccioná departamento</option>
                  {availableLocations.map((item) => <option key={item.department} value={item.department}>{item.department}</option>)}
                </select>
              </div>
              <div className="sky-field">
                <label>Ciudad *</label>
                <select value={form.city} disabled={!form.department} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}>
                  <option value="">{form.department ? "Seleccioná ciudad" : "Primero elegí departamento"}</option>
                  {availableCities.map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
              </div>
              <div className="sky-field">
                <label>Calle principal</label>
                <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} placeholder="Calle principal" />
              </div>
              <div className="sky-field">
                <label>Referencia</label>
                <input value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} placeholder="Alguna referencia o característica" />
              </div>

              {renderCheckoutSections("after_form")}

              <button className="sky-submit" disabled={sending} onClick={submitOrder}>
                {sending ? "REGISTRANDO PEDIDO..." : "🛒 COMPLETAR PEDIDO Y FINALIZAR ✅"}
              </button>

              <div className="sky-attention">
                <b>🚚 ATENCIÓN</b><br />
                Los tiempos y modalidades de entrega dependen de la ciudad y de la cobertura disponible.
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
