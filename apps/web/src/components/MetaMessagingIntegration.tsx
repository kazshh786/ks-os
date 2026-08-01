import { useEffect, useState } from 'react';
import { AtSign, MessagesSquare, Phone, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { fetchWithAuth } from '../api/client.js';
import { WhatsAppMessagingConsole } from './WhatsAppMessagingConsole.js';

type MetaChannel = {
  id: string;
  channelType: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM';
  displayName: string;
  externalAccountId: string;
  status: string;
  connectedAt: string | null;
  lastHealthCheckAt: string | null;
};

type MetaStatus = {
  providerConfigured: boolean;
  onboardingConfigured: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string | null;
  billingModel: 'CUSTOMER_OWNED';
  channels: MetaChannel[];
};

type EmbeddedSignupSession = {
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  const response = await fetchWithAuth(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Meta integration request failed');
  return body as T;
}

const loadFacebookSdk = (appId: string, graphVersion: string) => new Promise<void>((resolve, reject) => {
  const sdkWindow = window as any;
  const initialise = () => {
    try {
      sdkWindow.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      resolve();
    } catch (cause) {
      reject(cause);
    }
  };
  if (sdkWindow.FB) return initialise();
  const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
  sdkWindow.fbAsyncInit = initialise;
  if (existing) return;
  const script = document.createElement('script');
  script.id = 'facebook-jssdk';
  script.async = true;
  script.defer = true;
  script.crossOrigin = 'anonymous';
  script.src = 'https://connect.facebook.net/en_GB/sdk.js';
  script.onerror = () => reject(new Error('The Meta connection window could not be loaded.'));
  document.body.appendChild(script);
});

const iconFor = (channel: MetaChannel['channelType']) => channel === 'WHATSAPP'
  ? <Phone className="h-4 w-4" />
  : channel === 'INSTAGRAM'
    ? <AtSign className="h-4 w-4" />
    : <MessagesSquare className="h-4 w-4" />;

const labelFor = (channel: MetaChannel['channelType']) => channel === 'WHATSAPP'
  ? 'WhatsApp'
  : channel === 'INSTAGRAM' ? 'Instagram' : 'Messenger';

export function MetaMessagingIntegration() {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await request<{ data: MetaStatus }>('/api/v1/integrations/meta');
      setStatus(response.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meta connection status could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const connect = async () => {
    if (!status?.appId || !status.configId || !status.graphVersion) return;
    setWorking(true);
    setError('');
    setNotice('');
    const session: EmbeddedSignupSession = {};
    const messageHandler = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      try {
        const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (payload?.type !== 'WA_EMBEDDED_SIGNUP' || payload?.event !== 'FINISH') return;
        session.wabaId = payload.data?.waba_id ? String(payload.data.waba_id) : undefined;
        session.phoneNumberId = payload.data?.phone_number_id ? String(payload.data.phone_number_id) : undefined;
        session.businessId = payload.data?.business_id ? String(payload.data.business_id) : undefined;
      } catch {
        // Ignore unrelated postMessage traffic from the Meta dialog.
      }
    };
    window.addEventListener('message', messageHandler);
    try {
      await loadFacebookSdk(status.appId, status.graphVersion);
      const code = await new Promise<string>((resolve, reject) => {
        (window as any).FB.login((response: any) => {
          const returnedCode = response?.authResponse?.code;
          if (returnedCode) resolve(String(returnedCode));
          else reject(new Error('Meta connection was cancelled or no authorisation code was returned.'));
        }, {
          config_id: status.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {} },
        });
      });
      await new Promise(resolve => window.setTimeout(resolve, 500));
      const response = await request<{ data: { connected: Array<{ channel: string; name: string }>; status: MetaStatus } }>('/api/v1/integrations/meta/connect', {
        method: 'POST',
        body: JSON.stringify({ code, ...session }),
      });
      setStatus(response.data.status);
      setNotice(`${response.data.connected.length} Meta messaging connection${response.data.connected.length === 1 ? '' : 's'} added to KS OS.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meta messaging could not be connected.');
    } finally {
      window.removeEventListener('message', messageHandler);
      setWorking(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect WhatsApp, Messenger and Instagram from KS OS? Existing conversation history will remain.')) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const response = await request<{ data: MetaStatus }>('/api/v1/integrations/meta', { method: 'DELETE' });
      setStatus(response.data);
      setNotice('Meta messaging has been disconnected from this business workspace.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Meta messaging could not be disconnected.');
    } finally {
      setWorking(false);
    }
  };

  const channels = status?.channels.filter(channel => channel.status === 'CONNECTED') || [];
  const whatsappConnected = channels.some(channel => channel.channelType === 'WHATSAPP');

  return <section aria-labelledby="meta-messaging-heading" className="space-y-8">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="meta-messaging-heading" className="text-xl font-black text-slate-950">Meta messaging</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Connect the business-owned WhatsApp number, Facebook Page and linked Instagram professional account. Customers authorise their own assets through Meta; KS OS never asks them to paste an access token.</p>
      </div>
      <span className="inline-flex items-center gap-2 text-xs font-black text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />Tokens encrypted per business</span>
    </div>

    {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}
    {notice && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{notice}</div>}

    <article className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-blue-600 to-fuchsia-500" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white"><MessagesSquare className="h-5 w-5" /></span>
            <div><h3 className="text-lg font-black text-slate-950">WhatsApp, Messenger and Instagram</h3><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Customer-owned Meta accounts</p></div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">Each business signs into Meta, chooses the assets it owns and grants KS OS messaging access. WhatsApp usage is billed to the customer’s own WhatsApp Business Account; KS OS does not share a platform credit line.</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wide ring-1 ring-inset ${channels.length ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{channels.length ? `${channels.length} connected` : 'Not connected'}</span>
      </div>

      {loading ? <div className="mt-5 h-24 animate-pulse rounded-2xl bg-slate-100" /> : channels.length ? <div className="mt-5 grid gap-3 md:grid-cols-3">{channels.map(channel => <div key={channel.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">{iconFor(channel.channelType)}{labelFor(channel.channelType)}</div>
        <p className="mt-2 truncate text-sm font-black text-slate-950" title={channel.displayName}>{channel.displayName}</p>
        <p className="mt-1 text-xs text-emerald-700">Connected</p>
      </div>)}</div> : <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">No Meta messaging assets are connected to this business workspace yet.</div>}

      {!status?.providerConfigured && !loading && <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-5 text-amber-900">The Meta App ID, App Secret, Graph version and webhook verify token must be configured on the VPS first.</div>}
      {status?.providerConfigured && !status.onboardingConfigured && !loading && <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-5 text-amber-900">Add the Meta Login for Business configuration ID to the VPS as <code>META_LOGIN_CONFIG_ID</code> before customers can connect.</div>}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" disabled={working || !status?.onboardingConfigured} onClick={() => void connect()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{working ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" />}{channels.length ? 'Reconnect Meta accounts' : 'Connect Meta accounts'}</button>
        {channels.length > 0 && <button type="button" disabled={working} onClick={() => void disconnect()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Unplug className="h-4 w-4" />Disconnect</button>}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">External customer onboarding requires the Meta app to be Live, the business to be verified, and the relevant messaging permissions to have Advanced Access.</p>
    </article>

    {whatsappConnected && <WhatsAppMessagingConsole />}
  </section>;
}
