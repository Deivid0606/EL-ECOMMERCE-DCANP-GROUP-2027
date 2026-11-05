/** Store product aliases are scoped to the seller account, never to all stores. */
export type StoreProductMapping = {
  owner_email: string;
  title_key: string;
  raw_title: string;
  sku: string;
};

export const storeProductTitleKey = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function mappedStoreSku(
  rawTitle: string,
  mappings: readonly Pick<StoreProductMapping, 'title_key' | 'sku'>[],
): string | null {
  const key = storeProductTitleKey(rawTitle);
  if (!key) return null;
  const mapping = mappings.find(m => m.title_key === key);
  return mapping?.sku?.trim() || null;
}
