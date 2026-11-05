/** Per-page WhatsApp purchase links. Never records an order as paid/placed. */
export function normalizeStoreWhatsAppNumber(raw: string): string | null {
  let digits = String(raw || "").replace(/\D/g, "");
  // Local Paraguay mobiles 09XXXXXXXX -> 5959XXXXXXXX.
  if (/^09\d{8}$/.test(digits)) digits = "595" + digits.slice(1);
  // Numbers typed without international prefix.
  else if (/^9\d{8}$/.test(digits)) digits = "595" + digits;
  else if (/^00595\d{9}$/.test(digits)) digits = digits.slice(2);
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

export function buildStoreWhatsAppLink(args: {
  number: string;
  productTitle: string;
  quantity: number;
  totalGs: number;
  pageUrl?: string;
}): string | null {
  const number = normalizeStoreWhatsAppNumber(args.number);
  if (!number) return null;
  const qty = Number.isFinite(args.quantity) && args.quantity >= 1 ? Math.floor(args.quantity) : 1;
  const price = Number.isFinite(args.totalGs) && args.totalGs >= 0 ? Math.round(args.totalGs) : 0;
  const nf = new Intl.NumberFormat("es-PY").format(price);
  const lines = [
    "¡Hola! Quiero consultar para comprar este producto:",
    "📦 " + (args.productTitle || "Producto"),
    "🔢 Cantidad: " + qty,
    "💰 Total indicado: Gs. " + nf,
    args.pageUrl ? "🔗 " + args.pageUrl : "",
    "¿Me confirmás disponibilidad y entrega? Gracias.",
  ].filter(Boolean);
  return "https://wa.me/" + number + "?text=" + encodeURIComponent(lines.join("\n"));
}

export function WhatsAppLogo({ size = 25 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 .5C7.45.5.5 7.44.5 16c0 2.73.72 5.41 2.09 7.77L.37 31.5l7.92-2.07A15.46 15.46 0 0 0 16 31.5c8.55 0 15.5-6.94 15.5-15.5S24.55.5 16 .5Zm0 28.36a12.8 12.8 0 0 1-6.51-1.78l-.47-.28-4.7 1.23 1.26-4.58-.31-.48A12.83 12.83 0 0 1 3.64 16C3.64 9.18 9.18 3.64 16 3.64S28.36 9.18 28.36 16 22.82 28.86 16 28.86Zm7.04-9.62c-.38-.19-2.25-1.11-2.6-1.24-.35-.13-.61-.19-.87.19-.26.38-.99 1.24-1.21 1.5-.22.26-.45.29-.83.1-.38-.19-1.6-.59-3.04-1.88-1.12-1-1.88-2.24-2.1-2.62-.22-.38-.02-.59.17-.78.17-.17.38-.45.57-.67.19-.22.26-.38.38-.64.13-.26.06-.48-.03-.67-.1-.19-.87-2.1-1.19-2.87-.31-.75-.63-.65-.87-.66h-.74c-.26 0-.67.1-1.02.48-.35.38-1.34 1.3-1.34 3.17s1.37 3.68 1.56 3.94c.19.26 2.69 4.11 6.53 5.77.91.39 1.62.63 2.18.8.92.29 1.76.25 2.42.15.74-.11 2.25-.92 2.57-1.81.32-.89.32-1.65.22-1.81-.1-.16-.35-.26-.74-.45Z"/>
    </svg>
  );
}
