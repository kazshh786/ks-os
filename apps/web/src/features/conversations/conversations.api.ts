import type {
  CommunicationChannelConnection,
  ConversationChannel,
  ConversationDetail,
  ConversationListItem,
  ConversationListQuery,
  ConversationMessage,
  SendConversationMessage,
  UpdateConversation,
  UpdateWhatsAppMarketingConsent,
  WhatsAppSendPolicy,
  WhatsAppTemplate,
} from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Inbox request failed');
  return body;
}

export async function listConversations(query: Partial<ConversationListQuery> = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<{ data: ConversationListItem[]; nextCursor: string | null }>(`/api/v1/conversations?${params}`);
}

export async function listConversationChannels() {
  return (await request<{ data: CommunicationChannelConnection[] }>('/api/v1/conversations/channels')).data;
}

export async function getConversation(conversationId: string) {
  return (await request<{ data: ConversationDetail }>(`/api/v1/conversations/${conversationId}`)).data;
}

export async function updateConversation(conversationId: string, input: UpdateConversation) {
  return (await request<{ data: ConversationListItem }>(`/api/v1/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })).data;
}

export async function sendConversationMessage(conversationId: string, input: SendConversationMessage) {
  return (await request<{ data: ConversationMessage }>(`/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })).data;
}

export async function listWhatsAppTemplates(conversationId: string) {
  return request<{ data: WhatsAppTemplate[]; policy: WhatsAppSendPolicy }>(`/api/v1/conversations/${conversationId}/whatsapp/templates`);
}

export async function syncWhatsAppTemplates() {
  return (await request<{ data: { synced: number } }>('/api/v1/conversations/whatsapp/templates/sync', {
    method: 'POST',
  })).data;
}

export async function updateWhatsAppMarketingConsent(conversationId: string, input: UpdateWhatsAppMarketingConsent) {
  return (await request<{ data: WhatsAppSendPolicy }>(`/api/v1/conversations/${conversationId}/whatsapp/marketing-consent`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })).data;
}

export async function createConversationPaymentLink(conversationId: string) {
  return (await request<{ data: { url: string; appointmentId: string; amount: number; currency: string } }>(
    `/api/v1/conversations/${conversationId}/actions/payment-link`,
    { method: 'POST' },
  )).data;
}

export const channelLabels: Record<ConversationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
};
