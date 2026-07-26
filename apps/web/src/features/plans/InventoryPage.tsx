import { Boxes, PackageSearch, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';
import { useWorkspacePlan } from './WorkspacePlanContext.js';

export function InventoryPage() {
  const { summary } = useWorkspacePlan();
  return <section className="space-y-5">
    <header className="rounded-3xl bg-slate-950 p-6 text-white">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Growth operations</p>
      <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-black">Inventory</h1><span className="rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-black text-indigo-200">{summary?.availability['inventory.enabled'] === 'BETA' ? 'Beta' : 'Included'}</span></div>
      <p className="mt-2 max-w-2xl text-sm text-slate-300">Monitor product quantities and connect stock activity to checkout without changing booking services or customer records.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-3">
      <Link to="/app/reports/stock" className="rounded-2xl border bg-white p-5 hover:border-indigo-300"><Boxes className="h-6 w-6 text-indigo-600" /><h2 className="mt-3 font-black">Current stock</h2><p className="mt-1 text-sm text-slate-500">Review in-stock, low-stock and out-of-stock products.</p></Link>
      <Link to="/app/reports/products" className="rounded-2xl border bg-white p-5 hover:border-indigo-300"><PackageSearch className="h-6 w-6 text-indigo-600" /><h2 className="mt-3 font-black">Product performance</h2><p className="mt-1 text-sm text-slate-500">See product sales and recorded stock quantities.</p></Link>
      <Link to="/app/pos" className="rounded-2xl border bg-white p-5 hover:border-indigo-300"><ShoppingCart className="h-6 w-6 text-indigo-600" /><h2 className="mt-3 font-black">Point of sale</h2><p className="mt-1 text-sm text-slate-500">Sell products and services through the live checkout.</p></Link>
    </div>
  </section>;
}
