import type { ReactNode } from 'react';
import type { PlanKey } from '@ks-os/contracts';
import { FeatureLockedState } from './FeatureLockedState.js';
import { useWorkspacePlan } from './WorkspacePlanContext.js';

interface EntitlementRouteProps {
  entitlementKey: string;
  title: string;
  requiredPlan: Exclude<PlanKey, 'CORE'>;
  benefit: string;
  children: ReactNode;
}

export function EntitlementRoute({ entitlementKey, title, requiredPlan, benefit, children }: EntitlementRouteProps) {
  const { summary, loading } = useWorkspacePlan();
  if (loading) return <div aria-live="polite" className="h-64 animate-pulse rounded-3xl bg-slate-200"><span className="sr-only">Checking plan access</span></div>;
  if (summary && summary.entitlements[entitlementKey]?.enabled !== true) {
    return <FeatureLockedState title={title} requiredPlan={requiredPlan} benefit={benefit} />;
  }
  // If the summary endpoint is temporarily unavailable, render the route and let
  // the tenant-scoped API remain the source of truth for access enforcement.
  return children;
}
