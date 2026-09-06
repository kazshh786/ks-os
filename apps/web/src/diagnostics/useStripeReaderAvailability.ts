import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosStripeReader } from '@ks-os/contracts';
import { requestJson } from '../api/client';

/** A failed lookup is not an empty inventory. Discard superseded workspace responses. */
export function useStripeReaderAvailability(scope: string) {
  const [readers, setReaders] = useState<PosStripeReader[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const active = useRef(true);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    setReaders([]); setError(''); setCheckedAt(null); setLoading(false);
    return () => { active.current = false; sequence.current++; controller.current?.abort(); };
  }, [scope]);
  const load = useCallback(async () => {
    controller.current?.abort();
    const attempt = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true); setError('');
    try {
      const response = await requestJson<{ data: PosStripeReader[] }>('/api/v1/pos/stripe/readers', { signal: abort.signal });
      if (!Array.isArray(response?.data) || response.data.some(reader => !reader || typeof reader.id !== 'string' || typeof reader.online !== 'boolean' || typeof reader.supportsServerDriven !== 'boolean')) {
        throw new Error('Reader availability returned an invalid result. Refresh availability.');
      }
      if (!active.current || attempt !== sequence.current) return null;
      setReaders(response.data); setCheckedAt(new Date().toISOString());
      return response.data;
    } catch (cause) {
      if (!active.current || attempt !== sequence.current || abort.signal.aborted) return null;
      setReaders([]);
      setError(cause instanceof Error ? cause.message : 'Reader availability could not be checked.');
      return null;
    } finally {
      if (active.current && attempt === sequence.current) setLoading(false);
    }
  }, [scope]);
  return { readers, loading, error, checkedAt, load };
}
