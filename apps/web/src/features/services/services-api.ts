import { fetchWithAuth } from '../../api/client.js';
import type { Service } from '../../data/types.js';

export type ServiceInput = Omit<Service, 'id'>;

export async function updateServiceRecord(serviceId: string, service: ServiceInput): Promise<Service> {
  const response = await fetchWithAuth(`/api/v1/services/${serviceId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: service.name,
      description: service.description,
      duration: service.durationMin,
      price: Math.round(service.price * 100),
      category: service.category,
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.error?.message || 'Could not update service');
  }

  const updated = body.data;
  return {
    id: updated.id,
    name: updated.name,
    description: updated.description || '',
    price: updated.price / 100,
    durationMin: updated.duration,
    category: updated.category || service.category,
  };
}
