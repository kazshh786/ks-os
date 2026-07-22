import React, { useState } from 'react';
import { CreateRefundRequest } from '@ks-os/contracts';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (request: CreateRefundRequest) => Promise<void>;
  maxRefundableAmount: number;
  currency: string;
}

export const RefundModal: React.FC<RefundModalProps> = ({ isOpen, onClose, onConfirm, maxRefundableAmount, currency }) => {
  const [refundType, setRefundType] = useState<'full' | 'partial'>('full');
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [reason, setReason] = useState<CreateRefundRequest['reason']>('requested_by_customer');
  const [internalNote, setInternalNote] = useState<string>('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    let amountToRefund: number | undefined;
    if (refundType === 'partial') {
      const parsed = parseFloat(partialAmount);
      if (isNaN(parsed) || parsed <= 0 || parsed * 100 > maxRefundableAmount) {
        alert('Invalid refund amount');
        setLoading(false);
        return;
      }
      amountToRefund = Math.round(parsed * 100);
    } else {
      amountToRefund = maxRefundableAmount; // full refund
    }

    try {
      await onConfirm({
        amount: amountToRefund,
        reason,
        internalNote: internalNote || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to process refund');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden">
        <div className="p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Issue Refund</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Refund Type</label>
              <div className="flex space-x-4">
                <label className="flex items-center">
                  <input 
                    type="radio" 
                    name="refundType" 
                    value="full"
                    checked={refundType === 'full'}
                    onChange={() => setRefundType('full')}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="ml-2 text-sm text-slate-700">
                    Full ({(maxRefundableAmount / 100).toFixed(2)} {currency})
                  </span>
                </label>
                <label className="flex items-center">
                  <input 
                    type="radio" 
                    name="refundType" 
                    value="partial"
                    checked={refundType === 'partial'}
                    onChange={() => setRefundType('partial')}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="ml-2 text-sm text-slate-700">Partial</span>
                </label>
              </div>
            </div>

            {refundType === 'partial' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Amount to Refund ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={maxRefundableAmount / 100}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as CreateRefundRequest['reason'])}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              >
                <option value="requested_by_customer">Requested by customer</option>
                <option value="duplicate">Duplicate</option>
                <option value="fraudulent">Fraudulent</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Internal Note (optional)</label>
              <textarea
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Reason for refund..."
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 p-3 rounded-md">
              <p className="text-xs text-amber-800">
                <strong>Note:</strong> Stripe processing fees from the original charge are not returned when you issue a refund. The full refunded amount will be deducted from your available balance.
              </p>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Issue Refund'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
