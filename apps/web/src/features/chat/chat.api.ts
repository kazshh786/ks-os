import type { CreateNativeConversation, CreateNativeMessage, NativeConversation, NativeMessage, NativePerson } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client';

export const chatBase = '/api/v1/communications/conversations';
export type Page<T> = { data: T[]; nextCursor: string | null };
export type DiscoveredChannel = Pick<NativeConversation, 'id' | 'name' | 'description' | 'slug'>;
export class ChatError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function chatRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithAuth(`${chatBase}${path}`, { method, signal, timeoutMs: 15000, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ChatError(typeof result.error === 'string' ? result.error : result.error?.message || 'Chat could not complete this request. Please try again.', response.status);
  return result;
}
const data = async <T>(request: Promise<{ data: T }>) => (await request).data;
export function createChatApi(request: typeof chatRequest = chatRequest) { return {
  capabilities: () => data(request<{ data: { userId: string; canCreateChannels: boolean; canCreateClientChannels?: boolean } }>('/capabilities')),
  channels: (search = '', after = '', signal?: AbortSignal) => request<Page<NativeConversation>>(`?recent=true&limit=50&search=${encodeURIComponent(search)}${after ? `&after=${encodeURIComponent(after)}` : ''}`, 'GET', undefined, signal),
  discover: (search = '', after = '', signal?: AbortSignal) => request<Page<DiscoveredChannel>>(`/discover?search=${encodeURIComponent(search)}${after ? `&after=${after}` : ''}`, 'GET', undefined, signal),
  channel: (id: string) => data(request<{ data: NativeConversation }>(`/${id}`)),
  create: (input: CreateNativeConversation) => data(request<{ data: NativeConversation }>('', 'POST', input)),
  update: (id: string, input: { name: string; description: string }) => data(request<{ data: NativeConversation }>(`/${id}`, 'PATCH', input)),
  action: (id: string, action: 'join' | 'leave' | 'archive' | 'owner', input?: unknown) => request(`/${id}/${action}`, 'POST', input),
  people: (id: string | null, candidates = false, search = '', after = '', signal?: AbortSignal) => request<Page<NativePerson>>(`${id ? `/${id}/${candidates ? 'candidates' : 'members'}` : '/people'}?limit=50&search=${encodeURIComponent(search)}${after ? `&after=${after}` : ''}`, 'GET', undefined, signal),
  add: (id: string, userId: string) => request(`/${id}/members`, 'POST', { userId }),
  remove: (id: string, userId: string) => request(`/${id}/members/${userId}`, 'DELETE'),
  messages: (id: string, parent?: string, before?: string) => request<Page<NativeMessage>>(`/${id}/messages?limit=50${parent ? `&parentMessageId=${parent}` : ''}${before ? `&before=${before}` : ''}`),
  message: (id: string, messageId: string) => data(request<{ data: NativeMessage }>(`/${id}/messages/${messageId}`)),
  resolve: (id: string, ids: string[]) => data(request<{ data: NativeMessage[] }>(`/${id}/messages/resolve`, 'POST', {ids})),
  send: (id: string, input: CreateNativeMessage) => data(request<{ data: NativeMessage }>(`/${id}/messages`, 'POST', input)),
  edit: (id: string, message: NativeMessage, body: string, mentions: CreateNativeMessage['mentions']) => data(request<{ data: NativeMessage }>(`/${id}/messages/${message.id}`, 'PATCH', { body, mentions, expectedUpdatedAt: message.updatedAt })),
  delete: (id: string, messageId: string) => data(request<{ data: NativeMessage }>(`/${id}/messages/${messageId}`, 'DELETE')),
  react: (id: string, messageId: string, emoji: string, active: boolean) => data(request<{ data: NativeMessage }>(`/${id}/messages/${messageId}/reactions`, 'PUT', { emoji, active })),
  read: (id: string, messageId: string) => request(`/${id}/read`, 'POST', { messageId }),
  ticket: () => data(request<{ data: { ticket: string; cursor: string } }>('/realtime-ticket', 'POST')),
}; }
export const chatApi = createChatApi();
