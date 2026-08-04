import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteServiceRecord, reorderServiceRecords, updateServiceRecord } from './services-api';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('../../api/client.js', () => ({ fetchWithAuth }));

const jsonResponse = (body: unknown, ok: boolean) => ({
  ok,
  json: vi.fn().mockResolvedValue(body),
});

describe('services API', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
  });

  it('sends a tenant-authenticated PATCH and maps minor currency units', async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({
      data: {
        id: 'service-id',
        name: 'Cut and finish',
        description: 'Wash, cut and finish.',
        duration: 45,
        price: 4250,
        category: 'Hair',
      },
    }, true));

    const updated = await updateServiceRecord('service-id', {
      name: 'Cut and finish',
      description: 'Wash, cut and finish.',
      durationMin: 45,
      price: 42.5,
      category: 'Hair',
    });

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/services/service-id', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Cut and finish',
        description: 'Wash, cut and finish.',
        duration: 45,
        price: 4250,
        category: 'Hair',
      }),
    });
    expect(updated).toEqual({
      id: 'service-id',
      name: 'Cut and finish',
      description: 'Wash, cut and finish.',
      durationMin: 45,
      price: 42.5,
      category: 'Hair',
    });
  });

  it('persists the complete service order', async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({}, true));

    await reorderServiceRecords(['service-2', 'service-1']);

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/services/order', {
      method: 'PATCH',
      body: JSON.stringify({ serviceIds: ['service-2', 'service-1'] }),
    });
  });

  it('soft deletes a service through the authenticated API', async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({}, true));

    await deleteServiceRecord('service-id');

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/services/service-id', {
      method: 'DELETE',
    });
  });

  it('shows the API error message when saving fails', async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({
      error: { message: 'The service could not be found.' },
    }, false));

    await expect(updateServiceRecord('missing-service', {
      name: 'Missing',
      description: '',
      durationMin: 30,
      price: 10,
      category: 'General',
    })).rejects.toThrow('The service could not be found.');
  });

  it('shows the API error message when reordering fails', async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({
      error: { message: 'The service list changed. Refresh the page and try again.' },
    }, false));

    await expect(reorderServiceRecords(['stale-service'])).rejects.toThrow('The service list changed. Refresh the page and try again.');
  });
});
