import React, { useState, useEffect } from 'react';
import { HealthResponse } from '@ks-os/contracts';

export const ApiStatusIndicator: React.FC = () => {
  const [status, setStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking');

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const body: HealthResponse = await res.json();
          if (body.status === 'OK') {
            setStatus('connected');
            return;
          }
        }
        setStatus('unavailable');
      } catch (err) {
        setStatus('unavailable');
      }
    };

    checkConnection();
    // Re-check every 15 seconds
    const interval = setInterval(checkConnection, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div 
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold font-mono transition shadow-3xs"
      style={{
        backgroundColor: status === 'connected' ? '#ecfdf5' : status === 'unavailable' ? '#fef2f2' : '#f8fafc',
        borderColor: status === 'connected' ? '#a7f3d0' : status === 'unavailable' ? '#fecaca' : '#cbd5e1',
        color: status === 'connected' ? '#065f46' : status === 'unavailable' ? '#991b1b' : '#334155'
      }}
      aria-live="polite"
    >
      <span 
        className="w-2 h-2 rounded-full inline-block"
        style={{
          backgroundColor: status === 'connected' ? '#10b981' : status === 'unavailable' ? '#ef4444' : '#64748b'
        }}
        aria-hidden="true"
      />
      <span>
        {status === 'connected' && 'API connected'}
        {status === 'unavailable' && 'API unavailable'}
        {status === 'checking' && 'Checking API connection'}
      </span>
    </div>
  );
};
export default ApiStatusIndicator;
