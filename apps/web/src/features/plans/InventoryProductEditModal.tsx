import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Product, UpdateProductRequest } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';

interface InventoryProductEditModalProps {
  product: Product | null;
  onClose: () => void;
  onSaved: (product: Product) => Promise<void>;
}

async function updateProduct(productId: string, payload: UpdateProductRequest): Promise<Product> {
  const response = await fetchWithAuth(`/api/v1/products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || 'Product could not be updated.');
  return body.data as Product;
}

export function InventoryProductEditModal({ product, onClose, onSaved }: InventoryProductEditModalProps) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setSku(product.sku);
    setPrice((product.priceInCents / 100).toFixed(2));
    setError('');
  }, [product]);

  if (!product) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceNumber = Number(price);
    if (!name.trim() || !sku.trim() || !Number.isFinite(priceNumber) || priceNumber < 0) {
      setError('Enter a product name, SKU and valid selling price.');
      return;
    }

    const payload: UpdateProductRequest = {
      name: name.trim(),
      sku: sku.trim().toUpperCase(),
      priceInCents: Math.round(priceNumber * 100),
    };

    setSaving(true);
    setError('');
    try {
      await onSaved(await updateProduct(product.id, payload));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Product could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${product.name}`}
        className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl sm:p-6"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-950">Edit product</h2>
            <p className="mt-1 text-sm text-slate-500">Update the product details shown in Inventory and the POS.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Edit product" className="rounded-xl border p-2">
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold sm:col-span-2">
            Product name
            <input required value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" />
          </label>
          <label className="text-sm font-bold">
            SKU
            <input required value={sku} onChange={event => setSku(event.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border p-3 font-mono font-normal" />
          </label>
          <label className="text-sm font-bold">
            Selling price (£)
            <input required type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" />
          </label>
          <div className="rounded-xl bg-slate-50 p-4 text-sm sm:col-span-2">
            <p className="font-black text-slate-900">Current stock: {product.stockQuantity} units</p>
            <p className="mt-1 text-slate-500">Use Adjust stock from the inventory list to change quantities.</p>
          </div>
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800 sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 font-bold">Cancel</button>
            <button disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
