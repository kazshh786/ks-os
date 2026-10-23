export interface CollaborationEmailSnapshot {
  id: string; tenantId: string; email: string; secretHash: string; status: string; expiresAt: string | Date;
  revokedAt: string | Date | null; archivedAt: string | Date | null; external: boolean; tenantActive: boolean; tenantStatus: string;
  channelName: string;
}
export function collaborationEmailCancellationCode(row: CollaborationEmailSnapshot | undefined, message: { invitationId: string; tenantId: string; recipient: string; derivedHash: string }, now = new Date()) {
  if (!row || row.id !== message.invitationId || row.tenantId !== message.tenantId || row.email !== message.recipient || row.secretHash !== message.derivedHash) return 'COLLABORATION_INVITATION_SCOPE_CHANGED';
  if (row.status !== 'PENDING' || row.revokedAt || row.archivedAt || !row.external || !row.tenantActive || ['SUSPENDED','OFFBOARDING','OFFBOARDED'].includes(row.tenantStatus)) return 'COLLABORATION_INVITATION_UNAVAILABLE';
  if (!Number.isFinite(new Date(row.expiresAt).getTime()) || new Date(row.expiresAt).getTime() <= now.getTime()) return 'COLLABORATION_INVITATION_EXPIRED';
  return null;
}
