
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type SourceOrder = {
  source_order_id: string;
  items?: Array<{sku:string;title?:string;quantity:number;price:number}>;
  order_number?: string;
  customer_name?: string;
  phone?: string;
  city?: string;
  departamento?: string;
  street?: string;
  district?: string;
  email?: string;
  obs?: string;
  sku?: string;
  product_title?: string;
  quantity?: number;
  total?: number;
  payment_method?: string;
  payment_status?: string;
  receipt_url?: string;
};

type ImportStatus =
  | "created"
  | "already_exists"
  | "error";

type ImportResult = {
  source_order_id: string;
  status: ImportStatus;
  message?: string;
  ecommerce_order_number?: string;
};

type Detail = {
  id: string;
  status: ImportStatus;
  reason: string;
  ecommerceOrderNumber?: string;
};

const channel = "botsky-import-v1";

const allowedOrigin =
  "https://skybot-ai-sales-130022.vercel.app";

const normalize = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const normalizeLocation = (
  value: unknown
): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

const isCapitalDepartment = (
  value: unknown
): boolean =>
  [
    "distrito capital",
    "capital",
    "asuncion",
    "central",
  ].includes(normalizeLocation(value));

const departmentsMatch = (
  city: unknown,
  sourceDepartment: unknown,
  registeredDepartment: unknown
): boolean => {
  const cityName = normalizeLocation(city);
  const source = normalizeLocation(sourceDepartment);
  const registered = normalizeLocation(
    registeredDepartment
  );

  if (!source) return true;
  if (source === registered) return true;

  return (
    cityName === "asuncion" &&
    isCapitalDepartment(source) &&
    isCapitalDepartment(registered)
  );
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    return String(error.message);
  }

  return String(error);
};

const makeOrderNumber = (id: string): string =>
  `BS${id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 30)}`;

