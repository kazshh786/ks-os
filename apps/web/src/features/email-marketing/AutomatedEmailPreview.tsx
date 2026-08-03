import type { AutomatedEmailTemplate, EmailBranding } from '@ks-os/contracts';

const previewValues: Record<string, string> = {
  businessName: 'Your business',
  customerName: 'Amelia',
  serviceName: 'Signature appointment',
  staffName: 'Alex',
  bookingDate: 'Friday, 14 August 2026',
  bookingTime: '14:30',
  amount: '45.00',
  currency: 'GBP',
  reviewProvider: 'Google',
};

const interpolate = (value: string, branding: EmailBranding) => value.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key: string) => key === 'businessName' ? branding.businessName : previewValues[key] || '{{' + key + '}}');

export function AutomatedEmailPreview({ template, branding, primaryColor = '#0f172a' }: { template: AutomatedEmailTemplate; branding: EmailBranding; primaryColor?: string }) {
  const socialLinks = [
    ['Instagram', branding.instagramUrl],
    ['Facebook', branding.facebookUrl],
    ['TikTok', branding.tiktokUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <aside aria-label="Email preview" className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 p-3 shadow-inner sm:p-5">
      <div className="mb-3 rounded-xl bg-white px-4 py-3 text-xs text-slate-500"><span className="font-black text-slate-700">Subject:</span> {interpolate(template.subject, branding)}</div>
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="px-6 py-7 text-center text-white" style={{ backgroundColor: primaryColor }}>
          {branding.logoUrl && <img src={branding.logoUrl} alt="" className="mx-auto mb-3 max-h-14 max-w-40 object-contain" />}
          <div className="text-xl font-black">{branding.businessName}</div>
        </div>
        <div className="space-y-4 px-6 py-7">
          <h3 className="text-xl font-black text-slate-950">{interpolate(template.heading, branding)}</h3>
          <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{interpolate(template.body, branding)}</p>
          <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700"><strong>Service:</strong> Signature appointment<br /><strong>Date:</strong> Friday, 14 August 2026<br /><strong>Time:</strong> 14:30</div>
        </div>
        <div className="border-t border-slate-100 px-6 py-5 text-center text-xs leading-5 text-slate-500">
          {branding.businessAddress && <div>{branding.businessAddress}</div>}
          <div>{[branding.businessPhone, branding.businessEmail].filter(Boolean).join(' · ')}</div>
          {socialLinks.length > 0 && <div className="mt-2 font-bold text-slate-700">{socialLinks.map(([label]) => label).join(' · ')}</div>}
          <div className="mt-3 text-[10px]">Sent securely by KS OS on behalf of {branding.businessName}.</div>
        </div>
      </div>
    </aside>
  );
}
