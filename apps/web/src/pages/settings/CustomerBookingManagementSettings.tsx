import { useEffect, useState } from 'react';
import type { CustomerBookingPolicySettings } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';

const endpoint = '/api/v1/settings/booking/customer-management';
const noticeChoices = [0, 120, 360, 720, 1440, 2880, 4320] as const;
const rescheduleChoices = [0, 1, 2, 3, 5, 10] as const;

async function request(init?: RequestInit) {
  const response = await fetchWithAuth(endpoint, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.code || 'CUSTOMER_BOOKING_POLICY_UPDATE_FAILED');
  return body.data as CustomerBookingPolicySettings;
}

const noticeLabel = (minutes: number) => minutes === 0 ? 'No minimum notice'
  : minutes < 1440 ? `${minutes / 60} hours`
    : `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;

export default function CustomerBookingManagementSettings({ embedded = false }: { embedded?: boolean }) {
  const [settings, setSettings] = useState<CustomerBookingPolicySettings>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { request().then(setSettings).catch(() => setError('Customer booking policies could not be loaded.')); }, []);
  if (error && !settings) return <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>;
  if (!settings) return <div role="status" className="py-10 text-center text-slate-500">Loading customer booking policies...</div>;
  const update = <K extends keyof CustomerBookingPolicySettings>(key: K, value: CustomerBookingPolicySettings[K]) => setSettings({ ...settings, [key]: value });
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage(''); setError('');
    try { setSettings(await request({ method: 'PATCH', body: JSON.stringify(settings) })); setMessage('Customer booking policies saved.'); }
    catch { setError('The policies could not be saved. Please try again.'); }
    finally { setSaving(false); }
  };
  return <section className={embedded ? 'space-y-5' : 'mx-auto max-w-3xl space-y-5'}>
    {!embedded && <div><h1 className="text-2xl font-black text-slate-900">Customer booking management</h1><p className="mt-1 text-sm text-slate-600">Control booking availability and when customers may cancel or reschedule online. These defaults are operational settings, not legal advice.</p></div>}
    <form onSubmit={save} className="space-y-5 rounded-2xl border bg-white p-5 shadow-sm">
      <fieldset className="space-y-3"><legend className="font-bold text-slate-900">Availability</legend>
        <Toggle
          label="Allow appointments to finish after closing time"
          description="Customers can select any start time before closing, even when the service duration or buffer runs beyond the day's availability."
          checked={settings.allowAppointmentsPastClosingTime}
          onChange={(value) => update('allowAppointmentsPastClosingTime', value)}
        />
      </fieldset>
      <fieldset className="space-y-3"><legend className="font-bold text-slate-900">Online actions</legend>
        <Toggle label="Allow customers to cancel online" checked={settings.customerCancellationEnabled} onChange={(value) => update('customerCancellationEnabled', value)} />
        <Toggle label="Allow customers to reschedule online" checked={settings.customerReschedulingEnabled} onChange={(value) => update('customerReschedulingEnabled', value)} />
        <Toggle label="Require a cancellation reason" checked={settings.requireCancellationReason} onChange={(value) => update('requireCancellationReason', value)} />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Cancellation notice" value={settings.minimumCancellationNoticeMinutes} values={noticeChoices} formatter={noticeLabel} onChange={(value) => update('minimumCancellationNoticeMinutes', value as CustomerBookingPolicySettings['minimumCancellationNoticeMinutes'])} />
        <Select label="Rescheduling notice" value={settings.minimumRescheduleNoticeMinutes} values={noticeChoices} formatter={noticeLabel} onChange={(value) => update('minimumRescheduleNoticeMinutes', value as CustomerBookingPolicySettings['minimumRescheduleNoticeMinutes'])} />
        <Select label="Maximum customer reschedules" value={settings.maximumCustomerReschedules} values={rescheduleChoices} formatter={(value) => value === 0 ? 'No online reschedules' : String(value)} onChange={(value) => update('maximumCustomerReschedules', value)} />
      </div>
      <label className="block text-sm font-semibold text-slate-700">Late-change message<textarea required maxLength={1000} value={settings.lateCancellationMessage} onChange={(event) => update('lateCancellationMessage', event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
      <label className="block text-sm font-semibold text-slate-700">Payment and refund wording<textarea required maxLength={1000} value={settings.depositPolicyMessage} onChange={(event) => update('depositPolicyMessage', event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">Cancellation never promises or initiates an automatic refund.</span></label>
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={saving} className="rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save policies'}</button>
    </form>
  </section>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-800"><span><span className="block font-semibold">{label}</span>{description && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{description}</span>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" /></label>;
}

function Select<T extends number>({ label, value, values, formatter, onChange }: { label: string; value: T; values: readonly T[]; formatter: (value: T) => string; onChange: (value: T) => void }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<select value={value} onChange={(event) => onChange(Number(event.target.value) as T)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{values.map((choice) => <option key={choice} value={choice}>{formatter(choice)}</option>)}</select></label>;
}
