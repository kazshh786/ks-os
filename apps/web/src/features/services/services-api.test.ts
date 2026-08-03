import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateServiceRecord } from './services-api';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('../../api/client.js', () => ({ fetchWithAuth }));

const jsonResponse = (body: unknown, ok: boolean) => ({
  ok,
  json: vi.fn().mockResolvedValue(body),
});

describe('updateServiceRecord', () => {
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
});
