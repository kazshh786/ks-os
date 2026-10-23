import { createContext, useContext } from 'react';
import { chatApi } from './chat.api';
import { phase4Api, messageLink } from './chat.phase4.api';

/** The same message engine is used in both shells; each shell supplies its authorised transport. */
export type ChatServices = {
  api: typeof chatApi;
  files: typeof phase4Api;
  messageLink: typeof messageLink;
  external: boolean;
  notificationName: string;
};
export const internalChatServices: ChatServices = { api: chatApi, files: phase4Api, messageLink, external: false, notificationName: 'KSOS' };
export const ChatServicesContext = createContext<ChatServices>(internalChatServices);
export const useChatServices = () => useContext(ChatServicesContext);
