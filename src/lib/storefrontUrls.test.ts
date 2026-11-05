import { describe, expect, it } from "vitest";
import { isStorePublicHostname, storePublicProductUrl } from "./storefrontUrls";

describe("enlaces nuevos de Mi Tienda", () => {
  it("genera direcciones con dominio de tienda y nombre del producto", () => {
    expect(storePublicProductUrl("afeitadora-blade-pro"))
      .toBe("https://mitienda.el-ecommercedcanpgroup.com/afeitadora-blade-pro");
  });
  it("identifica solamente el dominio público de tiendas", () => {
    expect(isStorePublicHostname("mitienda.el-ecommercedcanpgroup.com")).toBe(true);
    expect(isStorePublicHostname("ecommerce20.vercel.app")).toBe(false);
    expect(isStorePublicHostname("www.el-ecommercedcanpgroup.com")).toBe(false);
  });
});
