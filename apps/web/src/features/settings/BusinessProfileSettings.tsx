import { Link } from 'react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Save, Settings } from 'lucide-react';
import type { BusinessTenant, PaymentPolicy } from '../../data/types.js';
import { fetchWithAuth } from '../../api/client.js';

interface BusinessProfileSettingsProps {
  tenant: BusinessTenant;
  onSaved: () => Promise<void>;
}

export default function BusinessProfileSettings({ tenant, onSaved }: BusinessProfileSettingsProps) {
  const [name, setName] = useState(tenant.name);
  const [email, setEmail] = useState(tenant.email || '');
  const [phone, setPhone] = useState(tenant.phone || '');
  const [address, setAddress] = useState(tenant.address || '');
  const [primaryColor, setPrimaryColor] = useState(tenant.primaryColor);
  const [currency, setCurrency] = useState(tenant.currency);
  const [paymentPolicy, setPaymentPolicy] = useState<PaymentPolicy>(tenant.paymentPolicy);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(tenant.name);
    setEmail(tenant.email || '');
    setPhone(tenant.phone || '');
    setAddress(tenant.address || '');
    setPrimaryColor(tenant.primaryColor);
    setCurrency(tenant.currency);
    setPaymentPolicy(tenant.paymentPolicy);
  }, [tenant]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      const response = await fetchWithAuth('/api/v1/workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          address,
          primaryColor,
          currency,
          paymentPolicy,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || body.error?.code || 'Business information could not be saved.');
      await onSaved();
      setSuccess('Business information saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Business information could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl">
      <header className="bg-slate-950 p-6 text-white">
        <h1 className="flex items-center gap-2 text-xl font-extrabold">
          <Settings className="h-5 w-5 text-indigo-400" /> Business information
        </h1>
        <p className="mt-1 text-sm text-slate-400">Update the details customers see in bookings, forms and business communications.</p>
      </header>

      <div className="px-6 pt-6"><Link to="/app/onboarding" className="font-bold text-indigo-600 underline">Business type and how you work</Link></div>
      <form onSubmit={save} className="space-y-7 p-6 md:p-8">
        {success && (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            <CheckCircle2 className="h-5 w-5" /> {success}
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <label className="text-sm font-bold text-slate-700">
            Trading name
            <input
              required
              minLength={2}
              maxLength={255}
              value={name}
              onChange={event => setName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="text-sm font-bold text-slate-700">
            Business email
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="text-sm font-bold text-slate-700">
            Business phone
            <input
              type="tel"
              maxLength={30}
              value={phone}
              onChange={event => setPhone(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <label className="text-sm font-bold text-slate-700">
            Currency
            <select
              value={currency}
              onChange={event => setCurrency(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="GBP">GBP (£)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </label>

          <label className="text-sm font-bold text-slate-700 md:col-span-2">
            Main business address
            <textarea
              rows={3}
              maxLength={1000}
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder="Include the postcode, for example: 12 High Street, Keighley, BD21 3AA"
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">Include the postcode so the main booking location can be activated.</span>
          </label>

          <label className="text-sm font-bold text-slate-700">
            Primary brand colour
            <div className="mt-2 flex gap-2">
              <input
                aria-label="Choose primary brand colour"
                type="color"
                value={primaryColor}
                onChange={event => setPrimaryColor(event.target.value)}
                className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 p-1"
              />
              <input
                required
                pattern="^#[0-9A-Fa-f]{6}$"
                value={primaryColor}
                onChange={event => setPrimaryColor(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          </label>

          <label className="text-sm font-bold text-slate-700">
            Online booking payment policy
            <select
              value={paymentPolicy}
              onChange={event => setPaymentPolicy(event.target.value as PaymentPolicy)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="PayLater">Pay at the appointment</option>
              <option value="Deposit">Take a booking deposit</option>
              <option value="FullPayment">Require full payment</option>
              <option value="CustomerChoice">Let the customer choose</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-6">
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save business information'}
          </button>
        </div>
      </form>
    </div>
  );
}
