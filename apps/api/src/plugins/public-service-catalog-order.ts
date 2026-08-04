import type { FastifyInstance } from 'fastify';
import { getDatabase } from '@ks-os/database';
import { sql } from 'drizzle-orm';

type CatalogService = {
  id?: string;
  [key: string]: unknown;
};

type CatalogPayload = {
  services?: CatalogService[];
  [key: string]: unknown;
};

type ServiceOrderRow = {
  id: string;
  sort_order: number;
};

export function sortCatalogServices<T extends { id?: string }>(
  catalogServices: T[],
  orderRows: ServiceOrderRow[],
): T[] {
  const savedOrder = new Map(orderRows.map(row => [row.id, Number(row.sort_order)]));
  const originalOrder = new Map(catalogServices.map((service, index) => [service.id || '', index]));

  return [...catalogServices].sort((left, right) => {
    const leftId = left.id || '';
    const rightId = right.id || '';
    return (savedOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER)
      - (savedOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER)
      || (originalOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER)
      - (originalOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER);
  });
}

export default function registerPublicServiceCatalogOrder(fastify: FastifyInstance) {
  fastify.addHook('preSerialization', async (request, _reply, payload) => {
    const pathname = request.raw.url?.split('?')[0] || '';
    const isPublicCatalog = request.method === 'GET'
      && /^\/api\/v1\/public\/[^/]+\/catalog\/?$/.test(pathname);

    if (!isPublicCatalog || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const catalog = payload as CatalogPayload;
    if (!Array.isArray(catalog.services) || catalog.services.length < 2) {
      return payload;
    }

    const serviceIds = catalog.services
      .map(service => service.id)
      .filter((serviceId): serviceId is string => typeof serviceId === 'string');

    if (serviceIds.length < 2) {
      return payload;
    }

    const result = await getDatabase().execute(sql`
      select service.id, service.sort_order
      from services as service
      join jsonb_array_elements_text(${JSON.stringify(serviceIds)}::jsonb) as requested(id)
        on service.id = requested.id::uuid
      where service.is_active = true
    `);

    return {
      ...catalog,
      services: sortCatalogServices(
        catalog.services,
        result.rows as ServiceOrderRow[],
      ),
    };
  });
}
