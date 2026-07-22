import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, Calculator, AlertCircle } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';
import { PayoutDetailResponse } from '@ks-os/contracts';
import { format } from 'date-fns';

export const PayoutDetailPage: React.FC = () => {
  const { payoutId } = useParams<{ payoutId: string }>();
  const [data, setData] = useState<PayoutDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (payoutId) {
      getDataProvider().getPayoutDetail(payoutId)
        .then(setData)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [payoutId]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-bold">Loading payout details...</div>;
  }

  if (!data) {
    return <div className="p-8 text-center text-rose-500 font-bold">Payout not found.</div>;
  }

  const { payout, reconciliation, items } = data;

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  };

  const isMatched = reconciliation.status === 'MATCHED';

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-6">
        <Link to="/app/finance/payouts" className="text-sm font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-4 w-fit">
          <ArrowLeft className="w-4 h-4" /> Back to Payouts
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Payout Details</h1>
            <p className="text-slate-500 text-sm mt-1 font-mono">{payout.id}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-slate-900">{formatCurrency(payout.amount, payout.currency)}</div>
            <div className={`text-xs font-bold uppercase tracking-wider mt-1 ${payout.status === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
              {payout.status}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-slate-50 border-b border-slate-200 p-4">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-slate-500" />
              Reconciliation Breakdown
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Gross Payments Received</span>
                <span className="font-bold text-slate-900">{formatCurrency(reconciliation.grossPayments, payout.currency)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Refunds Processed</span>
                <span className="font-bold text-rose-600">-{formatCurrency(reconciliation.refunds, payout.currency)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Dispute Deductions</span>
                <span className="font-bold text-rose-600">-{formatCurrency(reconciliation.disputes, payout.currency)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Stripe Processing Fees</span>
                <span className="font-bold text-rose-600">-{formatCurrency(reconciliation.stripeFees, payout.currency)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Platform Application Fees</span>
                <span className="font-bold text-rose-600">-{formatCurrency(reconciliation.applicationFees, payout.currency)}</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-4">
                <span className="text-slate-600">Other Adjustments</span>
                <span className="font-bold text-slate-900">{formatCurrency(reconciliation.otherAdjustments, payout.currency)}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="font-extrabold text-slate-900">Calculated Net Payout</span>
                <span className="font-black text-lg text-slate-900">{formatCurrency(reconciliation.calculatedNet, payout.currency)}</span>
              </div>
            </div>
          </div>
          <div className={`p-4 border-t ${isMatched ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
            <div className="flex items-start gap-3">
              {isMatched ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                <h3 className={`text-sm font-bold ${isMatched ? 'text-emerald-900' : 'text-rose-900'}`}>
                  {isMatched ? 'Reconciliation Matched' : 'Reconciliation Mismatch'}
                </h3>
                <p className={`text-xs mt-1 ${isMatched ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {isMatched 
                    ? 'The calculated net amount exactly matches the payout amount received from Stripe.' 
                    : `There is a difference of ${formatCurrency(reconciliation.difference, payout.currency)} between the calculated net and actual payout amount.`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm h-fit">
          <div className="bg-slate-50 border-b border-slate-200 p-4">
            <h2 className="font-bold text-slate-800">Timeline</h2>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
                <div className="w-0.5 h-8 bg-slate-200 my-1"></div>
              </div>
              <div className="-mt-1.5">
                <p className="text-xs font-bold text-slate-900">Created</p>
                <p className="text-[10px] text-slate-500">{format(new Date(payout.createdAt), 'MMM d, yyyy HH:mm')}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full ${payout.status === 'PAID' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
              </div>
              <div className="-mt-1.5">
                <p className="text-xs font-bold text-slate-900">
                  {payout.status === 'PAID' ? 'Arrived in Bank' : 'Expected Arrival'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {payout.arrivalDate ? format(new Date(payout.arrivalDate), 'MMM d, yyyy') : 'Pending'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="bg-slate-50 border-b border-slate-200 p-4">
          <h2 className="font-bold text-slate-800">Included Transactions ({items.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/50 text-xs uppercase font-extrabold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Gross</th>
                <th className="px-6 py-3">Fee</th>
                <th className="px-6 py-3">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-3 text-slate-500">
                    {format(new Date(item.createdAt), 'MMM d, HH:mm')}
                  </td>
                  <td className="px-6 py-3">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase tracking-wider">
                      {item.sourceType}
                    </span>
                  </td>
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {formatCurrency(item.grossAmount, item.currency)}
                  </td>
                  <td className="px-6 py-3 text-rose-600">
                    -{formatCurrency(item.stripeFee, item.currency)}
                  </td>
                  <td className="px-6 py-3 font-bold text-slate-900">
                    {formatCurrency(item.netAmount, item.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
