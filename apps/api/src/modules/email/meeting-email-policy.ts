export type MeetingEmailKind = 'invite' | 'rescheduled' | 'cancelled';
export interface MeetingEmailSnapshot {
  tenantId: string; meetingId: string; invitationId: string; version: number; status: string;
  invitationEmail: string | null; invitationHash: string; revokedAt: Date | string | null; expiresAt: Date | string;
  tenantActive: boolean; tenantStatus: string;
  title: string; scheduledStartAt: Date | string; scheduledEndAt: Date | string; timezone: string; hostName: string;
}
export interface MeetingEmailMessage {
  tenantId: string; meetingId: string; invitationId: string; version: number; kind: MeetingEmailKind; recipientEmail: string; derivedInvitationHash?: string;
}

/** Fail closed if the queued reference is no longer the same authorized invitation. */
export function meetingEmailCancellationCode(snapshot: MeetingEmailSnapshot | undefined, message: MeetingEmailMessage, now = new Date()): string | null {
  if (!snapshot || snapshot.tenantId !== message.tenantId || snapshot.meetingId !== message.meetingId || snapshot.invitationId !== message.invitationId) return 'MEETING_NOTIFICATION_SCOPE_CHANGED';
  if (!snapshot.tenantActive || ['SUSPENDED', 'OFFBOARDING', 'OFFBOARDED'].includes(snapshot.tenantStatus)) return 'MEETING_NOTIFICATION_TENANT_UNAVAILABLE';
  if (!snapshot.invitationEmail || snapshot.invitationEmail.toLowerCase() !== message.recipientEmail.toLowerCase()) return 'MEETING_NOTIFICATION_RECIPIENT_CHANGED';
  if (Number(snapshot.version) !== message.version) return 'MEETING_NOTIFICATION_SUPERSEDED';
  if (message.kind === 'cancelled') return snapshot.status === 'CANCELLED' ? null : 'MEETING_NOTIFICATION_NO_LONGER_CANCELLED';
  if (!['SCHEDULED', 'CREATED', 'RINGING', 'ACTIVE'].includes(snapshot.status)) return 'MEETING_NOTIFICATION_NO_LONGER_JOINABLE';
  if (!message.derivedInvitationHash || snapshot.invitationHash !== message.derivedInvitationHash) return 'MEETING_NOTIFICATION_CREDENTIAL_CHANGED';
  if (snapshot.revokedAt || !Number.isFinite(new Date(snapshot.expiresAt).getTime()) || new Date(snapshot.expiresAt).getTime() <= now.getTime()) return 'MEETING_NOTIFICATION_INVITATION_EXPIRED';
  return null;
}

export function meetingEmailTemplateData(snapshot: MeetingEmailSnapshot, kind: MeetingEmailKind, invitationUrl?: string): Record<string, unknown> {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: snapshot.timezone, dateStyle: 'full', timeStyle: 'short' });
  return {
    kind, meetingTitle: snapshot.title, hostName: snapshot.hostName,
    scheduleLabel: `${format.format(new Date(snapshot.scheduledStartAt))} – ${format.format(new Date(snapshot.scheduledEndAt))} (${snapshot.timezone})`,
    expiresLabel: format.format(new Date(snapshot.expiresAt)),
    emailSubject: kind === 'cancelled' ? 'Your meeting has been cancelled' : kind === 'rescheduled' ? 'Your meeting has been rescheduled' : 'Your meeting invitation',
    ...(kind !== 'cancelled' && invitationUrl ? { invitationUrl } : {}),
  };
}
