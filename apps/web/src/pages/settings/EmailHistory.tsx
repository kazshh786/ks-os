import React, { useState, useEffect } from 'react';
import { getDataProvider } from '../../data/data-provider.js';
import { useAuth } from '../../auth/useAuth.js';
import { EmailHistoryItem } from '@ks-os/contracts';
import { EmailMarketingTabs } from '../../features/email-marketing/EmailMarketingTabs.js';

export function EmailHistory() {
  const { role } = useAuth();
  const [history, setHistory] = useState<EmailHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
  }, [role]);

  const fetchHistory = async () => {
    if (role === 'staff') {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const provider = getDataProvider();
      const res = await provider.getEmailHistory({ limit: 50 });
      setHistory(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load email history');
    } finally {
      setLoading(false);
    }
  };

  if (role === 'staff') {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Email History</h2>
        <div className="bg-red-50 text-red-600 p-4 rounded-md">
          You do not have permission to view email history. Only account owners can access this page.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header><h1 className="text-3xl font-black text-slate-950">Email marketing</h1><p className="mt-2 text-sm text-slate-500">Review the delivery status of automated business emails without exposing customer addresses.</p></header>
      <EmailMarketingTabs />
      <h2 className="text-2xl font-bold">Email history</h2>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-6 text-gray-500">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="p-6 text-gray-500">No email history found.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recipient
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Template
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Sent / Created
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {history.map(item => (
                <tr key={item.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.recipientEmailMasked}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.templateKey}
                    {item.relatedEntityType && (
                      <span className="block text-xs text-gray-400">Related: {item.relatedEntityType}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      item.status === 'delivered' ? 'bg-green-100 text-green-800' :
                      item.status === 'failed' || item.status === 'bounced' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {item.status}
                    </span>
                    {item.lastErrorCode && (
                      <span className="ml-2 text-xs text-red-500">({item.lastErrorCode})</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(item.sentAt || item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
