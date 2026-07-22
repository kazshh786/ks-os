import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, AlertTriangle, ArrowRight, Activity, DollarSign, ShieldAlert } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';
import { StripeBalance } from '@ks-os/contracts';

export const FinanceOverviewPage: React.FC = () => {
  const [balance, setBalance] = useState<StripeBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDataProvider().getStripeBalance()
      .then(setBalance)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  };

  const totalAvailable = balance?.available.reduce((sum, b) => sum + b.amount, 0) || 0;
  const totalPending = balance?.pending.reduce((sum, b) => sum + b.amount, 0) || 0;

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Finance Overview</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your platform balances, payouts, and disputes.</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex gap-4 items-start shadow-sm">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-amber-900">Stripe-settled revenue vs Manual recorded revenue</h3>
          <p className="text-sm text-amber-800 mt-1">
            The balances shown below reflect funds processed through Stripe that are available for payout or currently in transit. 
            Cash or manual payments recorded in the POS are not included in your Stripe balance or automated payouts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-5">
            <Wallet className="w-24 h-24" />
          </div>
          <div className="relative z-10">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Available to Payout</h3>
            {loading ? (
              <div className="h-10 bg-slate-100 animate-pulse rounded w-1/3"></div>
            ) : (
              <div className="text-4xl font-black text-slate-900">
                {formatCurrency(totalAvailable, balance?.available[0]?.currency || 'gbp')}
              </div>
            )}
            <p className="text-xs text-slate-500 mt-2">Available funds will be included in your next automated payout.</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-5">
            <Activity className="w-24 h-24" />
          </div>
          <div className="relative z-10">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Pending Balance</h3>
            {loading ? (
              <div className="h-10 bg-slate-100 animate-pulse rounded w-1/3"></div>
            ) : (
              <div className="text-4xl font-black text-slate-900">
                {formatCurrency(totalPending, balance?.pending[0]?.currency || 'gbp')}
              </div>
            )}
            <p className="text-xs text-slate-500 mt-2">Funds from recent transactions currently clearing.</p>
          </div>
        </div>
      </div>

      <h2 className="text-lg font-bold text-slate-900 mb-4">Finance Actions</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/app/finance/payouts" className="bg-white rounded-xl p-5 border border-slate-200 hover:border-indigo-300 hover:shadow-md transition group flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition">View Payouts</h3>
              <p className="text-xs text-slate-500 mt-0.5">Track daily transfers to your bank account.</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 transition" />
        </Link>

        <Link to="/app/finance/disputes" className="bg-white rounded-xl p-5 border border-slate-200 hover:border-indigo-300 hover:shadow-md transition group flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition">Manage Disputes</h3>
              <p className="text-xs text-slate-500 mt-0.5">Monitor and respond to chargebacks.</p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 transition" />
        </Link>
      </div>
    </div>
  );
};
