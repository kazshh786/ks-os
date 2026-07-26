import { LockKeyhole } from 'lucide-react';
import type { PlanKey } from '@ks-os/contracts';

interface FeatureLockedStateProps {
  title: string;
  requiredPlan: Exclude<PlanKey, 'CORE'>;
  benefit: string;
}

export function FeatureLockedState({ title, requiredPlan, benefit }: FeatureLockedStateProps) {
  const subject = encodeURIComponent(`Upgrade KS OS to ${requiredPlan}`);
  return <section className="mx-auto max-w-2xl rounded-3xl border border-indigo-200 bg-white p-8 text-center shadow-sm">
    <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-100 text-indigo-700"><LockKeyhole aria-hidden="true" className="h-7 w-7" /></span>
    <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-indigo-600">{requiredPlan} plan</p>
    <h1 className="mt-2 text-2xl font-black">{title}</h1>
    <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">{benefit}</p>
    <a href={`mailto:support@ks-os.com?subject=${subject}`} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700">Upgrade plan</a>
  </section>;
}
