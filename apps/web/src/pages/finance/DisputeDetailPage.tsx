import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ShieldAlert, AlertTriangle, Clock } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';
import { DisputeDetailResponse } from '@ks-os/contracts';
import { format } from 'date-fns';

export const DisputeDetailPage: React.FC = () => {
  const { disputeId } = useParams<{ disputeId: string }>();
  const [data, setData] = useState<DisputeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (disputeId) {
      getDataProvider().getDisputeDetail(disputeId)
        .then(setData)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [disputeId]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-bold">Loading dispute details...</div>;
  }

  if (!data) {
    return <div className="p-8 text-center text-rose-500 font-bold">Dispute not found.</div>;
  }

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  };

  const isActionRequired = data.actionRequired && data.status.includes('NEEDS_RESPONSE');

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="mb-6">
        <Link to="/app/finance/disputes" className="text-sm font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-4 w-fit">
          <ArrowLeft className="w-4 h-4" /> Back to Disputes
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${isActionRequired ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">Dispute Details</h1>
              <p className="text-slate-500 text-sm mt-1 font-mono">{data.id}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-rose-600">{formatCurrency(data.amount, data.currency)}</div>
            <div className="text-xs font-bold uppercase tracking-wider mt-1 text-slate-500">
              Disputed Amount
            </div>
          </div>
        </div>
      </div>

      {isActionRequired && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 mb-8 flex gap-4 items-start shadow-sm">
          <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-base font-bold text-rose-900">Action Required: Submit Evidence</h3>
            <p className="text-sm text-rose-800 mt-1 mb-4">
              You must submit evidence by <span className="font-bold">{data.evidenceDueBy ? format(new Date(data.evidenceDueBy), 'MMM d, yyyy') : 'the due date'}</span> to challenge this dispute. Failure to do so will result in an automatic loss.
            </p>
            {data.dashboardUrl && (
              <a 
                href={data.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-lg transition shadow-sm"
              >
                Submit Evidence in Stripe <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <p className="text-xs text-rose-700 mt-3 italic">Note: Evidence submission is handled securely via the Stripe Dashboard.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-slate-50 border-b border-slate-200 p-4">
            <h2 className="font-bold text-slate-800">Dispute Information</h2>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase">Status</p>
              <p className="font-medium text-slate-900 mt-1">{data.status.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase">Reason</p>
              <p className="font-medium text-slate-900 mt-1 capitalize">{data.reason.replace(/_/g, ' ')}</p>
            </div>
            {data.payoutImpact !== null && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Payout Impact (inc. fees)</p>
                <p className="font-black text-rose-600 mt-1">{formatCurrency(Math.abs(data.payoutImpact), data.currency)}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase">Booking Reference</p>
              <p className="font-mono text-indigo-600 mt-1">{data.bookingReference || 'N/A'}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-slate-50 border-b border-slate-200 p-4">
            <h2 className="font-bold text-slate-800">Timeline</h2>
          </div>
          <div className="p-4 space-y-4">
            {data.timeline.map((event, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500"></div>
                  {i < data.timeline.length - 1 && <div className="w-0.5 h-8 bg-slate-200 my-1"></div>}
                </div>
                <div className="-mt-1.5 pb-2">
                  <p className="text-sm font-bold text-slate-900">{event.description}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(event.date), 'MMM d, yyyy HH:mm')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
