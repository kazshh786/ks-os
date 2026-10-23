import { chatRequest, type Page } from '../chat/chat.api';

export type MeetingType = 'AUDIO' | 'VIDEO';
export type MeetingParticipant = {
  userId: string; name: string; role: string; invitationState: 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'REMOVED';
  joinedAt: string | null; leftAt: string | null; sessionCount: number;
};
export type Meeting = {
  id: string; conversationId: string; conversationName: string; type: MeetingType;
  status: 'CREATED' | 'RINGING' | 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'FAILED';
  createdBy: string; organizerName: string; title: string; createdAt: string; startedAt: string | null;
  endedAt: string | null; endReason: string | null; expiresAt: string; canManage: boolean;
  invitationState?: MeetingParticipant['invitationState']; participants?: MeetingParticipant[];
};
export type CallingConfig = { enabled: boolean; participantLimit: number; tokenTtlSeconds: number };
export type JoinTicket = { token: string; url: string; identity: string; sessionId: string; expiresIn: number; meeting: Meeting };
const data = async <T>(request: Promise<{ data: T }>) => (await request).data;
export const callsApi = {
  config: () => data(chatRequest<{ data: CallingConfig }>('/meetings/config')),
  incoming: () => data(chatRequest<{ data: Meeting[] }>('/meetings/incoming')),
  history: (conversationId: string, before = '') => chatRequest<Page<Meeting>>(`/${conversationId}/meetings${before ? '?before=' + encodeURIComponent(before) : ''}`),
  create: (conversationId: string, type: MeetingType, requestId: string) => data(chatRequest<{ data: Meeting }>(`/${conversationId}/meetings`, 'POST', { type, requestId })),
  meeting: (id: string) => data(chatRequest<{ data: Meeting }>(`/meetings/${id}`)),
  invitation: (id: string, accept: boolean) => data(chatRequest<{ data: Meeting }>(`/meetings/${id}/invitation`, 'POST', { accept })),
  join: (id: string, requestId: string) => data(chatRequest<{ data: JoinTicket }>(`/meetings/${id}/join`, 'POST', { requestId })),
  leave: (id: string, sessionId: string) => chatRequest(`/meetings/${id}/leave`, 'POST', { sessionId }),
  end: (id: string) => data(chatRequest<{ data: Meeting }>(`/meetings/${id}/end`, 'POST', {})),
  remove: (id: string, userId: string) => chatRequest(`/meetings/${id}/participants/${userId}/remove`, 'POST', {}),
};
export const isJoinable = (meeting: Meeting) => ['CREATED', 'RINGING', 'ACTIVE'].includes(meeting.status) && meeting.invitationState !== 'REMOVED';
export function meetingOutcome(meeting: Meeting) {
  if (meeting.status === 'ACTIVE') return 'In progress';
  if (meeting.status === 'CREATED' || meeting.status === 'RINGING') return 'Calling';
  const reasons: Record<string, string> = { UNANSWERED: 'Unanswered', DECLINED: 'Declined', CALLER_CANCELLED: 'Cancelled by caller', ORGANIZER_ENDED: 'Ended by organiser', ROOM_FINISHED: 'Everyone left', PROVIDER_UNAVAILABLE: 'Connection failed', PROVISIONING_TIMEOUT: 'Connection timed out' };
  return reasons[meeting.endReason || ''] || ({ ENDED: 'Ended', CANCELLED: 'Cancelled', FAILED: 'Failed' } as Record<string, string>)[meeting.status] || meeting.status;
}
export function meetingDuration(meeting: Meeting) {
  if (!meeting.startedAt || !meeting.endedAt) return '';
  const seconds = Math.max(0, Math.floor((Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt)) / 1000));
  return seconds < 60 ? seconds + ' sec' : Math.floor(seconds / 60) + ' min';
}
export const callingError = (cause: unknown) => {
  // DOMException can originate in another browser realm and fail instanceof Error.
  // Only recognise known device names; arbitrary objects never supply display text.
  let name = '';
  if (typeof cause === 'object' && cause !== null) {
    try { const candidate = Reflect.get(cause, 'name'); if (typeof candidate === 'string') name = candidate; } catch { /* Keep the generic safe message. */ }
  }
  if (['NotAllowedError', 'PermissionDeniedError'].includes(name)) return 'Microphone or camera permission was denied. You can join with both off, or allow access in your browser settings.';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) return 'That device is not available. Connect a device or join with it off.';
  if (['NotReadableError', 'TrackStartError'].includes(name)) return 'That device is busy or disconnected. Close other apps using it and try again.';
  return cause instanceof Error ? cause.message : 'The call could not complete this request. Please try again.';
};

