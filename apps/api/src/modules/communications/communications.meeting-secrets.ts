import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { communicationError } from './communications.authorization.js';

function key(env: NodeJS.ProcessEnv = process.env) {
  const value = env.MEETING_INVITATION_SECRET ?? '';
  if (value.length < 32) throw communicationError(503, 'GUEST_MEETINGS_UNAVAILABLE', 'Guest meetings are not configured.');
  return value;
}
export function meetingSecret(purpose: string, id: string, env: NodeJS.ProcessEnv = process.env) {
  return createHmac('sha256', key(env)).update(`ksos-meetings-v1:${purpose}:${id}`).digest('base64url');
}
export function invitationToken(id: string, env: NodeJS.ProcessEnv = process.env) { return `${id}.${meetingSecret('invitation', id, env)}`; }
export function secretHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function sameSecret(value: string, expectedHash: string) {
  const left = Buffer.from(secretHash(value)); const right = Buffer.from(expectedHash);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function meetingOrigin(env: NodeJS.ProcessEnv = process.env) {
  let url: URL; try { url = new URL(env.PUBLIC_MEETING_ORIGIN ?? ''); } catch { throw communicationError(503, 'GUEST_MEETINGS_UNAVAILABLE', 'Guest meetings are not configured.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw communicationError(503, 'GUEST_MEETINGS_UNAVAILABLE', 'Guest meetings are not configured.');
  return url.origin;
}
export function invitationUrl(id: string, env: NodeJS.ProcessEnv = process.env) { return `${meetingOrigin(env)}/meet#invite=${invitationToken(id, env)}`; }
export function guestCredential(id: string) { return meetingSecret('guest-session', id); }
export function guestCsrf(id: string) { return meetingSecret('guest-csrf', id); }
export function guestMeetingsConfigured() { try { key(); meetingOrigin(); return true; } catch { return false; } }
