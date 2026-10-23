import { MobilePushReferencesSchema, type MobilePushReferences } from '@ks-os/contracts';

export type PushProvider = 'APNS' | 'FCM';
export type PushChannel = 'ALERT' | 'VOIP';
export type PushEnvironment = 'SANDBOX' | 'PRODUCTION';
export interface PushTarget { provider: PushProvider; channel: PushChannel; applicationId: string; environment: PushEnvironment; token: string }
export interface PushPayload {
  notificationId: string; tenantId: string; kind: string; context: 'TENANT' | 'CUSTOMER';
  conversationId?: string; meetingId?: string; relationshipId?: string;
  expiresAt: string; title: string; body: string; sound: boolean;
}
export type PushOutcome =
  | { kind: 'accepted'; providerId?: string }
  | { kind: 'invalid'; code: string; invalidSince?: number }
  | { kind: 'retry'; code: string; retryAfterMs?: number }
  | { kind: 'rejected'; code: string };
export interface PushAdapter { matches(target: Omit<PushTarget, 'token'>): boolean; prepare?(): Promise<void>; send(target: PushTarget, payload: PushPayload, deliveryId: string): Promise<PushOutcome>; close?(): void }
export interface ProviderResponse { status: number; headers: Record<string, string | undefined>; body: string }
export type ProviderRequest = { origin: string; path: string; headers: Record<string, string>; body: string };
export type ProviderTransport = (request: ProviderRequest) => Promise<ProviderResponse>;
export const pushReferences = (payload: PushPayload): MobilePushReferences => MobilePushReferencesSchema.parse(Object.fromEntries(Object.entries({
  version: '1', notificationId: payload.notificationId, tenantId: payload.tenantId, kind: payload.kind,
  context: payload.context, conversationId: payload.conversationId, meetingId: payload.meetingId,
  relationshipId: payload.relationshipId, expiresAt: payload.expiresAt,
}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
export function retryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value); const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(duration) ? Math.min(86400000, Math.max(0, duration)) : undefined;
}
