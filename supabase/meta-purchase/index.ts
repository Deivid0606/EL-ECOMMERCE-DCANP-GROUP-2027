import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  order_id?: string;
  event_source_url?: string;
  fbp?: string | null;
  fbc?: string | null;
};

type MetaCredentials = {
  pixel_id: string;
  access_token: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const sha256 = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const normalizePhone = (value: string) => {
  let digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Paraguay:
  // 09xx... -> 5959xx...
  if (digits.startsWith("0")) {
    digits = `595${digits.slice(1)}`;
  }

  return digits;
};

const safeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

// Normalización según Meta: minúsculas, sin acentos ni signos de puntuación.
const normalizeText = (value: unknown) =>
  safeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Ciudad / departamento: además sin espacios.
const normalizeLocation = (value: unknown) =>
  normalizeText(value).replace(/\s/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const graphApiVersion = Deno.env.get("META_GRAPH_API_VERSION");
  const testEventCode = Deno.env.get("META_TEST_EVENT_CODE") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        ok: false,
        error:
          "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en la Edge Function.",
      },
      500,
    );
  }

  if (!graphApiVersion) {
    return json(
      {
        ok: false,
        error:
          "Falta el secret META_GRAPH_API_VERSION. Configuralo con la versión vigente de Graph API de tu app Meta.",
      },
      500,
    );
  }

  let body: RequestBody;

  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const orderId = safeString(body.order_id);

  if (!orderId) {
    return json({ ok: false, error: "Falta order_id" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: order, error: orderError } = await supabase
    .from("landing_page_orders")
    .select(
      [
        "id",
        "landing_page_id",
        "seller_email",
        "product_id",
        "product_title",
        "quantity",
        "unit_price_gs",
        "total_gs",
        "customer_name",
        "phone",
        "department",
        "city",
        "created_at",
        "meta_capi_status",
        "meta_event_id",
      ].join(","),
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    console.error("Order lookup error:", orderError);

    return json(
      {
        ok: false,
        error: "No se pudo leer el pedido",
        details: orderError.message,
      },
      500,
    );
  }

  if (!order) {
    return json({ ok: false, error: "Pedido inexistente" }, 404);
  }

  // Si Meta ya confirmó este pedido, no lo volvemos a enviar.
  if (order.meta_capi_status === "sent") {
    return json({
      ok: true,
      deduplicated_locally: true,
      event_id:
        order.meta_event_id || `landing-order-${order.id}`,
    });
  }

  const { data: credentialsRows, error: credentialsError } =
    await supabase.rpc("get_meta_credentials_for_order", {
      p_order_id: orderId,
    });

  if (credentialsError) {
    console.error("Credential RPC error:", credentialsError);

    await supabase
      .from("landing_page_orders")
      .update({
        meta_capi_status: "error",
        meta_capi_last_error: credentialsError.message,
      })
      .eq("id", orderId);

    return json(
      {
        ok: false,
        error: "No se pudieron obtener las credenciales Meta del vendedor",
        details: credentialsError.message,
      },
      500,
    );
  }

  const credentials = Array.isArray(credentialsRows)
    ? (credentialsRows[0] as MetaCredentials | undefined)
    : (credentialsRows as MetaCredentials | null);

  if (!credentials?.pixel_id || !credentials?.access_token) {
    const message =
      "El vendedor no tiene Pixel ID + Access Token configurados.";

    await supabase
      .from("landing_page_orders")
      .update({
        meta_capi_status: "not_configured",
        meta_capi_last_error: message,
      })
      .eq("id", orderId);

    return json(
      {
        ok: false,
        error: message,
      },
      200,
    );
  }

  const eventId = `landing-order-${order.id}`;
  const normalizedPhone = normalizePhone(order.phone || "");

  const userData: Record<string, unknown> = {};

  if (normalizedPhone) {
    const hashedPhone = await sha256(normalizedPhone);
    userData.ph = [hashedPhone];
    // El teléfono identifica al cliente entre pedidos.
    userData.external_id = [hashedPhone];
  }

  // Más datos del cliente = mejor coincidencia de eventos en Meta.
  const nameParts = normalizeText(order.customer_name).split(" ").filter(Boolean);
  if (nameParts.length > 0) {
    userData.fn = [await sha256(nameParts[0])];
  }
  if (nameParts.length > 1) {
    userData.ln = [await sha256(nameParts[nameParts.length - 1])];
  }

  const city = normalizeLocation(order.city);
  if (city) userData.ct = [await sha256(city)];

  const department = normalizeLocation(order.department);
  if (department) userData.st = [await sha256(department)];

  userData.country = [await sha256("py")];

  const fbp = safeString(body.fbp);
  const fbc = safeString(body.fbc);

  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const forwardedFor =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    "";

  const clientIp = forwardedFor.split(",")[0]?.trim() || "";
  const clientUserAgent = req.headers.get("user-agent") || "";

  if (clientIp) {
    userData.client_ip_address = clientIp;
  }

  if (clientUserAgent) {
    userData.client_user_agent = clientUserAgent;
  }

  const eventSourceUrl =
    safeString(body.event_source_url) ||
    `${supabaseUrl}/landing/${order.landing_page_id}`;

  const eventTime = Math.floor(
    new Date(order.created_at || Date.now()).getTime() / 1000,
  );

  const metaPayload: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: eventId,
        event_source_url: eventSourceUrl,
        action_source: "website",
        user_data: userData,
        custom_data: {
          currency: "PYG",
          value: Number(order.total_gs || 0),
          content_ids: order.product_id
            ? [String(order.product_id)]
            : [],
          content_name: order.product_title || "",
          content_type: "product",
          num_items: Number(order.quantity || 1),
          order_id: String(order.id),
        },
      },
    ],
  };

  if (testEventCode) {
    metaPayload.test_event_code = testEventCode;
  }

  const normalizedVersion = graphApiVersion.startsWith("v")
    ? graphApiVersion
    : `v${graphApiVersion}`;

  const endpoint =
    `https://graph.facebook.com/${encodeURIComponent(normalizedVersion)}/` +
    `${encodeURIComponent(credentials.pixel_id)}/events?access_token=` +
    `${encodeURIComponent(credentials.access_token)}`;

  let metaResponse: Response;
  let metaJson: any;

  try {
    metaResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metaPayload),
    });

    metaJson = await metaResponse.json();
  } catch (fetchError) {
    const message =
      fetchError instanceof Error
        ? fetchError.message
        : "Error de red enviando Purchase a Meta";

    console.error("Meta fetch error:", fetchError);

    await supabase
      .from("landing_page_orders")
      .update({
        meta_event_id: eventId,
        meta_capi_status: "error",
        meta_capi_last_error: message,
      })
      .eq("id", orderId);

    return json(
      {
        ok: false,
        event_id: eventId,
        error: message,
      },
      502,
    );
  }

  if (!metaResponse.ok || metaJson?.error) {
    const message =
      metaJson?.error?.message ||
      `Meta respondió HTTP ${metaResponse.status}`;

    console.error("Meta CAPI rejected:", metaJson);

    await supabase
      .from("landing_page_orders")
      .update({
        meta_event_id: eventId,
        meta_capi_status: "error",
        meta_capi_last_error: message,
        meta_capi_response: metaJson,
      })
      .eq("id", orderId);

    return json(
      {
        ok: false,
        event_id: eventId,
        error: message,
        meta: metaJson,
      },
      502,
    );
  }

  await supabase
    .from("landing_page_orders")
    .update({
      meta_event_id: eventId,
      meta_capi_status: "sent",
      meta_capi_sent_at: new Date().toISOString(),
      meta_capi_last_error: null,
      meta_capi_response: metaJson,
    })
    .eq("id", orderId);

  return json({
    ok: true,
    event_id: eventId,
    meta: metaJson,
    test_mode: Boolean(testEventCode),
  });
});
