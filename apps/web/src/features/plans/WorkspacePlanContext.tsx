import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { WorkspacePlanSummarySchema, type WorkspacePlanSummary } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';

type WorkspacePlanState = {
  summary: WorkspacePlanSummary | null;
  loading: boolean;
  error: string;
};

const WorkspacePlanContext = createContext<WorkspacePlanState>({
  summary: null,
  loading: true,
  error: '',
});

interface WorkspacePlanProviderProps extends PropsWithChildren {
  businessReference: string;
}

export function WorkspacePlanProvider({ businessReference, children }: WorkspacePlanProviderProps) {
  const [state, setState] = useState<WorkspacePlanState>({ summary: null, loading: true, error: '' });

  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: '' }));
    void fetchWithAuth('/api/v1/workspace', { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message || 'Plan usage could not be loaded.');
        return WorkspacePlanSummarySchema.parse(body.data?.plan);
      })
      .then(summary => setState({ summary, loading: false, error: '' }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({ summary: null, loading: false, error: error instanceof Error ? error.message : 'Plan usage could not be loaded.' });
      });
    return () => controller.abort();
  }, [businessReference]);

  const value = useMemo(() => state, [state]);
  return <WorkspacePlanContext.Provider value={value}>{children}</WorkspacePlanContext.Provider>;
}

export function useWorkspacePlan() {
  return useContext(WorkspacePlanContext);
}
