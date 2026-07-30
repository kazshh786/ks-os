import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryPage } from './InventoryPage.js';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('../../api/client.js', () => ({ fetchWithAuth }));
vi.mock('./WorkspacePlanContext.js', () => ({
  useWorkspacePlan: () => ({ summary: { availability: { 'inventory.enabled': 'AVAILABLE' } } }),
}));

const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Shampoo', sku: 'SHP-001', priceInCents: 1250, stockQuantity: 8 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('InventoryPage', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/products?')) return Promise.resolve(response({ success: true, data: [product] }));
      if (url === '/api/v1/products' && init?.method === 'POST') return Promise.resolve(response({ success: true, data: { ...product, id: '22222222-2222-4222-8222-222222222222', name: 'Conditioner', sku: 'CON-001' } }, 201));
      if (url.endsWith('/stock-adjustments')) return Promise.resolve(response({ success: true, data: { ...product, stockQuantity: 10 } }));
      return Promise.resolve(response({ success: true, data: [] }));
    });
  });

  it('shows live stock and opens manual and CSV workflows', async () => {
    render(<MemoryRouter><InventoryPage /></MemoryRouter>);
    expect(await screen.findByText('Shampoo')).toBeInTheDocument();
    expect(screen.getAllByText('8 units').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    expect(screen.getByRole('dialog', { name: 'Add product' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Add product' }));

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(screen.getByRole('dialog', { name: 'Import inventory CSV' })).toBeInTheDocument();
    expect(screen.getByText(/Required columns: name, sku, price, stock_quantity/)).toBeInTheDocument();
  });

  it('creates a product and adjusts existing stock through the API', async () => {
    render(<MemoryRouter><InventoryPage /></MemoryRouter>);
    await screen.findByText('Shampoo');

    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    const addDialog = screen.getByRole('dialog', { name: 'Add product' });
    fireEvent.change(within(addDialog).getByLabelText('Product name'), { target: { value: 'Conditioner' } });
    fireEvent.change(within(addDialog).getByLabelText('SKU'), { target: { value: 'CON-001' } });
    fireEvent.change(within(addDialog).getByLabelText('Selling price (£)'), { target: { value: '9.99' } });
    fireEvent.change(within(addDialog).getByLabelText('Opening stock'), { target: { value: '5' } });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add product' }));

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith('/api/v1/products', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Conditioner', sku: 'CON-001', priceInCents: 999, stockQuantity: 5 }),
    })));

    fireEvent.click(screen.getAllByRole('button', { name: 'Adjust stock' })[0]);
    const adjustDialog = screen.getByRole('dialog', { name: 'Adjust Shampoo' });
    fireEvent.change(within(adjustDialog).getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.click(within(adjustDialog).getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith(`/api/v1/products/${product.id}/stock-adjustments`, expect.objectContaining({ method: 'POST' })));
  });
});
