import { useChatUploads,UploadControls } from './ChatAttachments';
import { useEffect, useId, useRef, useState } from 'react';
import { useTyping } from './ChatLive';
import { Send } from 'lucide-react';
import type { CreateNativeMessage, NativePerson } from '@ks-os/contracts';
import { useChatServices } from './ChatServices';

export type Draft = { body: string; mentions: NonNullable<CreateNativeMessage['mentions']>; clientMessageId?: string };
export function adjustMentions(before: string, after: string, mentions: Draft['mentions']): Draft['mentions'] {
  let start = 0, tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length-start && tail < after.length-start && before[before.length-1-tail] === after[after.length-1-tail]) tail++;
  const end = before.length-tail, delta = after.length-before.length;
  return mentions.flatMap(mention => mention.end <= start ? [mention] : mention.start >= end ? [{...mention,start:mention.start+delta,end:mention.end+delta}] : []);
}

export function MessageComposer({ channelId, label = 'Message', initial, saveDraft, send, disabled = false, submitLabel = 'Send message' }: {
  channelId: string; label?: string; initial?: Draft; saveDraft?: (draft: Draft, expected?: Draft) => void;
  send: (draft: Draft) => Promise<void>; disabled?: boolean; submitLabel?: string;
}) {
  const { api: chatApi } = useChatServices();
  const typing=useTyping(channelId);
  const uploads=useChatUploads(channelId);const attachmentsEnabled=submitLabel==='Send message';
  const [draft,setDraft] = useState<Draft>(initial ?? {body:'',mentions:[]});
  const [caret,setCaret] = useState(0), [suggestions,setSuggestions] = useState<NativePerson[]>([]), [highlight,setHighlight] = useState(0);
  const [dismissed,setDismissed] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null), mounted = useRef(true), sending = useRef(false), listId = useId(), inputId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const match = draft.body.slice(0,caret).match(/(?:^|\s)@([^@\n]{0,60})$/);
  const query = match && dismissed !== `${draft.body}:${caret}` ? match[1] : null;
  useEffect(() => {
    setSuggestions([]); setHighlight(0);
    if (query === null || disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void chatApi.people(channelId,false,query,'',controller.signal).then(page => { if (!controller.signal.aborted) setSuggestions(page.data.slice(0,8)); }).catch(() => {});
    },150);
    return () => { clearTimeout(timer); controller.abort(); };
  },[channelId,query,disabled]);
  const update = (value: Draft) => { setDraft(value); saveDraft?.(value); };
  const choose = (person: NativePerson) => {
    if (!match) return;
    const start = caret - query!.length - 1, text = `@${person.name}`;
    const body = draft.body.slice(0,start) + text + ' ' + draft.body.slice(caret);
    const mentions = adjustMentions(draft.body,body,draft.mentions);
    update({body,mentions:[...mentions,{userId:person.userId,start,end:start+text.length}]});
    const next = start + text.length + 1; setCaret(next); setSuggestions([]);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next,next); });
  };
  const submit = async () => {
    if (sending.current || busy || disabled || (!draft.body.trim() && !uploads.ready) || uploads.blocked || draft.body.length > 16000) return;
    typing(false);
    sending.current = true;
    const pending = {...draft,...(attachmentsEnabled?{attachmentIds:uploads.ids()}:{}),clientMessageId:draft.clientMessageId ?? crypto.randomUUID()};
    update(pending); setBusy(true); setError('');
    try {
      await send(pending);uploads.sent();
      saveDraft?.({body:'',mentions:[]},pending);
      if (mounted.current) { setDraft({body:'',mentions:[]}); setCaret(0); textarea.current?.focus(); }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Message was not sent. Your draft is saved.'); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <form className={'chat-composer'+(uploads.dragging?' chat-dragging':'')} onDragOver={e=>{if(attachmentsEnabled&&!disabled&&!busy){e.preventDefault();uploads.setDragging(true);}}} onDragLeave={()=>uploads.setDragging(false)} onDrop={e=>{if(!attachmentsEnabled||disabled||busy)return;e.preventDefault();uploads.setDragging(false);uploads.add(Array.from(e.dataTransfer.files));}} onPaste={e=>{if(!attachmentsEnabled||disabled||busy)return;const images=Array.from(e.clipboardData.files).filter(f=>f.type.startsWith('image/'));if(images.length){e.preventDefault();uploads.add(images);}}} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label htmlFor={inputId}>{label}</label>
    <div className="chat-composer-field">
      <textarea role="combobox" aria-haspopup="listbox" id={inputId} ref={textarea} value={draft.body} disabled={disabled || busy} rows={3}
        placeholder={disabled ? 'This channel is read only' : 'Write a message… Use @ to mention a participant'}
        aria-autocomplete="list" aria-controls={suggestions.length ? listId : undefined} aria-expanded={suggestions.length > 0}
        aria-activedescendant={suggestions.length ? `${listId}-${highlight}` : undefined} aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
        onBlur={()=>typing(false)}
        onChange={event => { const body=event.target.value; typing(Boolean(body.trim())); update({body,mentions:adjustMentions(draft.body,body,draft.mentions)}); setCaret(event.target.selectionStart); }}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (suggestions.length && ['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Escape') { setDismissed(`${draft.body}:${caret}`); setSuggestions([]); }
            else if (event.key === 'Enter') choose(suggestions[highlight]);
            else setHighlight(value => (value + (event.key === 'ArrowDown' ? 1 : suggestions.length-1)) % suggestions.length);
          } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
        }} />
      {suggestions.length > 0 && <ul id={listId} role="listbox" aria-label="Mention a channel member" className="chat-mentions">{suggestions.map((person,index) => <li id={`${listId}-${index}`} key={person.userId} role="option" aria-selected={index===highlight} onMouseDown={event => event.preventDefault()} onClick={() => choose(person)}>{person.name}</li>)}</ul>}
    </div>
    {attachmentsEnabled&&<UploadControls uploads={uploads} disabled={disabled||busy}/>}
    <div className="chat-composer-footer"><small id={`${inputId}-hint`}>Shift + Enter for a new line · {draft.body.length.toLocaleString()}/16,000</small><button type="submit" className="chat-primary" disabled={disabled || busy || (!draft.body.trim() && !uploads.ready) || uploads.blocked || draft.body.length > 16000} aria-label={submitLabel}><Send size={16} aria-hidden="true" />{busy ? 'Saving…' : submitLabel === 'Send message' ? 'Send' : submitLabel}</button></div>
    {draft.body.length > 16000 && <p role="alert" className="chat-error">Your message is too long. The limit is 16,000 characters.</p>}
    {error && <p id={`${inputId}-error`} role="alert" className="chat-error">{error} Your text is retained.</p>}
  </form>;
}
