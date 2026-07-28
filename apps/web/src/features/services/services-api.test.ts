import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateServiceRecord } from './services-api';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('../../api/client.js', () => ({ fetchWithAuth }));

describe('updateServiceRecord', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
  });

  it('sends a tenant-authenticated PATCH and maps minor currency units', async () => {
    fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: 'service-id',
        name: 'Cut and finish',
        description: 'Wash, cut and finish.',
        duration: 45,
        price: 4250,
        category: 'Hair',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

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
    fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'The service could not be found.' },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }));

    await expect(updateServiceRecord('missing-service', {
      name: 'Missing',
      description: '',
      durationMin: 30,
      price: 10,
      category: 'General',
    })).rejects.toThrow('The service could not be found.');
  });
});
