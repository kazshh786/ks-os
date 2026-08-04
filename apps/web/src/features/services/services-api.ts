import { fetchWithAuth } from '../../api/client.js';
import type { Service } from '../../data/types.js';

export type ServiceInput = Omit<Service, 'id'>;

const responseError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => ({}));
  return new Error(body?.error?.message || fallback);
};

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

  if (!response.ok) {
    throw await responseError(response, 'Could not update service');
  }

  const body = await response.json();
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

export async function reorderServiceRecords(serviceIds: string[]): Promise<void> {
  const response = await fetchWithAuth('/api/v1/services/order', {
    method: 'PATCH',
    body: JSON.stringify({ serviceIds }),
  });

  if (!response.ok) {
    throw await responseError(response, 'Could not save the service order');
  }
}

export async function deleteServiceRecord(serviceId: string): Promise<void> {
  const response = await fetchWithAuth(`/api/v1/services/${serviceId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw await responseError(response, 'Could not delete service');
  }
}
