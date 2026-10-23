import { createPrivateKey, sign } from 'node:crypto';
import { connect, sensitiveHeaders, type ClientHttp2Session } from 'node:http2';
import type { ProviderTransport, PushAdapter, PushEnvironment, PushOutcome, PushPayload, PushTarget } from './push.types.js';
import { pushReferences, retryAfter } from './push.types.js';

export interface ApnsConfiguration { teamId: string; keyId: string; privateKey: string; applicationId: string; environment: PushEnvironment; voipEnabled: boolean }
/** TLS/HTTP2 connections are retained per provider instance and never shared across teams/environments. */
export function apnsTransport() {
  const sessions = new Map<string, ClientHttp2Session>();
  const transport: ProviderTransport = request => new Promise((resolve, reject) => {
    let session = sessions.get(request.origin);
    if (!session || session.closed || session.destroyed) {
      session = connect(request.origin, { minVersion: 'TLSv1.2' }); sessions.set(request.origin, session);
      const current = session;
      session.on('error', () => { if (sessions.get(request.origin) === current) sessions.delete(request.origin); });
      session.on('goaway', () => { if (sessions.get(request.origin) === current) sessions.delete(request.origin); current.close(); });
    }
    const stream = session.request({ ':method': 'POST', ':path': request.path, ...request.headers, [sensitiveHeaders]: ['authorization', ':path'] });
    let body = '', status = 0; const headers: Record<string, string | undefined> = {};
    stream.setEncoding('utf8'); stream.setTimeout(10000, () => stream.destroy(new Error('APNS_TIMEOUT')));
    stream.on('response', response => { status = Number(response[':status']); for (const [key, value] of Object.entries(response)) if (typeof value === 'string') headers[key] = value; });
    stream.on('data', chunk => { body += chunk; if (body.length > 16384) stream.destroy(new Error('APNS_RESPONSE_LIMIT')); });
    stream.once('error', reject); stream.once('end', () => resolve({ status, headers, body })); stream.end(request.body);
  });
  return { transport, close: () => { for (const session of sessions.values()) session.destroy(); sessions.clear(); } };
}
export class ApnsAdapter implements PushAdapter {
  private token: { value: string; at: number } | undefined;
  private readonly key;
  private readonly connection;
  private readonly transport: ProviderTransport;
  constructor(private config: ApnsConfiguration, transport?: ProviderTransport, private clock = Date.now) {
    this.key = createPrivateKey(config.privateKey.replaceAll('\\n', '\n'));
    if (this.key.asymmetricKeyType !== 'ec' || this.key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APNS_KEY_CONFIGURATION');
    this.connection = transport ? undefined : apnsTransport(); this.transport = transport ?? this.connection!.transport;
  }
  matches(target: Omit<PushTarget, 'token'>) { return target.provider === 'APNS' && target.applicationId === this.config.applicationId && target.environment === this.config.environment && (target.channel === 'ALERT' || this.config.voipEnabled); }
  close() { this.connection?.close(); }
  private authorization() {
    const now = Math.floor(this.clock() / 1000);
    if (this.token && now - this.token.at < 2700 && now >= this.token.at) return this.token.value;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = encode({ alg: 'ES256', kid: this.config.keyId }) + '.' + encode({ iss: this.config.teamId, iat: now });
    this.token = { at: now, value: body + '.' + sign('sha256', Buffer.from(body), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') }; return this.token.value;
  }
  async send(target: PushTarget, payload: PushPayload, deliveryId: string): Promise<PushOutcome> {
    if (!this.matches(target)) return { kind: 'rejected', code: 'APNS_APPLICATION_MISMATCH' };
    if (!/^[a-f0-9]{32,512}$/i.test(target.token) || target.token.length % 2) return { kind: 'invalid', code: 'APNS_TOKEN_FORMAT' };
    if (Date.parse(payload.expiresAt) <= this.clock()) return { kind: 'rejected', code: 'PUSH_EXPIRED' };
    const voip = target.channel === 'VOIP';
    if (voip && (payload.kind !== 'CALL_INCOMING' || !payload.meetingId)) return { kind: 'rejected', code: 'VOIP_CALL_ONLY' };
    const body = JSON.stringify({ aps: voip ? {} : { alert: { title: payload.title, body: payload.body }, ...(payload.sound ? { sound: 'default' } : {}) }, ksos: pushReferences(payload) });
    if (Buffer.byteLength(body) > (voip ? 5120 : 4096)) return { kind: 'rejected', code: 'PUSH_PAYLOAD_TOO_LARGE' };
    try {
      const response = await this.transport({ origin: this.config.environment === 'SANDBOX' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com', path: '/3/device/' + target.token,
        headers: { authorization: 'bearer ' + this.authorization(), 'apns-topic': this.config.applicationId + (voip ? '.voip' : ''), 'apns-push-type': voip ? 'voip' : 'alert', 'apns-id': deliveryId, 'apns-collapse-id': payload.notificationId,
          'apns-priority': '10', 'apns-expiration': voip ? '0' : String(Math.floor(Date.parse(payload.expiresAt) / 1000)), 'content-type': 'application/json' }, body });
      if (response.status === 200) return { kind: 'accepted', providerId: response.headers['apns-id'] };
      let details: { reason?: string; timestamp?: number } = {}; try { details = JSON.parse(response.body); } catch { /* Classify unknown errors by status; never log the provider body. */ }
      const reason = typeof details.reason === 'string' && /^[A-Za-z]{1,80}$/.test(details.reason) ? details.reason : 'ProviderError';
      if (['BadDeviceToken', 'Unregistered', 'ExpiredToken'].includes(reason)) return { kind: 'invalid', code: 'APNS_' + reason, ...(typeof details.timestamp === 'number' ? { invalidSince: details.timestamp } : {}) };
      if (response.status === 429 || response.status >= 500) return { kind: 'retry', code: 'APNS_' + reason, retryAfterMs: Math.max(response.status >= 500 ? 900000 : 60000, retryAfter(response.headers['retry-after'], this.clock()) ?? 0) };
      return { kind: 'rejected', code: 'APNS_' + reason };
    } catch { return { kind: 'retry', code: 'APNS_TRANSPORT', retryAfterMs: 60000 }; }
  }
}
