import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const unavailable = () => Object.assign(new Error('Customer collaboration is not configured.'), { statusCode: 503, code: 'COLLABORATION_UNAVAILABLE' });
export function collaborationOrigin(env: NodeJS.ProcessEnv = process.env) {
  let url: URL; try { url = new URL(env.PUBLIC_CUSTOMER_PORTAL_ORIGIN ?? ''); } catch { throw unavailable(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw unavailable();
  return url.origin;
}
export const collaborationHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function collaborationInvitationToken(id: string, env: NodeJS.ProcessEnv = process.env) {
  const key = env.CUSTOMER_COLLABORATION_SECRET;
  if (!key || key.length < 32) throw unavailable();
  return `${id}.${createHmac('sha256', key).update(`ksos-customer-collaboration-v1:invitation:${id}`).digest('base64url')}`;
}
export const collaborationInvitationUrl = (id: string) => `${collaborationOrigin()}/customer/invite#invite=${collaborationInvitationToken(id)}`;
export function collaborationSecretMatches(value: string, hash: string) {
  const left = Buffer.from(collaborationHash(value)), right = Buffer.from(hash);
  return left.length === right.length && timingSafeEqual(left, right);
}
