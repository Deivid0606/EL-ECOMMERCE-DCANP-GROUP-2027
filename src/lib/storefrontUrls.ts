export const STORE_PUBLIC_HOST = "mitienda.el-ecommercedcanpgroup.com";
export const STORE_PUBLIC_ORIGIN = "https://" + STORE_PUBLIC_HOST;

/** Enlaces compartidos: la URL antigua con #/p/ continúa funcionando. */
export function storePublicProductUrl(slug: string): string {
  const safe = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
  return STORE_PUBLIC_ORIGIN + "/" + encodeURIComponent(safe);
}

export function isStorePublicHostname(hostname: string): boolean {
  return String(hostname || "").toLowerCase() === STORE_PUBLIC_HOST;
}
