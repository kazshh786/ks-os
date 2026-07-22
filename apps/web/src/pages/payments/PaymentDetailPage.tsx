import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PaymentDetailResponse, CreateRefundRequest } from '@ks-os/contracts';
import { getDataProvider } from '../../data/data-provider';
import { RefundModal } from './RefundModal';
import { ChevronLeft } from 'lucide-react';

export const PaymentDetailPage: React.FC = () => {
  const { transactionId } = useParams<{ transactionId: string }>();
  const [payment, setPayment] = useState<PaymentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefundModalOpen, setRefundModalOpen] = useState(false);

  useEffect(() => {
    if (transactionId) {
      loadPaymentDetail(transactionId);
    }
  }, [transactionId]);

  const loadPaymentDetail = async (id: string) => {
    setLoading(true);
    try {
      const provider = getDataProvider();
      const data = await provider.getPaymentDetail(id);
      setPayment(data);
    } catch (err) {
      console.error(err);
      alert('Failed to load payment details');
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (request: CreateRefundRequest) => {
    if (!transactionId || !payment) return;
    const provider = getDataProvider();
    await provider.createRefund(transactionId, request);
    await loadPaymentDetail(transactionId);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading details...</div>;
  }

  if (!payment) {
    return <div className="p-8 text-center text-red-500">Payment not found</div>;
  }

  const isStripe = payment.paymentSource === 'STRIPE_ONLINE';
  const canRefund = isStripe && payment.refundableAmount > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link to="/app/payments" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 mb-6 transition-colors">
        <ChevronLeft className="w-4 h-4 mr-1" />
        Back to Payments
      </Link>

      <div className="bg-white shadow rounded-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 sm:flex sm:items-center sm:justify-between bg-slate-50">
          <div>
            <h3 className="text-lg leading-6 font-medium text-slate-900">
              Payment Details
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Transaction ID: <span className="font-mono">{payment.transactionId}</span>
            </p>
          </div>
          <div className="mt-4 sm:mt-0">
            {canRefund ? (
              <button
                onClick={() => setRefundModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Issue Refund
              </button>
            ) : (
              <span className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-slate-100 text-slate-500 border border-slate-200">
                {!isStripe ? 'External Payment (Refunds must be completed through original provider)' : 'Fully Refunded'}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-slate-500">Amount</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">
                {(payment.amount / 100).toFixed(2)} {payment.currency}
              </dd>
            </div>
            
            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-slate-500">Status</dt>
              <dd className="mt-1 text-sm text-slate-900 font-medium">
                {payment.paymentStatus}
              </dd>
            </div>

            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-slate-500">Date</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {new Date(payment.createdAt).toLocaleString()}
              </dd>
            </div>

            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-slate-500">Client</dt>
              <dd className="mt-1 text-sm text-slate-900">{payment.clientDisplayName || 'Guest'}</dd>
            </div>

            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-slate-500">Service/Booking</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {payment.serviceName || '-'} 
                {payment.bookingReference && <span className="text-slate-500 ml-1">({payment.bookingReference})</span>}
              </dd>
            </div>

            <div className="sm:col-span-1">
              <dt className="text-sm font-medium text-slate-500">Payment Source</dt>
              <dd className="mt-1 text-sm text-slate-900">
                {payment.paymentSource} <span className="text-slate-500">({payment.paymentMethod})</span>
              </dd>
            </div>

            <div className="sm:col-span-3 border-t border-slate-200 pt-6 mt-2">
              <h4 className="text-sm font-medium text-slate-900 mb-4">Financial Breakdown</h4>
              <div className="bg-slate-50 rounded-lg p-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-sm font-medium text-slate-500">Total Amount</dt>
                  <dd className="mt-1 text-lg font-medium text-slate-900">{(payment.amount / 100).toFixed(2)} {payment.currency}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-slate-500">Refunded</dt>
                  <dd className="mt-1 text-lg font-medium text-amber-600">{(payment.refundedAmount / 100).toFixed(2)} {payment.currency}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-slate-500">Available to Refund</dt>
                  <dd className="mt-1 text-lg font-medium text-green-600">{(payment.refundableAmount / 100).toFixed(2)} {payment.currency}</dd>
                </div>
              </div>
            </div>
          </dl>
        </div>

        {/* Refund History */}
        {payment.refundHistory.length > 0 && (
          <div className="border-t border-slate-200 px-6 py-5 bg-slate-50">
            <h4 className="text-sm font-medium text-slate-900 mb-4">Refund History</h4>
            <ul className="space-y-4">
              {payment.refundHistory.map(refund => (
                <li key={refund.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {(refund.amount / 100).toFixed(2)} {refund.currency} Refund
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Reason: {refund.reason} • By: {refund.requestedByUserName || 'System'}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
                        {refund.status}
                      </span>
                      <p className="text-xs text-slate-500 mt-1">
                        {new Date(refund.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <RefundModal
        isOpen={isRefundModalOpen}
        onClose={() => setRefundModalOpen(false)}
        onConfirm={handleRefund}
        maxRefundableAmount={payment.refundableAmount}
        currency={payment.currency}
      />
    </div>
  );
};
