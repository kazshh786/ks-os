import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Clock3, Mail, Phone, UserRound } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { getDataProvider } from '../data/data-provider.js';
import { currentPublicBookingIdentifier } from '../lib/workspace-hostname.js';

const publicReference = (value: string | null) => value
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ? value
  : null;
const campaignReference = (value: string | null) => value
  && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value)
  && value.length <= 64
  ? value
  : null;

type Catalog = {
  tenant?: { name: string };
  tenantName?: string;
  services: Array<{ id: string; publicReference?: string; name: string }>;
  staff: Array<{ publicReference?: string; name: string }>;
  locations?: Array<{ publicReference?: string; name: string }>;
};

export function WaitlistPage() {
  const { subdomain } = useParams();
  const [search] = useSearchParams();
  const identifier = subdomain || currentPublicBookingIdentifier();
  const serviceReference = publicReference(search.get('service'));
  const locationReference = publicReference(search.get('location'));
  const staffReference = publicReference(search.get('staff'));
  const sourceCampaign = campaignReference(search.get('campaign'));
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const provider = getDataProvider();

  useEffect(() => {
    let active = true;
    if (!identifier || !serviceReference) {
      setLoading(false);
      return () => { active = false; };
    }
    Promise.all([
      provider.getPublicCatalog(identifier) as Promise<Catalog>,
      provider.getPublicWaitlistEligibility(identifier, {
        serviceReference,
        ...(locationReference ? { locationReference } : {}),
        ...(staffReference ? { staffReference } : {}),
        ...(sourceCampaign ? { campaignReference: sourceCampaign } : {}),
      }),
    ])
      .then(([value, eligibility]) => {
        if (!active) return;
        if (eligibility.waitlistEligible) setCatalog(value);
        else setError('This waitlist option is not available.');
      })
      .catch(() => { if (active) setError('This waitlist option is not available.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identifier, locationReference, provider, serviceReference, sourceCampaign, staffReference]);

  const service = useMemo(() => catalog?.services.find(
    candidate => candidate.publicReference === serviceReference,
  ), [catalog, serviceReference]);
  const location = catalog?.locations?.find(candidate => candidate.publicReference === locationReference);
  const staff = catalog?.staff.find(candidate => candidate.publicReference === staffReference);
  const businessName = catalog?.tenant?.name || catalog?.tenantName || 'the business';
  const minimumDate = new Date().toISOString().slice(0, 10);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!identifier || !serviceReference || !service) return;
    setSubmitting(true);
    setError('');
    try {
      await provider.createPublicWaitlistRequest(identifier, {
        serviceReference,
        ...(locationReference ? { locationReference } : {}),
        ...(staffReference ? { staffReference } : {}),
        ...(sourceCampaign ? { campaignReference: sourceCampaign } : {}),
        ...(preferredDate ? { preferredDate } : {}),
        customer: {
          name,
          email,
          ...(phone ? { phone } : {}),
        },
        idempotencyKey: idempotencyKey.current,
      });
      setConfirmed(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error
        ? submissionError.message
        : 'Unable to join the waitlist. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div role="status" className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm">Loading waitlist…</div>;
  }
  if (!identifier || !serviceReference || !service) {
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">Waitlist unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">This service is not currently accepting online waitlist requests.</p>
      </section>
    );
  }
  if (confirmed) {
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black text-slate-950">You're on the waitlist.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">We'll contact you if a suitable appointment becomes available.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-10">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Clock3 className="h-5 w-5" aria-hidden="true" /></div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{businessName}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Join the {service.name} waitlist</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Share your contact details and we'll get in touch if a suitable appointment becomes available. Joining does not guarantee an appointment.</p>
          {location || staff ? <p className="mt-2 text-sm font-bold text-slate-700">{[location?.name, staff?.name].filter(Boolean).join(' · ')}</p> : null}
        </div>
      </div>

      <form className="mt-8 grid gap-5" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-bold text-slate-800">
          <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4" aria-hidden="true" />Name</span>
          <input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} className="min-h-12 rounded-xl border border-slate-300 px-4 font-normal outline-none focus:border-slate-950" />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-800">
          <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" aria-hidden="true" />Email</span>
          <input required type="email" maxLength={255} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="min-h-12 rounded-xl border border-slate-300 px-4 font-normal outline-none focus:border-slate-950" />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-800">
          <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4" aria-hidden="true" />Phone <span className="font-normal text-slate-500">(optional)</span></span>
          <input type="tel" minLength={7} maxLength={30} autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} className="min-h-12 rounded-xl border border-slate-300 px-4 font-normal outline-none focus:border-slate-950" />
        </label>
        <label className="grid gap-2 text-sm font-bold text-slate-800">
          Preferred date <span className="font-normal text-slate-500">(optional)</span>
          <input type="date" min={minimumDate} value={preferredDate} onChange={event => setPreferredDate(event.target.value)} className="min-h-12 rounded-xl border border-slate-300 px-4 font-normal outline-none focus:border-slate-950" />
        </label>
        <p className="text-xs leading-5 text-slate-500">Your details are PERSONAL operational data used only to manage this waitlist request. They are not added to the public website.</p>
        {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
        <button type="submit" disabled={submitting} className="min-h-12 rounded-2xl bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50">
          {submitting ? 'Joining waitlist…' : 'Join waitlist'}
        </button>
      </form>
    </section>
  );
}

export default WaitlistPage;
