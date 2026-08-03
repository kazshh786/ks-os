import { getDataProvider } from '../../data/data-provider.js';

const patchedProviders = new WeakSet<object>();

type PublicCatalogue = {
  services?: Array<{ id: string; category?: string | null }>;
};

type CategoryResponse = {
  services?: Array<{ id: string; category?: string | null }>;
};

export function ensurePublicCatalogCategoryEnrichment() {
  const provider = getDataProvider();
  if (patchedProviders.has(provider as object)) return;

  const getPublicCatalog = provider.getPublicCatalog.bind(provider);
  provider.getPublicCatalog = async (subdomain: string) => {
    const catalogue = await getPublicCatalog(subdomain) as PublicCatalogue;
    try {
      const response = await fetch(`/api/v1/public/${encodeURIComponent(subdomain)}/service-categories`);
      if (!response.ok) return catalogue;
      const body = await response.json() as CategoryResponse;
      const categoryByService = new Map((body.services || []).map(service => [service.id, service.category || 'General']));
      return {
        ...catalogue,
        services: (catalogue.services || []).map(service => ({
          ...service,
          category: categoryByService.get(service.id) || service.category || null,
        })),
      };
    } catch {
      return catalogue;
    }
  };

  patchedProviders.add(provider as object);
}