export default function BotSkyImportBridge() {
  const { user, profile } = useAuth();

  const [report, setReport] = useState(
    "Esperando conexión desde BOT SKY…"
  );

  const [working, setWorking] = useState(false);
  const [details, setDetails] = useState<Detail[]>(
    []
  );

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

    if (params.get("view") !== "import-botsky") {
      return;
    }

    if (!user || !profile?.approved) {
      return;
    }

    if (!window.opener) {
      setReport(
        "No se detectó la pestaña de BOT SKY. " +
          "Abrí la importación desde BOT SKY."
      );
      return;
    }

    let busy = false;

    const sendReady = () => {
      window.opener?.postMessage(
        {
          channel,
          type: "READY",
        },
        allowedOrigin
      );
    };

    const timer = window.setInterval(() => {
      if (!busy) sendReady();
    }, 1200);

    sendReady();

    const onMessage = async (
      event: MessageEvent
    ) => {
      if (
        event.origin !== allowedOrigin ||
        event.source !== window.opener
      ) {
        return;
      }

      const msg = event.data;

      if (
        busy ||
        msg?.channel !== channel ||
        msg.type !== "ORDERS" ||
        !Array.isArray(msg.orders) ||
        typeof msg.batchId !== "string"
      ) {
        return;
      }

      busy = true;
      clearInterval(timer);

      setWorking(true);
      setDetails([]);
      setReport("Procesando pedidos…");

      const results: ImportResult[] = [];
      const role = normalize(profile.role);
      const email = normalize(profile.email);

      try {
        const allowedRoles = [
          "admin",
          "administrador",
          "seller",
          "vendedor",
          "provider",
          "proveedor",
        ];

        if (
          !email ||
          !allowedRoles.includes(role)
        ) {
          throw new Error(
            "Tu usuario no tiene permisos para importar pedidos."
          );
        }

        if (msg.orders.length > 100) {
          throw new Error(
            "Máximo 100 pedidos por lote."
          );
        }

        // ====================================
        // CARGAR PRODUCTOS
        // ====================================

        const {
          data: products,
          error: productError,
        } = await supabase
          .from("products")
          .select("*");

        if (productError) {
          throw productError;
        }

        // ====================================
        // CARGAR FAVORITOS
        // ====================================

        const {
          data: favorites,
          error: favoritesError,
        } = await supabase
          .from("user_favorites")
          .select("product_id")
          .eq("user_email", profile.email);

        if (favoritesError) {
          throw favoritesError;
        }

        const favoriteIds = new Set(
          (favorites || []).map(
            (favorite) => favorite.product_id
          )
        );

        // ====================================
        // CARGAR TARIFAS
        // ====================================

        const {
          data: cities,
          error: cityError,
        } = await supabase
          .from("client_prices")
          .select("*");

        if (cityError) {
          throw cityError;
        }

        const seen = new Set<string>();

        // ====================================
        // PROCESAR PEDIDOS
        // ====================================

        for (
          const raw of msg.orders as SourceOrder[]
        ) {
          const id = String(
            raw.source_order_id || ""
          ).trim();

          try {
            if (!id || seen.has(id)) {
              throw new Error(
                "ID de origen ausente o repetido en el lote."
              );
            }

            seen.add(id);

            // ====================================
            // COMPROBAR SI YA EXISTE
            // ====================================

            const {
              data: existing,
              error: existingError,
            } = await supabase
              .from("orders")
              .select("id, order_number, items_json")
              .eq("source_system", "BOT_SKY")
              .eq("source_order_id", id)
              .maybeSingle();

            if (existingError) {
              throw existingError;
            }

            if (existing) {
              const expected=Array.isArray(raw.items)&&raw.items.length ? raw.items
                : [{sku:raw.sku||"",quantity:Number(raw.quantity),price:Number(raw.total)/Number(raw.quantity)}];
              const actual=Array.isArray(existing.items_json)?existing.items_json:[];
              const signature=(items:Array<{sku?:string;quantity?:number;qty?:number;price?:number;sale_gs?:number}>)=>
                items.map(item=>[normalize(item.sku),Number(item.quantity??item.qty),
                  Math.round(Number(item.sale_gs??(Number(item.price)*Number(item.quantity??item.qty)))*100)/100].join("|")).sort().join(";");
              if(signature(expected)!==signature(actual))
                throw new Error("El pedido ya existe en E-commerce con productos o cantidades diferentes. Revisar manualmente.");
              results.push({
                source_order_id: id,
                status: "already_exists",
                ecommerce_order_number:
                  existing.order_number || "",
                message:
                  "Pedido ya cargado correctamente en E-commerce.",
              });

              continue;
            }

            // ====================================
            // VALIDAR SKU
            // ====================================

            const total=Number(raw.total);
            if(!Number.isFinite(total)||total<=0)throw new Error("Precio total inválido.");
            const legacyQty=Number(raw.quantity);
            const entries=Array.isArray(raw.items)&&raw.items.length?raw.items:
              [{sku:raw.sku||"",quantity:legacyQty,price:total/legacyQty}];
            if(!entries.length||entries.length>20)throw new Error("Demasiados artículos en el pedido.");
            const importedItems:Array<{sku:string;title:string;sale_gs:number;qty:number;provider_price_gs:number;provider_email:string}>=[];
            let subtotal=0,providerSubtotal=0;
            for(const item of entries){
              const sku=normalize(item.sku);
              if(!sku)throw new Error("Un artículo no tiene SKU.");
              const matches=(products||[]).filter(product=>normalize(product.sku)===sku);
              if(matches.length!==1)throw new Error(matches.length
                ? `El SKU "${item.sku}" está duplicado en E-commerce.`
                : `El SKU "${item.sku}" no existe en E-commerce.`);
              const product=matches[0];
              const privateProduct=product.is_private===true;
              const privateEmails=String(product.private_to_emails||"").split(",").map(normalize);
              const authorized=role==="admin"||role==="administrador"||
                (["provider","proveedor"].includes(role)&&normalize(product.provider_email)===email)||
                (["seller","vendedor"].includes(role)&&(!privateProduct||privateEmails.includes(email)));
              const listed=privateProduct||favoriteIds.has(product.id);
              if(!authorized||!listed)throw new Error(`El SKU "${item.sku}" no está disponible para este usuario.`);
              const qty=Number(item.quantity),unit=Number(item.price),providerPrice=Number(product.provider_price_gs||0);
              if(!Number.isSafeInteger(qty)||qty<=0||qty>100||!Number.isFinite(unit)||unit<=0)
                throw new Error(`Precio o cantidad inválidos para SKU "${item.sku}".`);
              if(!Number.isFinite(providerPrice)||providerPrice<0)
                throw new Error(`Costo de proveedor inválido para SKU "${item.sku}".`);
              const lineTotal=qty*unit;
              subtotal+=lineTotal;providerSubtotal+=providerPrice*qty;
              importedItems.push({sku:product.sku,title:product.title,sale_gs:lineTotal,qty,
                provider_price_gs:providerPrice,provider_email:product.provider_email||""});
            }
            if(Math.abs(subtotal-total)>0.02)
              throw new Error("La suma de artículos no coincide con el total registrado en BOT SKY.");

            // ====================================
            // VALIDAR CLIENTE
            // ====================================

            if (
              !raw.customer_name?.trim() ||
              !raw.phone?.trim() ||
              !raw.city?.trim()
            ) {
              throw new Error(
                "Faltan nombre, teléfono o ciudad del cliente."
              );
            }

            // ====================================
            // VALIDAR CIUDAD
            // ====================================

            const requestedCity =
              normalizeLocation(raw.city);

            const requestedDepartment =
              normalizeLocation(
                raw.departamento
              );

            const cityNameMatches = (
              (cities || []).filter((c: any) => c.active !== false)
            ).filter(
              (entry) =>
                normalizeLocation(entry.city) ===
                requestedCity
            );

            if (cityNameMatches.length === 0) {
              throw new Error(
                `La ciudad "${raw.city}" no existe en las tarifas de E-commerce.`
              );
            }

            // ====================================
            // VALIDAR DEPARTAMENTO
            // ====================================

            const cityMatches =
              cityNameMatches.filter(
                (entry) =>
                  departmentsMatch(
                    raw.city,
                    requestedDepartment,
                    entry.departamento
                  )
              );

            if (cityMatches.length === 0) {
              const departments = [
                ...new Set(
                  cityNameMatches.map(
                    (entry) =>
                      String(
                        entry.departamento || ""
                      )
                  )
                ),
              ].join(", ");

              throw new Error(
                `La ciudad "${raw.city}" existe, ` +
                  `pero el departamento "${raw.departamento}" ` +
                  `no coincide. Departamentos registrados: ` +
                  `${departments || "sin especificar"}.`
              );
            }

            if (cityMatches.length > 1) {
              throw new Error(
                `La ciudad "${raw.city}" tiene ` +
                  `${cityMatches.length} tarifas coincidentes. ` +
                  "Revisá los registros duplicados."
              );
            }

            const city = cityMatches[0];

            // ====================================
            // CALCULAR IMPORTES
            // ====================================

            const delivery = Number(
              city.price_gs || 0
            );

            if (!Number.isFinite(delivery) || delivery < 0)
              throw new Error(`Tarifa inválida para "${raw.city}".`);
            const commission=total-providerSubtotal-delivery;

            // ====================================
            // GENERAR NÚMERO VISIBLE
            // ====================================

            const ecommerceOrderNumber =
              makeOrderNumber(id);

            // ====================================
            // GUARDAR PEDIDO
            // ====================================

            const {
              data: inserted,
              error: insertError,
            } = await supabase
              .from("orders")
              .insert({
                order_number:
                  ecommerceOrderNumber,

                source_system: "BOT_SKY",
                source_order_id: id,

                created_by: profile.email,

                customer_name:
                  raw.customer_name.trim(),

                phone: raw.phone.trim(),

                city: city.city,

                departamento:
                  requestedCity === "asuncion" &&
                  isCapitalDepartment(
                    requestedDepartment
                  )
                    ? "Distrito Capital"
                    : city.departamento ||
                      raw.departamento ||
                      "",

                street: raw.street || "",
                district: raw.district || "",
                email: raw.email || "",

                obs: [
                  raw.obs,
                  `Pedido BOT SKY: ${
                    raw.order_number || id
                  }`,
                  `Pago: ${
                    raw.payment_method || ""
                  } / ${
                    raw.payment_status || ""
                  }`,
                  raw.receipt_url
                    ? `Comprobante: ${raw.receipt_url}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" | "),

                items_json: importedItems,

                total_gs: total,
                delivery_gs: delivery,
                commission_gs: commission,

                provider_emails_list: [...new Set(importedItems.map(item=>item.provider_email).filter(Boolean))].join(","),
              } as any)
              .select("id, order_number")
              .single();

            // ====================================
            // MANEJAR DUPLICADOS
            // ====================================

            if (insertError) {
              if (insertError.code === "23505") {
                const {
                  data: duplicate,
                  error: duplicateError,
                } = await supabase
                  .from("orders")
                  .select("id, order_number")
                  .eq("source_system", "BOT_SKY")
                  .eq("source_order_id", id)
                  .maybeSingle();

                if (
                  !duplicateError &&
                  duplicate
                ) {
                  results.push({
                    source_order_id: id,
                    status: "already_exists",
                    ecommerce_order_number:
                      duplicate.order_number || "",
                    message:
                      "Pedido ya cargado correctamente en E-commerce.",
                  });

                  continue;
                }
              }

              throw insertError;
            }

            if (!inserted?.id) {
              throw new Error(
                "No se pudo confirmar la creación del pedido."
              );
            }

            results.push({
              source_order_id: id,
              status: "created",
              ecommerce_order_number:
                inserted.order_number ||
                ecommerceOrderNumber,
              message:
                "Pedido creado correctamente en E-commerce.",
            });

          } catch (error: unknown) {
            results.push({
              source_order_id: id,
              status: "error",
              message: errorMessage(error),
            });
          }
        }

      } catch (error: unknown) {
        const processedIds = new Set(
          results.map(
            (result) => result.source_order_id
          )
        );

        for (
          const raw of msg.orders as SourceOrder[]
        ) {
          const id = String(
            raw.source_order_id || ""
          ).trim();

          if (processedIds.has(id)) {
            continue;
          }

          results.push({
            source_order_id: id,
            status: "error",
            message: errorMessage(error),
          });
        }
      }

      // ====================================
      // RESUMEN
      // ====================================

      const created = results.filter(
        (result) =>
          result.status === "created"
      ).length;

      const existing = results.filter(
        (result) =>
          result.status === "already_exists"
      ).length;

      const errors = results.filter(
        (result) =>
          result.status === "error"
      ).length;

      setReport(
        `Resultado: ${created} creados, ` +
          `${existing} ya cargados, ` +
          `${errors} errores.`
      );

      // ====================================
      // DETALLES INDIVIDUALES
      // ====================================

      setDetails(
        results.map((result) => ({
          id:
            result.source_order_id ||
            "(sin identificador)",

          status: result.status,

          ecommerceOrderNumber:
            result.ecommerce_order_number,

          reason:
            result.message ||
            (
              result.status === "created"
                ? "Pedido creado correctamente."
                : result.status === "already_exists"
                ? "Pedido ya cargado correctamente."
                : "Error desconocido."
            ),
        }))
      );

      // ====================================
      // RESPONDER A BOT SKY
      // ====================================

      window.opener?.postMessage(
        {
          channel,
          type: "RESULT",
          batchId: msg.batchId,
          results,
        },
        allowedOrigin
      );

      setWorking(false);
    };

    window.addEventListener(
      "message",
      onMessage
    );

    return () => {
      clearInterval(timer);

      window.removeEventListener(
        "message",
        onMessage
      );
    };
  }, [user, profile]);

  if (
    new URLSearchParams(
      window.location.search
    ).get("view") !== "import-botsky"
  ) {
    return null;
  }

  return (
    <div
      className="app-card mb-4 space-y-3 p-5"
      role="status"
    >
      <h2 className="font-bold">
        Importación BOT SKY
      </h2>

      <p>
        {!user
          ? "Iniciá sesión para continuar."
          : report}
      </p>

      {working && (
        <p>Guardando pedidos…</p>
      )}

      {details.length > 0 && (
        <div
          className="space-y-2"
          aria-label="Resultado por pedido"
        >
          {details.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              className="rounded-lg border p-3 text-sm"
            >
              <div
                className={
                  item.status === "error"
                    ? "font-semibold text-red-600"
                    : "font-semibold text-green-600"
                }
              >
                {item.status === "created"
                  ? "✅ Pedido creado correctamente"
                  : item.status === "already_exists"
                  ? "✅ Pedido ya cargado correctamente"
                  : "❌ Error de importación"}
              </div>

              <p className="mt-2 text-xs">
                <strong>Pedido BOT SKY:</strong>{" "}
                {item.id}
              </p>

              {item.ecommerceOrderNumber && (
                <p className="mt-1 text-xs">
                  <strong>
                    Pedido E-commerce:
                  </strong>{" "}
                  {item.ecommerceOrderNumber}
                </p>
              )}

              <p className="mt-2 break-words text-sm">
                {item.reason}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
