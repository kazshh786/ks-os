import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Cloud, Mail, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { fetchWithAuth } from '../../api/client.js';
import { MetaMessagingIntegration } from '../../components/MetaMessagingIntegration.js';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  const response = await fetchWithAuth(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Integration request failed');
  return body as T;
}

type MailboxProvider = 'GOOGLE_MAIL' | 'ZOHO_MAIL';
type MailboxStatus = 'CONNECTED' | 'DEGRADED' | 'REAUTHORISATION_REQUIRED' | 'DISCONNECTED' | string;

type MailboxConnection = {
  id: string;
  provider: MailboxProvider;
  emailAddress: string;
  displayName: string | null;
  status: MailboxStatus;
  syncDirection: string;
  connectedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  lastSyncError: string | null;
  providerConfigured: boolean;
};

type MailboxResponse = {
  data: MailboxConnection[];
  meta: {
    providers: Array<{ provider: MailboxProvider; configured: boolean }>;
  };
};

type ProviderDefinition = {
  provider: MailboxProvider;
  name: string;
  description: string;
  accountType: string;
  accent: string;
};

const mailboxProviders: ProviderDefinition[] = [
  {
    provider: 'GOOGLE_MAIL',
    name: 'Google Workspace',
    description: 'Send from the business Gmail address and bring customer replies into the KS OS inbox.',
    accountType: 'Gmail and Google Workspace',
    accent: 'from-blue-500 to-red-500',
  },
  {
    provider: 'ZOHO_MAIL',
    name: 'Zoho Mail',
    description: 'Connect the business Zoho mailbox for two-way customer conversations and native sending.',
    accountType: 'Zoho Mail business accounts',
    accent: 'from-amber-500 to-rose-500',
  },
];

const calendarProviders = [
  ['GOOGLE_CALENDAR', 'Google Calendar'],
  ['MICROSOFT_OUTLOOK', 'Microsoft Outlook Calendar'],
  ['XERO', 'Xero'],
  ['QUICKBOOKS', 'QuickBooks'],
] as const;

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not synced yet';

const statusClass = (status: MailboxStatus) => status === 'CONNECTED'
  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  : status === 'REAUTHORISATION_REQUIRED' || status === 'DEGRADED'
    ? 'bg-amber-50 text-amber-800 ring-amber-200'
    : 'bg-slate-100 text-slate-600 ring-slate-200';

