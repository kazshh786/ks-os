import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, DollarSign, Clock, CheckCircle2 } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';
import { PayoutListItem } from '@ks-os/contracts';
import { format } from 'date-fns';

export const PayoutsListPage: React.FC = () => {
  const [payouts, setPayouts] = useState<PayoutListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDataProvider().getPayouts({ limit: 50 })
      .then(res => setPayouts(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Paid</span>;
      case 'IN_TRANSIT':
        return <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-full flex items-center gap-1"><Clock className="w-3 h-3"/> In Transit</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full">{status}</span>;
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-6">
        <Link to="/app/finance" className="text-sm font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-4 w-fit">
          <ArrowLeft className="w-4 h-4" /> Back to Finance
        </Link>
        <h1 className="text-2xl font-extrabold text-slate-900">Payouts</h1>
        <p className="text-slate-500 text-sm mt-1">View your daily transfers and reconciliation history.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-extrabold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Arrival Date</th>
                <th className="px-6 py-4">Created At</th>
                <th className="px-6 py-4">Reconciliation</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading payouts...</td>
                </tr>
              ) : payouts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">No payouts found.</td>
                </tr>
              ) : (
                payouts.map(payout => (
                  <tr key={payout.id} className="hover:bg-slate-50 transition group cursor-pointer">
                    <td className="px-6 py-4 font-black text-slate-900">
                      {formatCurrency(payout.amount, payout.currency)}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(payout.status)}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {payout.arrivalDate ? format(new Date(payout.arrivalDate), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {format(new Date(payout.createdAt), 'MMM d, yyyy HH:mm')}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-bold ${payout.reconciliationStatus === 'MATCHED' ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {payout.reconciliationStatus}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-0.5">{payout.transactionCount} transactions</div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link to={`/app/finance/payouts/${payout.id}`} className="text-indigo-600 font-bold text-sm hover:underline flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                        Details <ArrowRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
