import React, { useState } from 'react';
import { AlertTriangle, ChevronRight, Lock, Sparkles, Zap } from 'lucide-react';

export type PackageTier = 'CORE' | 'GROWTH' | 'SCALE';

export interface PlanLimits {
  monthlyBookings: number;
  activeStaff: number;
  locations: number;
  onlineBooking: boolean;
  manualBookings: boolean;
  posAndPayments: boolean;
  customAutomations: boolean;
  advancedAnalytics: boolean;
  inventory: 'LOCKED' | 'BETA';
  supportLevel: 'Standard' | 'Priority' | 'Strategic';
}

export const TIER_LIMITS: Record<PackageTier, PlanLimits> = {
  CORE: {
    monthlyBookings: 500,
    activeStaff: 5,
    locations: 1,
    onlineBooking: true,
    manualBookings: true,
    posAndPayments: true,
    customAutomations: false,
    advancedAnalytics: false,
    inventory: 'LOCKED',
    supportLevel: 'Standard',
  },
  GROWTH: {
    monthlyBookings: 2500,
    activeStaff: 15,
    locations: 3,
    onlineBooking: true,
    manualBookings: true,
    posAndPayments: true,
    customAutomations: true,
    advancedAnalytics: true,
    inventory: 'BETA',
    supportLevel: 'Priority',
  },
  SCALE: {
    monthlyBookings: 20000,
    activeStaff: 100,
    locations: 20,
    onlineBooking: true,
    manualBookings: true,
    posAndPayments: true,
    customAutomations: true,
    advancedAnalytics: true,
    inventory: 'BETA',
    supportLevel: 'Strategic',
  },
};

export interface LockedFeatureCardProps {
  title: string;
  description: string;
  requiredTier: 'GROWTH' | 'SCALE';
  benefit: string;
  onUpgrade?: (tier: PackageTier) => void;
}

export function LockedFeatureCard({
  title,
  description,
  requiredTier,
  benefit,
  onUpgrade,
}: LockedFeatureCardProps) {
  const [showModal, setShowModal] = useState(false);

  const handleUpgradeClick = () => {
    if (onUpgrade) {
      onUpgrade(requiredTier);
    } else {
      setShowModal(true);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black text-slate-900">{title}</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-black uppercase text-violet-800">
                <Sparkles className="h-3 w-3" />
                {requiredTier} Plan
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200/60 bg-amber-50/80 p-3.5 text-xs font-medium text-amber-950">
        <p className="flex items-center gap-1.5 font-bold">
          <Zap className="h-4 w-4 text-amber-600 shrink-0" />
          Why upgrade?
        </p>
        <p className="mt-1 text-slate-700">{benefit}</p>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-200/80 pt-4">
        <span className="text-xs font-semibold text-slate-500">
          Available on {requiredTier.charAt(0) + requiredTier.slice(1).toLowerCase()} plan and higher
        </span>
        <button
          type="button"
          onClick={handleUpgradeClick}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white transition hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
        >
          Upgrade plan
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h4 className="text-xl font-black text-slate-900">Upgrade to {requiredTier}</h4>
            <p className="mt-2 text-sm text-slate-600">
              Unlock {title} and higher operational limits for your business.
            </p>
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs space-y-2">
              <p className="font-bold text-slate-800">Plan benefits:</p>
              <p className="text-slate-600">• {benefit}</p>
              <p className="text-slate-600">
                • {requiredTier === 'GROWTH' ? '2,500' : '20,000'} monthly bookings
              </p>
              <p className="text-slate-600">
                • Up to {requiredTier === 'GROWTH' ? '15' : '100'} team members & {requiredTier === 'GROWTH' ? '3' : '20'} locations
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  alert(`Upgrading tenant plan to ${requiredTier}...`);
                }}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white"
              >
                Confirm upgrade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export interface EntitlementUsageMeterProps {
  label: string;
  current: number;
  limit: number;
  unit?: string;
  currentTier?: PackageTier;
  onUpgradeRequest?: (nextTier: PackageTier) => void;
}

export function EntitlementUsageMeter({
  label,
  current,
  limit,
  unit = 'used this month',
  currentTier = 'CORE',
  onUpgradeRequest,
}: EntitlementUsageMeterProps) {
  const percentage = Math.min(100, Math.round((current / limit) * 100));
  const isWarning = percentage >= 80 && percentage < 100;
  const isAtLimit = percentage >= 100;

  const nextTier: PackageTier = currentTier === 'CORE' ? 'GROWTH' : 'SCALE';
  const nextLimit = TIER_LIMITS[nextTier].monthlyBookings;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between text-sm font-bold">
        <span className="text-slate-700">{label}</span>
        <span className="font-mono text-slate-900">
          {current.toLocaleString()} of {limit.toLocaleString()} {unit}
        </span>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            isAtLimit
              ? 'bg-rose-600'
              : isWarning
              ? 'bg-amber-500'
              : 'bg-violet-600'
          }`}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${label} usage`}
        />
      </div>

      {isWarning && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div className="flex-1">
            <p>
              <strong>{percentage}% of monthly volume used</strong> — Upgrade to {nextTier} for {nextLimit.toLocaleString()} bookings to avoid disruption.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onUpgradeRequest?.(nextTier)}
            className="shrink-0 font-black text-amber-950 underline hover:text-amber-800"
          >
            Upgrade
          </button>
        </div>
      )}

      {isAtLimit && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
          <div className="flex-1">
            <p>
              <strong>Monthly limit reached ({current}/{limit})</strong> — Upgrade to {nextTier} to allow uninterrupted public booking.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onUpgradeRequest?.(nextTier)}
            className="shrink-0 font-black text-rose-950 underline hover:text-rose-800"
          >
            Upgrade now
          </button>
        </div>
      )}
    </div>
  );
}
