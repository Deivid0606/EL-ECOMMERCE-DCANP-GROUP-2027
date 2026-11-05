import { describe, expect, it } from "vitest";
import { buildStoreWhatsAppLink, normalizeStoreWhatsAppNumber } from "./storeWhatsApp";

describe("WhatsApp checkout de Mi Tienda", () => {
  it("acepta números móviles paraguayos en formato nacional o internacional", () => {
    expect(normalizeStoreWhatsAppNumber("0981 123 456")).toBe("595981123456");
    expect(normalizeStoreWhatsAppNumber("+595 981 123 456")).toBe("595981123456");
    expect(normalizeStoreWhatsAppNumber("981123456")).toBe("595981123456");
  });

  it("rechaza números inválidos sin generar enlaces", () => {
    expect(normalizeStoreWhatsAppNumber("123")).toBeNull();
    expect(buildStoreWhatsAppLink({ number: "123", productTitle: "Producto", quantity: 1, totalGs: 100000 })).toBeNull();
  });

  it("precarga producto, cantidad, precio y URL sin registrar el pedido", () => {
    const link = buildStoreWhatsAppLink({
      number: "0981123456",
      productTitle: "Afeitadora Blade Pro",
      quantity: 2,
      totalGs: 258000,
      pageUrl: "https://ejemplo.com/#/p/afeitadora",
    });
    expect(link?.startsWith("https://wa.me/595981123456?text=")).toBe(true);
    const text = decodeURIComponent((link || "").split("text=")[1] || "");
    expect(text).toContain("Afeitadora Blade Pro");
    expect(text).toContain("Cantidad: 2");
    expect(text).toContain("258.000");
    expect(text).toContain("https://ejemplo.com/#/p/afeitadora");
  });
});
