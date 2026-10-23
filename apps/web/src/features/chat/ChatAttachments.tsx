import { useEffect,useRef,useState } from 'react';
import type { ChatAttachment } from '@ks-os/contracts';
import { Paperclip,Download,FileText,Image as ImageIcon,X } from 'lucide-react';
import { useChatServices } from './ChatServices';
import { ChatDialog } from './ChatDialog';
type Upload={key:string;file:File;id?:string;progress:number;state:'queued'|'uploading'|'ready'|'failed';error?:string;controller?:AbortController};
export function useChatUploads(channelId:string){
 const { files: phase4Api } = useChatServices();
 const [items,setItems]=useState<Upload[]>([]),[error,setError]=useState(''),[dragging,setDragging]=useState(false);
 const latest=useRef(items);latest.current=items;const mounted=useRef(true),active=useRef(0),started=useRef(new Set<string>());
 const update=(key:string,patch:Partial<Upload>)=>{if(mounted.current)setItems(values=>values.map(v=>v.key===key?{...v,...patch}:v));};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;for(const item of latest.current){item.controller?.abort();if(item.id)void phase4Api.remove(channelId,item.id).catch(()=>{});}};},[channelId]);
 useEffect(()=>{
  for(const item of items){
   if(item.state!=='queued'||active.current>=2||started.current.has(item.key))continue;
   started.current.add(item.key);active.current++;
   const controller=new AbortController();
   update(item.key,{state:'uploading',controller});
   void (async()=>{
    try {
     const policy=await phase4Api.policy();
     if(item.file.size>policy.maxBytes)throw new Error('File exceeds the '+Math.floor(policy.maxBytes/1048576)+' MB limit.');
     if(!policy.allowed.includes(item.file.name.split('.').at(-1)!.toLowerCase()))throw new Error('This file type is not allowed.');
     const reserved=await phase4Api.reserve(channelId,item.file);update(item.key,{id:reserved.id});
     if(controller.signal.aborted){void phase4Api.remove(channelId,reserved.id).catch(()=>{});return;}
     const result=await phase4Api.upload(channelId,reserved.id,item.file,controller.signal,p=>update(item.key,{progress:p}));
     if(result.status!=='AVAILABLE')throw new Error('Quarantined: document scanning is unavailable. This file cannot be sent yet.');
     update(item.key,{state:'ready',progress:100});
    }catch(cause){update(item.key,{state:'failed',error:cause instanceof Error?cause.message:'Upload failed'});}
    finally{active.current--;if(mounted.current)setItems(values=>[...values]);}
   })();
  }
 },[items,channelId]);
 const add=(files:File[])=>{
  if(files.length+latest.current.length>10){setError('Attach up to 10 files per message.');return;}
  setError('');setItems(values=>[...values,...files.map(file=>({key:crypto.randomUUID(),file,progress:0,state:'queued' as const}))]);
 };
 const remove=(item:Upload)=>{item.controller?.abort();if(item.id)void phase4Api.remove(channelId,item.id).catch(()=>{});setItems(values=>values.filter(v=>v.key!==item.key));};
 return {items,error,dragging,setDragging,add,remove,
  retry:(item:Upload)=>{started.current.delete(item.key);if(item.id)void phase4Api.remove(channelId,item.id).catch(()=>{});update(item.key,{state:'queued',progress:0,error:undefined,id:undefined});},
  ready:items.length>0&&items.every(i=>i.state==='ready'),blocked:items.some(i=>i.state!=='ready'),
  ids:()=>items.filter(i=>i.state==='ready').map(i=>i.id!),sent:()=>{setItems([]);latest.current=[];started.current.clear();},
 };
}
export function UploadControls({uploads,disabled}:{uploads:ReturnType<typeof useChatUploads>;disabled:boolean}){
 return <div className="chat-upload-controls"><label className="chat-attach-button"><Paperclip size={16} aria-hidden="true"/>Attach files<input aria-label="Attach files" type="file" multiple disabled={disabled} onChange={e=>{uploads.add(Array.from(e.target.files||[]));e.target.value='';}}/></label>
  {uploads.dragging&&<p role="status">Drop files to attach</p>}
  {uploads.error&&<p role="alert" className="chat-error">{uploads.error}</p>}
  <ul>{uploads.items.map(item=><li key={item.key}><span>{item.file.name}</span><small>{item.state==='ready'?'Ready to send':item.state==='uploading'&&item.progress===100?'Validating…':item.state}</small>
   {item.state==='uploading'&&<progress aria-label={'Uploading '+item.file.name} max={100} value={item.progress}/>}
   {item.error&&<p role="alert" className="chat-error">{item.error}</p>}
   {item.state==='failed'&&<button type="button" disabled={disabled} onClick={()=>uploads.retry(item)}>Retry {item.file.name}</button>}
   <button type="button" disabled={disabled} aria-label={(item.state==='uploading'?'Cancel upload ':'Remove ')+item.file.name} onClick={()=>uploads.remove(item)}><X size={15}/></button></li>)}</ul>
 </div>;
}
export function AttachmentCard({attachment,conversationId}:{attachment:ChatAttachment;conversationId:string}){
 const { files: phase4Api } = useChatServices();
 const [thumb,setThumb]=useState(''),[preview,setPreview]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const opening=useRef<AbortController|null>(null);
 useEffect(()=>()=>{opening.current?.abort();},[conversationId,attachment.id]);
 useEffect(()=>{if(!attachment.thumbnail)return;const controller=new AbortController();let url='';
  void phase4Api.content(conversationId,attachment.id,true,controller.signal).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setThumb(url);}).catch(()=>{if(!controller.signal.aborted)setError('Preview unavailable');});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[conversationId,attachment.id,attachment.thumbnail]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 const open=async(download:boolean)=>{opening.current?.abort();const controller=new AbortController();opening.current=controller;setBusy(true);setError('');try{
  const blob=await phase4Api.content(conversationId,attachment.id,false,controller.signal);if(controller.signal.aborted)return;const url=URL.createObjectURL(blob);
  if(download){const a=document.createElement('a');a.href=url;a.download=attachment.mimeType==='image/webp'?attachment.fileName.replace(/\.[^.]+$/,'.webp'):attachment.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  else setPreview(url);
 }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'File unavailable');}finally{if(!controller.signal.aborted)setBusy(false);}};
 const image=attachment.mimeType.startsWith('image/'),pdf=attachment.mimeType==='application/pdf';
 return <div className="chat-attachment-card">
  {thumb?<button type="button" className="chat-thumbnail" onClick={()=>void open(false)} aria-label={'Preview '+attachment.fileName}><img src={thumb} alt={attachment.fileName} loading="lazy"/></button>:image?<ImageIcon aria-hidden="true"/>:<FileText aria-hidden="true"/>}
  <div><strong>{attachment.fileName}</strong><small>{Math.max(1,Math.round(attachment.sizeBytes/1024)).toLocaleString()} KB · {image?'Image':attachment.mimeType}</small>
  <button type="button" disabled={busy} onClick={()=>void open(true)}><Download size={14} aria-hidden="true"/>Download</button>
  {(image||pdf)&&<button type="button" disabled={busy} onClick={()=>void open(false)}>Preview</button>}</div>
  {busy&&<span role="status">Opening file…</span>}{error&&<p role="alert" className="chat-error">{error}</p>}
  {preview&&<ChatDialog title={attachment.fileName} close={()=>setPreview('')}>{image?<img className="chat-image-viewer" src={preview} alt={attachment.fileName}/>:<><p>PDF preview. If your browser cannot display it, use Download.</p><iframe className="chat-pdf-viewer" sandbox="" title={'PDF preview: '+attachment.fileName} src={preview}/></>}<button type="button" onClick={()=>void open(true)}>Download file</button></ChatDialog>}
 </div>;
}
export function SharedFiles({conversationId}:{conversationId:string}){
 const { files: phase4Api } = useChatServices();
 const [files,setFiles]=useState<ChatAttachment[]>([]),[cursor,setCursor]=useState<string|null>(null),[type,setType]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError('');void phase4Api.files(conversationId,'',type).then(page=>{if(active){setFiles(page.data);setCursor(page.nextCursor);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[conversationId,type]);
 return <section className="chat-files-panel"><h3>Shared files</h3><label>File type<select value={type} onChange={e=>setType(e.target.value)}><option value="">All files</option><option value="image">Images</option><option value="document">Documents</option></select></label>
 {loading&&<p role="status">Loading files…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!files.length&&<p>No files shared yet.</p>}
 {files.map(file=><div key={file.id}><AttachmentCard attachment={file} conversationId={conversationId}/><small>{file.uploaderName} · {new Date(file.createdAt).toLocaleDateString()}</small></div>)}
 {cursor&&<button type="button" disabled={loading} onClick={()=>{setLoading(true);void phase4Api.files(conversationId,cursor,type).then(page=>{setFiles(current=>[...current,...page.data]);setCursor(page.nextCursor);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));}}>More files</button>}
 </section>;
}
