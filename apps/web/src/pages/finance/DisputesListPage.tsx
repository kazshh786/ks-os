import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ShieldAlert, AlertTriangle } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';
import { DisputeListItem } from '@ks-os/contracts';
import { format } from 'date-fns';

export const DisputesListPage: React.FC = () => {
  const [disputes, setDisputes] = useState<DisputeListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDataProvider().getDisputes({ limit: 50 })
      .then(res => setDisputes(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  };

  const getStatusBadge = (status: string) => {
    if (status.includes('WON')) {
      return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full">Won</span>;
    }
    if (status.includes('LOST')) {
      return <span className="px-2.5 py-1 bg-rose-50 text-rose-700 text-xs font-bold rounded-full">Lost</span>;
    }
    if (status.includes('NEEDS_RESPONSE')) {
      return <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-full flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Action Required</span>;
    }
    return <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full">{status.replace(/_/g, ' ')}</span>;
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-6">
        <Link to="/app/finance" className="text-sm font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-4 w-fit">
          <ArrowLeft className="w-4 h-4" /> Back to Finance
        </Link>
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 text-rose-600" />
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Disputes</h1>
            <p className="text-slate-500 text-sm mt-1">Manage chargebacks and track dispute outcomes.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-extrabold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Reason</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Evidence Due</th>
                <th className="px-6 py-4">Booking Ref</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading disputes...</td>
                </tr>
              ) : disputes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">No disputes found. Great job!</td>
                </tr>
              ) : (
                disputes.map(dispute => (
                  <tr key={dispute.id} className="hover:bg-slate-50 transition group cursor-pointer">
                    <td className="px-6 py-4 font-black text-slate-900">
                      {formatCurrency(dispute.amount, dispute.currency)}
                    </td>
                    <td className="px-6 py-4 capitalize">
                      {dispute.reason.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(dispute.status)}
                    </td>
                    <td className="px-6 py-4 font-medium text-amber-700">
                      {dispute.evidenceDueBy ? format(new Date(dispute.evidenceDueBy), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono">
                      {dispute.bookingReference || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link to={`/app/finance/disputes/${dispute.id}`} className="text-indigo-600 font-bold text-sm hover:underline flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
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
