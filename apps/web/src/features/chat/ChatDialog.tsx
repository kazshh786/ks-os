import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModalDialog } from '../../components/overlays/useModalDialog';

export function ChatDialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useModalDialog<HTMLDivElement>(true, close);
  return <div className="chat-modal-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="chat-modal">
    <header><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={close}><X size={20} aria-hidden="true" /></button></header>{children}
  </div>;
}
export function ConfirmChatAction({ title, description, action, close }: { title: string; description: string; action: () => void; close: () => void }) {
  return <ChatDialog title={title} close={close}><p>{description}</p><footer><button type="button" onClick={close}>Cancel</button><button type="button" className="chat-primary" onClick={action}>{title}</button></footer></ChatDialog>;
}