export function Integrations() {
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxConnection[]>([]);
  const [mailboxConfiguration, setMailboxConfiguration] = useState<Record<MailboxProvider, boolean>>({ GOOGLE_MAIL: false, ZOHO_MAIL: false });
  const [loading, setLoading] = useState(true);
  const [workingProvider, setWorkingProvider] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const callbackNotice = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('mailbox');
    const provider = params.get('provider');
    const reason = params.get('reason');
    if (outcome === 'connected') return `${provider === 'ZOHO_MAIL' ? 'Zoho Mail' : 'Google Workspace'} mailbox connected successfully.`;
    if (outcome === 'error') return `Mailbox connection failed${reason ? `: ${reason.replaceAll('_', ' ').toLowerCase()}` : '.'}`;
    return '';
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [integrationResponse, mailboxResponse] = await Promise.all([
        request<{ data: any[] }>('/api/v1/integrations'),
        request<MailboxResponse>('/api/v1/mailboxes'),
      ]);
      setIntegrations(integrationResponse.data);
      setMailboxes(mailboxResponse.data);
      setMailboxConfiguration({
        GOOGLE_MAIL: mailboxResponse.meta.providers.find(item => item.provider === 'GOOGLE_MAIL')?.configured || false,
        ZOHO_MAIL: mailboxResponse.meta.providers.find(item => item.provider === 'ZOHO_MAIL')?.configured || false,
      });
      if (callbackNotice) setNotice(callbackNotice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Integration settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const connectIntegration = async (provider: string) => {
    setWorkingProvider(provider);
    setError('');
    try {
      const response = await request<{ data: { authorizationUrl: string } }>('/api/v1/integrations/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider, returnPath: '/app/settings/integrations' }),
      });
      window.location.assign(response.data.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Integration connection could not be started.');
      setWorkingProvider(null);
    }
  };

  const connectMailbox = async (provider: MailboxProvider) => {
    setWorkingProvider(provider);
    setError('');
    setNotice('');
    try {
      const response = await request<{ data: { authorizationUrl: string } }>('/api/v1/mailboxes/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider, returnPath: '/app/settings/integrations' }),
      });
      window.location.assign(response.data.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mailbox connection could not be started.');
      setWorkingProvider(null);
    }
  };

  const syncMailbox = async (connection: MailboxConnection) => {
    setWorkingProvider(`${connection.provider}:sync`);
    setError('');
    setNotice('');
    try {
      const response = await request<{ data: { messages: number } }>(`/api/v1/mailboxes/${connection.id}/sync`, { method: 'POST' });
      setNotice(`Mailbox synced. ${response.data.messages} new message${response.data.messages === 1 ? '' : 's'} added to the inbox.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mailbox sync failed.');
    } finally {
      setWorkingProvider(null);
    }
  };

  const disconnectMailbox = async (connection: MailboxConnection) => {
    const confirmed = window.confirm(`Disconnect ${connection.emailAddress}? KS OS will stop sending and syncing through this mailbox.`);
    if (!confirmed) return;
    setWorkingProvider(`${connection.provider}:disconnect`);
    setError('');
    setNotice('');
    try {
      await request(`/api/v1/mailboxes/${connection.id}`, { method: 'DELETE' });
      setNotice(`${connection.emailAddress} has been disconnected.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mailbox could not be disconnected.');
    } finally {
      setWorkingProvider(null);
    }
  };

  const createFeed = async () => {
    setError('');
    try {
      const response = await request<{ data: { url: string } }>('/api/v1/integrations/calendar-feeds', {
        method: 'POST',
        body: JSON.stringify({ scope: 'BUSINESS', privacyLevel: 'BUSY_ONLY', bookingStatuses: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] }),
      });
      await navigator.clipboard.writeText(response.data.url);
      setNotice('Private calendar URL created and copied. It will not be shown again.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Calendar feed could not be created.');
    }
  };

  return <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
    <header className="relative overflow-hidden rounded-[32px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-200"><Cloud className="h-3.5 w-3.5" />Business connections</div>
        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Connect the tools each business owns</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">Connect business-owned email, calendars and Meta messaging while KS OS encrypts credentials and keeps each tenant’s data isolated.</p>
      </div>
    </header>

    {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}
    {notice && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{notice}</div>}

    <MetaMessagingIntegration />

    <section aria-labelledby="mailbox-heading" className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id="mailbox-heading" className="text-xl font-black text-slate-950">Connected business mailbox</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Human replies are sent from the connected mailbox and incoming customer email is synced into the KS OS inbox. Resend continues to handle automated notifications and marketing delivery.</p></div>
        <span className="inline-flex items-center gap-2 text-xs font-black text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />OAuth tokens encrypted at rest</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">{mailboxProviders.map(definition => {
        const connection = mailboxes.find(item => item.provider === definition.provider && item.status !== 'DISCONNECTED');
        const configured = mailboxConfiguration[definition.provider];
        const connecting = workingProvider === definition.provider;
        return <article key={definition.provider} className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${definition.accent}`} />
          <div className="flex items-start justify-between gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white"><Mail className="h-5 w-5" /></span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ring-1 ring-inset ${statusClass(connection?.status || 'DISCONNECTED')}`}>{connection?.status?.replaceAll('_', ' ') || 'Not connected'}</span>
          </div>
          <h3 className="mt-5 text-lg font-black text-slate-950">{definition.name}</h3>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">{definition.accountType}</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">{definition.description}</p>

          {connection ? <div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{connection.emailAddress}</div>
            <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2"><span>Last sync<br /><strong className="text-slate-700">{formatDate(connection.lastSuccessfulSyncAt)}</strong></span><span>Direction<br /><strong className="text-slate-700">Send and receive</strong></span></div>
            {connection.lastSyncError && <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">{connection.lastSyncError}</p>}
          </div> : !configured ? <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-5 text-amber-900">The KS OS platform OAuth credentials for {definition.name} must be added to the VPS before a business can connect.</div> : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {!connection ? <button type="button" disabled={!configured || connecting} onClick={() => void connectMailbox(definition.provider)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{connecting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{connecting ? 'Opening…' : `Connect ${definition.name}`}</button> : <>
              <button type="button" disabled={workingProvider !== null} onClick={() => void syncMailbox(connection)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${workingProvider === `${connection.provider}:sync` ? 'animate-spin' : ''}`} />Sync now</button>
              <button type="button" disabled={workingProvider !== null} onClick={() => void connectMailbox(definition.provider)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reauthorise</button>
              <button type="button" disabled={workingProvider !== null} onClick={() => void disconnectMailbox(connection)} aria-label={`Disconnect ${connection.emailAddress}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 px-3 text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Unplug className="h-4 w-4" /></button>
            </>}
          </div>
        </article>;
      })}</div>
    </section>

    <section aria-labelledby="other-integrations-heading" className="space-y-4">
      <div><h2 id="other-integrations-heading" className="text-xl font-black text-slate-950">Calendars and accounting</h2><p className="mt-1 text-sm text-slate-600">Keep appointment availability and business records connected to the services the client already uses.</p></div>
      {loading ? <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map(item => <div key={item} className="h-40 animate-pulse rounded-3xl bg-slate-100" />)}</div> : <div className="grid gap-4 md:grid-cols-2">{calendarProviders.map(([provider, label]) => {
        const connection = integrations.find(item => item.provider === provider);
        return <article key={provider} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><CalendarDays className="h-5 w-5" /></span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{connection?.status?.replaceAll('_', ' ') || 'Not connected'}</span></div>
          <h3 className="mt-4 font-black text-slate-950">{label}</h3>
          <p className="my-3 min-h-10 text-sm leading-5 text-slate-500">{connection?.last_sync_error ? 'The provider needs attention before the next sync.' : connection ? 'This provider is connected to the business workspace.' : 'Connect this provider when the client uses it.'}</p>
          <button type="button" disabled={workingProvider !== null} onClick={() => void connectIntegration(provider)} className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{connection ? 'Reauthorise' : 'Connect'}</button>
        </article>;
      })}</div>}
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><CalendarDays className="h-5 w-5" /></span><div><h2 className="font-black text-slate-950">Apple and iCalendar feed</h2><p className="mt-1 text-sm leading-6 text-slate-500">Creates a private busy-only business feed. Treat its URL like a password and rotate it if shared accidentally.</p></div></div>
      <button type="button" onClick={() => void createFeed()} className="mt-4 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700">Create and copy feed</button>
    </section>
  </main>;
}
