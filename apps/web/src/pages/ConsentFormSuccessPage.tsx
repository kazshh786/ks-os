import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router';
import { FormSchemaJsonSchema } from '@ks-os/contracts';
import { currentWorkspaceSlug } from '../lib/workspace-hostname.js';

type SuccessDetails = {
  salonName?: string;
  message?: string;
  redirectUrl?: string;
  primaryColor?: string;
  accentColor?: string;
};

function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function SuccessView({ details }: { details: SuccessDetails }) {
  const primary = details.primaryColor || '#059669';
  const accent = details.accentColor || '#4f46e5';
  const redirectUrl = safeHttpUrl(details.redirectUrl);
  const salonName = details.salonName?.trim();
  const message = details.message?.trim() || 'Your response was received securely.';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px]" style={{ background: `radial-gradient(circle at top left, ${primary}24, transparent 44%), radial-gradient(circle at top right, ${accent}20, transparent 42%)` }} />
      <section className="relative w-full max-w-xl overflow-hidden rounded-[32px] border border-slate-200 bg-white text-center shadow-2xl shadow-slate-300/50">
        <div className="px-7 py-9 sm:px-10 sm:py-12">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: `${primary}18` }}>
            <CheckCircle2 className="h-11 w-11" style={{ color: primary }} />
          </div>
          {salonName && <p className="mt-6 text-xs font-black uppercase tracking-[0.18em]" style={{ color: accent }}>{salonName}</p>}
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Consent form submitted</h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-7 text-slate-600">{message}</p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700"><ShieldCheck className="h-4 w-4" />Securely recorded</div>

          {redirectUrl ? (
            <a href={redirectUrl} rel="noreferrer" className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-black text-white shadow-lg transition hover:brightness-95" style={{ background: `linear-gradient(90deg, ${primary}, ${accent})` }}>
              Back to {salonName || 'the website'}<ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <p className="mt-8 rounded-2xl bg-slate-50 px-5 py-4 text-sm font-semibold text-slate-500">You may now safely close this page.</p>
          )}
        </div>
      </section>
    </main>
  );
}

export function AssignedConsentFormSuccessPage() {
  const { token = '' } = useParams();
  const [details, setDetails] = useState<SuccessDetails>({});

  useEffect(() => {
    if (!token) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(`form-success-${token}`) || 'null');
      if (stored && typeof stored === 'object') setDetails(stored as SuccessDetails);
    } catch {
      sessionStorage.removeItem(`form-success-${token}`);
    }
  }, [token]);

  return <SuccessView details={details} />;
}

function pathFormSlug(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\/form\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function WorkspaceConsentFormSuccessPage() {
  const formSlug = pathFormSlug();
  const workspaceSlug = currentWorkspaceSlug();
  const [details, setDetails] = useState<SuccessDetails>({});

  useEffect(() => {
    if (!workspaceSlug || !formSlug) return;
    let active = true;
    fetch(`/api/v1/public/forms/workspace/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(formSlug)}`)
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('FORM_NOT_FOUND');
        const schema = FormSchemaJsonSchema.parse(body.data?.form?.schema);
        return {
          salonName: body.data?.salon?.name,
          message: schema.settings.completionMessage,
          redirectUrl: schema.settings.completionRedirectUrl,
          primaryColor: schema.theme.primaryColor || body.data?.salon?.primaryColor,
          accentColor: schema.theme.mutedColor || body.data?.salon?.accentColor,
        } satisfies SuccessDetails;
      })
      .then(value => { if (active) setDetails(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [formSlug, workspaceSlug]);

  return <SuccessView details={details} />;
}
