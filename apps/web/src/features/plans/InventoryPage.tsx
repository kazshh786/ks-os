import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Download,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import type { CreateProductRequest, Product, ProductImportResult } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';
import { useWorkspacePlan } from './WorkspacePlanContext.js';
import { inventoryCsvTemplate, parseInventoryCsv } from './inventory-csv.js';

async function inventoryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Inventory could not be updated.');
  return body.data as T;
}

const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100);

export function InventoryPage() {
  const { summary } = useWorkspacePlan();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProducts(await inventoryRequest<Product[]>('/api/v1/products?limit=100'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter(product => `${product.name} ${product.sku}`.toLowerCase().includes(query));
  }, [products, search]);

  const totalUnits = products.reduce((total, product) => total + product.stockQuantity, 0);
  const lowStock = products.filter(product => product.stockQuantity > 0 && product.stockQuantity <= 5).length;
  const outOfStock = products.filter(product => product.stockQuantity === 0).length;

  const completed = async (successMessage: string) => {
    setMessage(successMessage);
    setError('');
    await load();
  };

  return <main className="space-y-5">
    <header className="rounded-3xl bg-slate-950 p-6 text-white">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Growth operations</p>
          <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-black">Inventory</h1><span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-black text-indigo-200">{summary?.availability['inventory.enabled'] === 'BETA' ? 'Beta' : 'Included'}</span></div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Add products, import a CSV and keep stock quantities accurate for point-of-sale checkout.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-black hover:bg-white/15"><Upload className="h-4 w-4" />Import CSV</button>
          <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-black hover:bg-indigo-400"><Plus className="h-4 w-4" />Add product</button>
        </div>
      </div>
    </header>

    {(message || error) && <div role={error ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span>{error || message}</span><button type="button" onClick={() => { setError(''); setMessage(''); }} aria-label="Dismiss message"><X className="h-4 w-4" /></button></div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Products" value={products.length} detail="Active inventory lines" />
      <Metric label="Units on hand" value={totalUnits} detail="Across all products" />
      <Metric label="Low stock" value={lowStock} detail="Five units or fewer" warning={lowStock > 0} />
      <Metric label="Out of stock" value={outOfStock} detail="Needs replenishment" warning={outOfStock > 0} />
    </section>

    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-black text-slate-950">Current stock</h2><p className="mt-1 text-xs text-slate-500">Create a product or adjust the quantity already on hand.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 sm:w-72"><span className="sr-only">Search inventory</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search product or SKU" className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </header>

      {loading && products.length === 0 ? <div className="grid min-h-64 place-items-center text-slate-400"><RefreshCw className="h-7 w-7 animate-spin" /><span className="sr-only">Loading inventory</span></div>
        : filtered.length === 0 ? <div className="grid min-h-64 place-items-center p-8 text-center"><div><Boxes className="mx-auto h-10 w-10 text-slate-300" /><h3 className="mt-3 font-black text-slate-900">{products.length ? 'No matching products' : 'No products yet'}</h3><p className="mt-1 text-sm text-slate-500">{products.length ? 'Try another product name or SKU.' : 'Add a product manually or import your current stock from CSV.'}</p>{!products.length && <button type="button" onClick={() => setAddOpen(true)} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">Add first product</button>}</div></div>
          : <>
            <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Product</th><th className="px-5 py-3">SKU</th><th className="px-5 py-3">Selling price</th><th className="px-5 py-3">On hand</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(product => <tr key={product.id} className="hover:bg-slate-50"><td className="px-5 py-4 font-bold text-slate-950">{product.name}</td><td className="px-5 py-4 font-mono text-xs text-slate-500">{product.sku}</td><td className="px-5 py-4 font-semibold">{money(product.priceInCents)}</td><td className="px-5 py-4"><StockBadge quantity={product.stockQuantity} /></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => setAdjusting(product)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:border-indigo-300 hover:text-indigo-700">Adjust stock</button></td></tr>)}</tbody></table></div>
            <div className="divide-y divide-slate-100 md:hidden">{filtered.map(product => <article key={product.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-black text-slate-950">{product.name}</h3><p className="mt-1 truncate font-mono text-xs text-slate-500">{product.sku}</p></div><StockBadge quantity={product.stockQuantity} /></div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm font-black text-slate-800">{money(product.priceInCents)}</p><button type="button" onClick={() => setAdjusting(product)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black">Adjust stock</button></div></article>)}</div>
          </>}
    </section>

    <div className="flex flex-wrap gap-3 text-sm"><Link to="/app/reports/stock" className="font-bold text-indigo-700 underline">Open stock report</Link><Link to="/app/reports/products" className="font-bold text-indigo-700 underline">Open product performance</Link><Link to="/app/pos" className="font-bold text-indigo-700 underline">Open point of sale</Link></div>

    <ProductModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={async product => { setAddOpen(false); await completed(`${product.name} was added to inventory.`); }} />
    <StockAdjustmentModal product={adjusting} onClose={() => setAdjusting(null)} onSaved={async product => { setAdjusting(null); await completed(`${product.name} now has ${product.stockQuantity} units on hand.`); }} />
    <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={async result => { setImportOpen(false); await completed(`Import complete: ${result.created} created and ${result.updated} updated.`); }} />
  </main>;
}

function Metric({ label, value, detail, warning = false }: { label: string; value: number; detail: string; warning?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 ${warning ? 'border-amber-200' : 'border-slate-200'}`}><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${warning ? 'text-amber-700' : 'text-slate-950'}`}>{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function StockBadge({ quantity }: { quantity: number }) {
  const tone = quantity === 0 ? 'bg-rose-100 text-rose-800' : quantity <= 5 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tone}`}>{quantity} units</span>;
}

function ModalShell({ title, description, open, onClose, children }: { title: string; description: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl sm:p-6"><header className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div><button type="button" onClick={onClose} aria-label={`Close ${title}`} className="rounded-xl border p-2"><X className="h-5 w-5" /></button></header>{children}</section></div>;
}

function ProductModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (product: Product) => Promise<void> }) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setName(''); setSku(''); setPrice(''); setStock('0'); setError(''); }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceNumber = Number(price);
    const stockNumber = Number(stock);
    if (!name.trim() || !sku.trim() || !Number.isFinite(priceNumber) || priceNumber < 0 || !Number.isInteger(stockNumber) || stockNumber < 0) {
      setError('Enter a name, SKU, valid selling price and whole-number stock quantity.');
      return;
    }
    setSaving(true); setError('');
    try {
      const product = await inventoryRequest<Product>('/api/v1/products', { method: 'POST', body: JSON.stringify({ name: name.trim(), sku: sku.trim(), priceInCents: Math.round(priceNumber * 100), stockQuantity: stockNumber }) });
      await onSaved(product);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Product could not be added.'); }
    finally { setSaving(false); }
  };

  return <ModalShell open={open} onClose={onClose} title="Add product" description="Create a retail product and record its opening stock."><form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold sm:col-span-2">Product name<input required value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">SKU<input required value={sku} onChange={event => setSku(event.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border p-3 font-mono font-normal" /></label><label className="text-sm font-bold">Selling price (£)<input required type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold sm:col-span-2">Opening stock<input required type="number" min="0" step="1" value={stock} onChange={event => setStock(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800 sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 font-bold">Cancel</button><button disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white disabled:opacity-50">{saving ? 'Adding…' : 'Add product'}</button></div></form></ModalShell>;
}

function StockAdjustmentModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: (product: Product) => Promise<void> }) {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('Stock count');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (product) { setDirection('add'); setQuantity('1'); setReason('Stock count'); setError(''); } }, [product]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!product) return;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount <= 0) { setError('Enter a whole number greater than zero.'); return; }
    setSaving(true); setError('');
    try {
      const updated = await inventoryRequest<Product>(`/api/v1/products/${product.id}/stock-adjustments`, { method: 'POST', body: JSON.stringify({ adjustment: direction === 'add' ? amount : -amount, reason: reason.trim() || undefined }) });
      await onSaved(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Stock could not be adjusted.'); }
    finally { setSaving(false); }
  };

  return <ModalShell open={Boolean(product)} onClose={onClose} title={`Adjust ${product?.name || 'stock'}`} description={`Current quantity: ${product?.stockQuantity || 0} units.`}><form onSubmit={submit} className="mt-6 space-y-4"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setDirection('add')} className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-black ${direction === 'add' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : ''}`}><ArrowDownToLine className="h-4 w-4" />Add stock</button><button type="button" onClick={() => setDirection('remove')} className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-black ${direction === 'remove' ? 'border-rose-300 bg-rose-50 text-rose-800' : ''}`}><ArrowUpFromLine className="h-4 w-4" />Remove stock</button></div><label className="block text-sm font-bold">Quantity<input required type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="block text-sm font-bold">Reason<input value={reason} maxLength={255} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 font-bold">Cancel</button><button disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save adjustment'}</button></div></form></ModalShell>;
}

function ImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (result: ProductImportResult) => Promise<void> }) {
  const [products, setProducts] = useState<CreateProductRequest[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setProducts([]); setErrors([]); setFileName(''); setError(''); } }, [open]);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    const parsed = parseInventoryCsv(await file.text());
    setProducts(parsed.products);
    setErrors(parsed.errors);
    setError('');
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([inventoryCsvTemplate], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'inventory-template.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  const submit = async () => {
    if (!products.length || errors.length) return;
    setSaving(true); setError('');
    try {
      await onImported(await inventoryRequest<ProductImportResult>('/api/v1/products/import', { method: 'POST', body: JSON.stringify({ products }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Products could not be imported.'); }
    finally { setSaving(false); }
  };

  return <ModalShell open={open} onClose={onClose} title="Import inventory CSV" description="Create new products or update matching SKUs with the quantities in your file."><div className="mt-6 space-y-4"><div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center"><Upload className="mx-auto h-8 w-8 text-slate-400" /><label className="mt-3 inline-flex cursor-pointer rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={event => void chooseFile(event.target.files?.[0])} /></label><p className="mt-2 text-xs text-slate-500">Required columns: name, sku, price, stock_quantity</p><button type="button" onClick={downloadTemplate} className="mt-3 inline-flex items-center gap-2 text-xs font-black text-indigo-700 underline"><Download className="h-3.5 w-3.5" />Download template</button></div>{fileName && <p className="text-sm font-bold text-slate-700">File: {fileName}</p>}{errors.length > 0 && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-center gap-2 font-black text-rose-800"><AlertTriangle className="h-4 w-4" />Fix these CSV rows</div><ul className="mt-2 max-h-36 list-disc overflow-auto pl-5 text-sm text-rose-700">{errors.map(item => <li key={item}>{item}</li>)}</ul></div>}{products.length > 0 && !errors.length && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-black text-emerald-900">{products.length} product{products.length === 1 ? '' : 's'} ready</p><div className="mt-3 max-h-52 overflow-auto rounded-lg bg-white"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Product</th><th className="p-2">SKU</th><th className="p-2">Price</th><th className="p-2">Stock</th></tr></thead><tbody>{products.slice(0, 20).map(product => <tr key={product.sku} className="border-t"><td className="p-2 font-bold">{product.name}</td><td className="p-2 font-mono">{product.sku}</td><td className="p-2">{money(product.priceInCents)}</td><td className="p-2">{product.stockQuantity}</td></tr>)}</tbody></table></div>{products.length > 20 && <p className="mt-2 text-xs text-emerald-800">Showing the first 20 rows.</p>}</div>}{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 font-bold">Cancel</button><button type="button" onClick={() => void submit()} disabled={saving || !products.length || errors.length > 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white disabled:opacity-50"><PackagePlus className="h-4 w-4" />{saving ? 'Importing…' : 'Import products'}</button></div></div></ModalShell>;
}
