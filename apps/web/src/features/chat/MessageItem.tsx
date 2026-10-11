import { AttachmentCard } from './ChatAttachments';
import { memo, useState } from 'react';
import { MessageSquare, Pencil, Smile, Trash2 } from 'lucide-react';
import { NativeReactionSchema, type NativeMessage } from '@ks-os/contracts';
import { chatApi } from './chat.api';
import { ChatDialog, ConfirmChatAction } from './ChatDialog';
import { MessageComposer } from './MessageComposer';

export function MessageBody({ message }: { message: NativeMessage }) {
  if (message.deletedAt) return <p className="chat-deleted">This message was deleted.</p>;
  const parts: React.ReactNode[] = []; let offset = 0;
  for (const mention of [...(message.mentions ?? [])].sort((a,b)=>a.start-b.start)) {
    if (mention.start < offset || mention.end > (message.body?.length ?? 0)) continue;
    parts.push(message.body?.slice(offset,mention.start));
    parts.push(<mark key={mention.start} title={`Mentioned ${mention.name}`}>{message.body?.slice(mention.start,mention.end)}</mark>); offset=mention.end;
  }
  parts.push(message.body?.slice(offset));
  return <p className="chat-body">{parts}</p>;
}
export const MessageItem = memo(function MessageItem({ message, userId, archived, grouped = false, thread, changed }: {
  message: NativeMessage; userId: string; archived: boolean; grouped?: boolean; thread?: (message: NativeMessage) => void; changed: (message: NativeMessage) => void;
}) {
  const [edit,setEdit]=useState(false),[remove,setRemove]=useState(false),[picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const own=message.senderId===userId, name=message.senderName || 'Former colleague';
  const run=async(work:()=>Promise<NativeMessage>)=>{ setBusy(true);setError('');try {changed(await work());}catch(cause){setError(cause instanceof Error?cause.message:'Could not update message');}finally{setBusy(false);} };
  return <article className={`chat-message${grouped ? ' chat-grouped' : ''}`} aria-label={`${name}, ${new Date(message.createdAt).toLocaleString()}`}>
    <div className="chat-avatar" aria-hidden="true">{name.split(' ').map(word=>word[0]).slice(0,2).join('').toUpperCase()}</div>
    <div className="chat-message-content"><header><strong>{name}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>{message.editedAt && !message.deletedAt && <small>edited</small>}</header>
      <MessageBody message={message} />
      {!message.deletedAt&&message.attachments?.map(file=><AttachmentCard key={file.id} attachment={file} conversationId={message.conversationId}/>)}
      <div className="chat-reactions">{message.reactions?.map(reaction=><button key={reaction.emoji} type="button" disabled={archived || busy} aria-pressed={reaction.mine} aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count===1?'':'s'}${reaction.mine?', including you':''}`} onClick={()=>void run(()=>chatApi.react(message.conversationId,message.id,reaction.emoji,!reaction.mine))}>{reaction.emoji} <span>{reaction.count}</span></button>)}</div>
      {thread && <button type="button" className="chat-thread-link" onClick={()=>thread(message)}><MessageSquare size={14} aria-hidden="true" />{message.replyCount ? `${message.replyCount} ${message.replyCount===1?'reply':'replies'}` : 'Reply in thread'}</button>}
      {!message.deletedAt && !archived && <div className="chat-message-actions"><button type="button" aria-label="Add reaction" aria-expanded={picker} onClick={()=>setPicker(!picker)}><Smile size={15} aria-hidden="true" /></button>{own && <><button type="button" aria-label="Edit message" onClick={()=>setEdit(true)}><Pencil size={15} aria-hidden="true" /></button><button type="button" aria-label="Delete message" onClick={()=>setRemove(true)}><Trash2 size={15} aria-hidden="true" /></button></>}</div>}
      {picker && <div className="chat-emoji-picker" aria-label="Choose a reaction">{NativeReactionSchema.options.map(emoji=><button key={emoji} type="button" disabled={busy} aria-label={`React ${emoji}`} onClick={()=>{setPicker(false);void run(()=>chatApi.react(message.conversationId,message.id,emoji,true));}}>{emoji}</button>)}</div>}
      {error && <p role="alert" className="chat-error">{error}</p>}
    </div>
    {edit && <ChatDialog title="Edit message" close={()=>setEdit(false)}><MessageComposer channelId={message.conversationId} label="Message text" initial={{body:message.body || '',mentions:message.mentions ?? []}} submitLabel="Save changes" send={async draft=>{changed(await chatApi.edit(message.conversationId,message,draft.body,draft.mentions));setEdit(false);}} /></ChatDialog>}
    {remove && <ConfirmChatAction title="Delete message" description="The message text will be removed. Replies will remain in the thread." close={()=>setRemove(false)} action={()=>{setRemove(false);void run(()=>chatApi.delete(message.conversationId,message.id));}} />}
  </article>;
});
