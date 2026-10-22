import type { CommunicationsEvent } from '@ks-os/contracts';
import type { SubscribeChat } from '../chat/MessageTimeline';

// The workspace's existing communications connection feeds this in-process fan-out.
// It opens no socket and stores no messages or tenant data.
const listeners = new Set<(event: CommunicationsEvent) => void>();
const invalidations = new Set<() => void>();
export const subscribeMeetings: SubscribeChat = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function publishMeetingEvent(event: CommunicationsEvent) {
  if (!event.type.startsWith('meeting.') && !event.type.startsWith('guest.') && !event.type.startsWith('call.')) return;
  for (const listener of listeners) listener(event);
  invalidateMeetings();
}
export function invalidateMeetings() { for (const listener of invalidations) listener(); }
export function onMeetingsInvalidated(listener: () => void) { invalidations.add(listener); return () => { invalidations.delete(listener); }; }
export const noMeetingSubscription: SubscribeChat = () => () => undefined;
