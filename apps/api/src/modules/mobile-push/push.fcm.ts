import { createPrivateKey, sign } from 'node:crypto';
import { pushReferences, retryAfter, type ProviderTransport, type PushAdapter, type PushEnvironment, type PushOutcome, type PushPayload, type PushTarget } from './push.types.js';

export const httpsPushTransport: ProviderTransport = async request => {
  const response = await fetch(request.origin + request.path, { method: 'POST', headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(10000) });
  return { status: response.status, headers: { 'retry-after': response.headers.get('retry-after') ?? undefined }, body: (await response.text()).slice(0, 65536) };
};
export interface FcmConfiguration { projectId: string; clientEmail: string; privateKey: string; applicationId: string; environment: PushEnvironment }
export class FcmAdapter implements PushAdapter {
  private readonly key;
  private access: { token: string; expires: number } | undefined;
  private pending: Promise<string> | undefined;
  constructor(private config: FcmConfiguration, private transport: ProviderTransport = httpsPushTransport, private clock = Date.now) {
    this.key = createPrivateKey(config.privateKey.replaceAll('\\n', '\n'));
    if (this.key.asymmetricKeyType !== 'rsa' || (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('FCM_KEY_CONFIGURATION');
  }
  matches(target: Omit<PushTarget, 'token'>) { return target.provider === 'FCM' && target.channel === 'ALERT' && target.applicationId === this.config.applicationId && target.environment === this.config.environment; }
  private async exchange() {
    const now = Math.floor(this.clock() / 1000), encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: this.config.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const assertion = body + '.' + sign('RSA-SHA256', Buffer.from(body), this.key).toString('base64url');
    const response = await this.transport({ origin: 'https://oauth2.googleapis.com', path: '/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
    if (response.status !== 200) throw Object.assign(new Error('FCM_AUTHENTICATION'), { permanent: response.status >= 400 && response.status < 500 && response.status !== 429 });
    const data = JSON.parse(response.body) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || data.expires_in < 60) throw new Error('FCM_AUTHENTICATION');
    this.access = { token: data.access_token, expires: this.clock() + Math.min(data.expires_in, 3600) * 1000 }; return data.access_token;
  }
  private async authorization() {
    if (this.access && this.access.expires > this.clock() + 60000) return this.access.token;
    this.pending ??= this.exchange(); try { return await this.pending; } finally { this.pending = undefined; }
  }
  async prepare() { await this.authorization(); }
  async send(target: PushTarget, payload: PushPayload, _deliveryId: string): Promise<PushOutcome> {
    if (!this.matches(target)) return { kind: 'rejected', code: 'FCM_APPLICATION_MISMATCH' };
    const ttl = Math.min(86400, Math.floor((Date.parse(payload.expiresAt) - this.clock()) / 1000));
    if (ttl <= 0) return { kind: 'rejected', code: 'PUSH_EXPIRED' };
    if (!target.token || target.token.length > 4096 || /\s/.test(target.token)) return { kind: 'invalid', code: 'FCM_TOKEN_FORMAT' };
    const incoming = payload.kind === 'CALL_INCOMING';
    const body = JSON.stringify({ message: { token: target.token, data: pushReferences(payload), ...(!incoming ? { notification: { title: payload.title, body: payload.body } } : {}), android: {
      priority: incoming ? 'HIGH' : 'NORMAL', ttl: incoming ? '0s' : ttl + 's', restricted_package_name: this.config.applicationId,
      ...(!incoming ? { notification: { tag: payload.notificationId, ...(payload.sound ? { default_sound: true } : {}), visibility: 'PRIVATE' } } : {}),
    } } });
    if (Buffer.byteLength(body) > 4096) return { kind: 'rejected', code: 'PUSH_PAYLOAD_TOO_LARGE' };
    try {
      const response = await this.transport({ origin: 'https://fcm.googleapis.com', path: '/v1/projects/' + encodeURIComponent(this.config.projectId) + '/messages:send', headers: { authorization: 'Bearer ' + await this.authorization(), 'content-type': 'application/json' }, body });
      let data: { name?: unknown; error?: { status?: string; details?: { '@type'?: string; errorCode?: string }[] } } = {}; try { data = JSON.parse(response.body); } catch { /* No raw provider response is exposed or logged. */ }
      if (response.status >= 200 && response.status < 300) return { kind: 'accepted', ...(typeof data.name === 'string' && /^projects\/[\w/-]{1,200}$/.test(data.name) ? { providerId: data.name } : {}) };
      const detail = Array.isArray(data.error?.details) ? data.error.details.find(value => value['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode : undefined;
      if (detail === 'UNREGISTERED') return { kind: 'invalid', code: 'FCM_UNREGISTERED' };
      const reason = detail ?? data.error?.status;
      const code = reason && /^[A-Z_]{1,80}$/.test(reason) ? 'FCM_' + reason : 'FCM_PROVIDER_ERROR';
      if (response.status === 429 || response.status >= 500) return { kind: 'retry', code, retryAfterMs: Math.max(response.status === 429 ? 60000 : 1000, retryAfter(response.headers['retry-after'], this.clock()) ?? 0) };
      // INVALID_ARGUMENT also describes bad payloads; it never automatically deletes a registration.
      if (response.status === 401) this.access = undefined;
      return { kind: 'rejected', code };
    } catch (error) { return (error as { permanent?: boolean })?.permanent ? { kind: 'rejected', code: 'FCM_AUTHENTICATION' } : { kind: 'retry', code: 'FCM_TRANSPORT', retryAfterMs: 60000 }; }
  }
}
