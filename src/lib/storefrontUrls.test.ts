import { describe, expect, it } from "vitest";
import { isStorePublicHostname, storePublicProductUrl, storePageShareUrl } from "./storefrontUrls";

describe("enlaces nuevos de Mi Tienda", () => {
  it("genera direcciones con dominio de tienda y nombre del producto", () => {
    expect(storePublicProductUrl("afeitadora-blade-pro"))
      .toBe("https://mitienda.el-ecommercedcanpgroup.com/afeitadora-blade-pro");
  });
  it("no cambia el enlace de páginas anteriores", () => {
    expect(storePageShareUrl({
      slug: "producto-antiguo", config: {}
    }, "https://www.el-ecommercedcanpgroup.com"))
      .toBe("https://www.el-ecommercedcanpgroup.com/#/p/producto-antiguo");
  });
  it("usa el dominio exclusivo solamente para páginas nuevas", () => {
    expect(storePageShareUrl({
      slug: "producto-nuevo", config: { linkDomainVersion: "store-v1" }
    }, "https://www.el-ecommercedcanpgroup.com"))
      .toBe("https://mitienda.el-ecommercedcanpgroup.com/producto-nuevo");
  });
  it("identifica solamente el dominio público de tiendas", () => {
    expect(isStorePublicHostname("mitienda.el-ecommercedcanpgroup.com")).toBe(true);
    expect(isStorePublicHostname("ecommerce20.vercel.app")).toBe(false);
    expect(isStorePublicHostname("www.el-ecommercedcanpgroup.com")).toBe(false);
  });
});
