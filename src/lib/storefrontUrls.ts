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

/** Existing pages retain old copied-link format. Only newly created pages opt into the store host. */
export function storePageShareUrl(page: {
  slug: string;
  config?: { linkDomainVersion?: string } | null;
}, legacyOrigin: string): string {
  if (page.config?.linkDomainVersion === "store-v1") {
    return storePublicProductUrl(page.slug);
  }
  return legacyOrigin.replace(/\/$/, "") + "/#/p/" + encodeURIComponent(page.slug);
}
