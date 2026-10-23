import { render,screen,fireEvent,waitFor,cleanup,act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,useLocation } from 'react-router';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { ChatSearch } from './ChatSearch';
import { ChatNotifications,browserPermission,shouldAlert } from './ChatNotifications';
import { AttachmentCard } from './ChatAttachments';
import { phase4Api,messageLink,type ChatNotice } from './chat.phase4.api';
vi.mock('./chat.api',async original=>({...await original<typeof import('./chat.api')>(),chatApi:{people:vi.fn().mockResolvedValue({data:[],nextCursor:null})}}));
vi.mock('./chat.phase4.api',async original=>({...await original<typeof import('./chat.phase4.api')>(),phase4Api:{
 policy:vi.fn(),reserve:vi.fn(),upload:vi.fn(),remove:vi.fn(),content:vi.fn(),search:vi.fn(),preferences:vi.fn(),notifications:vi.fn(),savePreferences:vi.fn(),conversationPreference:vi.fn(),readNotice:vi.fn(),
}}));
const id='11111111-1111-4111-8111-111111111111';
const pref={browser:false,inApp:true,sound:false,dnd:false,directMessages:true};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(phase4Api.policy).mockResolvedValue({maxBytes:1024,allowed:['txt','png']});vi.mocked(phase4Api.reserve).mockResolvedValue({id});vi.mocked(phase4Api.remove).mockResolvedValue({});vi.mocked(phase4Api.preferences).mockResolvedValue(pref);vi.mocked(phase4Api.notifications).mockResolvedValue({data:[],nextCursor:null});vi.mocked(phase4Api.readNotice).mockResolvedValue({});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('uploads files with progress, blocks send until available, and sends attachment-only messages',async()=>{
 let finish!:(value:any)=>void;vi.mocked(phase4Api.upload).mockImplementation((_c,_i,_f,_s,progress)=>{progress(60);return new Promise(resolve=>{finish=resolve;});});
 const send=vi.fn().mockResolvedValue(undefined);render(<MessageComposer channelId={id} send={send}/>);
 fireEvent.change(screen.getByLabelText('Attach files'),{target:{files:[new File(['hello'],'report.txt')]}});
 await waitFor(()=>expect(screen.getByRole('progressbar')).toHaveAttribute('value','60'));
 expect(screen.getByRole('button',{name:'Send message'})).toBeDisabled();
 finish({id,status:'AVAILABLE'});
 await screen.findByText('Ready to send');await userEvent.click(screen.getByRole('button',{name:'Send message'}));
 expect(send).toHaveBeenCalledWith(expect.objectContaining({body:'',attachmentIds:[id]}));
 await waitFor(()=>expect(screen.queryByText('report.txt')).not.toBeInTheDocument());
});
it('supports drop and pasted images with a file input alternative; quarantined uploads cannot send',async()=>{
 vi.mocked(phase4Api.upload).mockResolvedValue({id,status:'QUARANTINED'} as any);
 render(<MessageComposer channelId={id} send={vi.fn()}/>);
 const textarea=screen.getByRole('combobox',{name:'Message'}),form=textarea.closest('form')!;
 fireEvent.drop(form,{dataTransfer:{files:[new File(['hello'],'report.txt')]}});
 expect(await screen.findByRole('alert')).toHaveTextContent('Quarantined');
 expect(screen.getByRole('button',{name:'Send message'})).toBeDisabled();
 await userEvent.click(screen.getByRole('button',{name:'Remove report.txt'}));
 fireEvent.paste(textarea,{clipboardData:{files:[new File(['image'],'pasted.png',{type:'image/png'})]}});
 await screen.findByText('pasted.png');
});
it('shows upload limits and retains failed files for retry',async()=>{
 render(<MessageComposer channelId={id} send={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('Attach files'),{target:{files:[new File(['x'.repeat(2048)],'large.txt')]}});
 expect(await screen.findByRole('alert')).toHaveTextContent('exceeds');
 expect(screen.getByRole('button',{name:'Retry large.txt'})).toBeEnabled();expect(phase4Api.upload).not.toHaveBeenCalled();
});
it('searches with filters and renders highlighted untrusted text without HTML',async()=>{
 vi.mocked(phase4Api.search).mockResolvedValue({data:[{id,conversationId:id,parentMessageId:null,senderName:'Ada',conversationName:'Team',excerpt:'<script>budget</script>',createdAt:'2026-10-11T00:00:00Z',position:'1'}],nextCursor:null});
 render(<MemoryRouter><ChatSearch channels={[]} close={vi.fn()}/></MemoryRouter>);
 await userEvent.type(screen.getByLabelText('Search text'),'budget');await userEvent.click(screen.getByLabelText('Has attachments'));await userEvent.click(screen.getByRole('button',{name:'Search'}));
 await screen.findByText('<script>budget</script>');expect(document.querySelector('script')).toBeNull();expect(vi.mocked(phase4Api.search).mock.calls[0][0].get('attachments')).toBe('true');
});
it('notification permission is requested only on opt-in and settings persist',async()=>{
 const requestPermission=vi.fn().mockResolvedValue('granted');vi.stubGlobal('Notification',{permission:'default',requestPermission});
 vi.mocked(phase4Api.savePreferences).mockImplementation(async p=>p);
 render(<MemoryRouter><ChatNotifications subscribe={()=>()=>{}} revision={0}/></MemoryRouter>);
 await userEvent.click(screen.getByRole('button',{name:'Chat notification settings'}));
 await screen.findByLabelText('Browser notifications');expect(requestPermission).not.toHaveBeenCalled();
 await userEvent.click(screen.getByLabelText('Browser notifications'));await waitFor(()=>expect(phase4Api.savePreferences).toHaveBeenCalledWith({...pref,browser:true}));
 vi.stubGlobal('Notification',{permission:'denied',requestPermission});expect(await browserPermission()).toBe('denied');expect(requestPermission).toHaveBeenCalledTimes(1);
 expect(shouldAlert({...pref,dnd:true},{readAt:null,conversationId:id} as any)).toBe(false);
 expect(shouldAlert(pref,{readAt:null,conversationId:id} as any,id,true)).toBe(false);
});
it('image thumbnails use the authenticated thumbnail request and revoke blob URLs',async()=>{
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn().mockReturnValue('blob:private'),revokeObjectURL:vi.fn()}));
 vi.mocked(phase4Api.content).mockResolvedValue(new Blob(['image'],{type:'image/webp'}));
 const {unmount}=render(<AttachmentCard conversationId={id} attachment={{id,fileName:'image.png',mimeType:'image/webp',sizeBytes:50,status:'AVAILABLE',thumbnail:true,uploadedBy:id,createdAt:'2026-10-11T00:00:00Z'}}/>);
 await screen.findByRole('img');expect(phase4Api.content).toHaveBeenCalledWith(id,id,true,expect.any(AbortSignal));unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private');
});
it('closes outstanding browser alerts when their workspace unmounts',async()=>{
 const close=vi.fn(),subscribe=()=>()=>{};class BrowserAlert { static permission='granted';onclick:(()=>void)|null=null;close=close; }
 vi.stubGlobal('Notification',BrowserAlert);vi.mocked(phase4Api.preferences).mockResolvedValue({...pref,browser:true});vi.mocked(phase4Api.conversationPreference).mockResolvedValue({mode:'ALL'});
 const {rerender,unmount}=render(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={0}/></MemoryRouter>);
 await act(async()=>{});
 vi.mocked(phase4Api.notifications).mockResolvedValue({data:[{id,type:'CHAT_MESSAGE',conversationId:id,messageId:id,parentMessageId:null,senderName:'Ada',conversationName:'Shared plan',preview:'An update',createdAt:'2026-10-11T00:00:00Z',readAt:null}],nextCursor:null});
 rerender(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={1}/></MemoryRouter>);
 await screen.findByText('New Chat activity. Open notifications to view it.');unmount();expect(close).toHaveBeenCalledTimes(1);
});
it('aborts an in-flight attachment preview when the conversation is removed',async()=>{
 const create=vi.fn();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:vi.fn()}));let finish!:(blob:Blob)=>void;vi.mocked(phase4Api.content).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {unmount}=render(<AttachmentCard conversationId={id} attachment={{id,fileName:'image.png',mimeType:'image/png',sizeBytes:50,status:'AVAILABLE',thumbnail:false,uploadedBy:id,createdAt:'2026-10-11T00:00:00Z'}}/>);
 await userEvent.click(screen.getByRole('button',{name:'Preview'}));const signal=vi.mocked(phase4Api.content).mock.calls.at(-1)![3]!;unmount();await act(async()=>finish(new Blob(['image'])));expect(signal.aborted).toBe(true);expect(create).not.toHaveBeenCalled();
});
const meetingNotice:ChatNotice={id:'notice-meeting',type:'MEETING_INVITATION',conversationId:null,meetingId:'meeting-a',messageId:null,parentMessageId:null,senderName:null,conversationName:'Quarterly review',preview:null,createdAt:'2026-10-23T10:00:00Z',readAt:null};
function CurrentLocation(){const location=useLocation();return <output aria-label="Current location">{location.pathname+location.search}</output>;}
it('routes meetings, calls and thread messages without using a notification id as a message id',()=>{
 expect(messageLink(meetingNotice)).toBe('/app/meetings/meeting-a');
 expect(messageLink({...meetingNotice,conversationId:id})).toBe('/app/meetings/meeting-a');
 expect(messageLink({...meetingNotice,type:'CALL_MISSED',conversationId:id})).toBe('/app/chat/'+id+'?call=meeting-a');
 expect(messageLink({...meetingNotice,type:'CHAT_INVITATION',conversationId:id,meetingId:null})).toBe('/app/chat/'+id);
 expect(messageLink({conversationId:id,messageId:'reply-a',parentMessageId:'thread-a'})).toBe('/app/chat/'+id+'?message=reply-a&thread=thread-a');
 expect(messageLink({...meetingNotice,meetingId:null})).toBe('/app/chat');
});
it('opens a no-channel meeting from the inbox and marks its canonical notification read',async()=>{
 vi.mocked(phase4Api.notifications).mockResolvedValue({data:[meetingNotice],nextCursor:null});
 render(<MemoryRouter><ChatNotifications subscribe={()=>()=>{}} revision={0}/><CurrentLocation/></MemoryRouter>);
 await userEvent.click(screen.getByRole('button',{name:/^Notifications/}));
 await userEvent.click(await screen.findByRole('button',{name:/Meeting invitation · Quarterly review/}));
 expect(screen.getByLabelText('Current location')).toHaveTextContent('/app/meetings/meeting-a');
 expect(phase4Api.readNotice).toHaveBeenCalledWith(meetingNotice.id);
 expect(phase4Api.conversationPreference).not.toHaveBeenCalled();
});
it('persists mobile preferences without asking the browser for notification permission',async()=>{
 const requestPermission=vi.fn();vi.stubGlobal('Notification',{permission:'default',requestPermission});
 vi.mocked(phase4Api.savePreferences).mockImplementation(async p=>p);
 render(<MemoryRouter><ChatNotifications subscribe={()=>()=>{}} revision={0}/></MemoryRouter>);
 await userEvent.click(screen.getByRole('button',{name:'Chat notification settings'}));
 expect(await screen.findByLabelText('Mobile push notifications')).not.toBeChecked();
 expect(screen.getByLabelText('Meeting notifications')).toBeChecked();expect(screen.getByLabelText('Incoming and missed call notifications')).toBeChecked();
 expect(screen.getByLabelText('Show conversation names in mobile alerts')).not.toBeChecked();
 await userEvent.click(screen.getByLabelText('Mobile push notifications'));
 await waitFor(()=>expect(phase4Api.savePreferences).toHaveBeenLastCalledWith({...pref,push:true}));
 await userEvent.click(screen.getByLabelText('Meeting notifications'));
 await waitFor(()=>expect(phase4Api.savePreferences).toHaveBeenLastCalledWith({...pref,push:true,meetings:false}));
 await userEvent.click(screen.getByLabelText('Incoming and missed call notifications'));
 await waitFor(()=>expect(phase4Api.savePreferences).toHaveBeenLastCalledWith({...pref,push:true,meetings:false,incomingCalls:false}));
 await userEvent.click(screen.getByLabelText('Show conversation names in mobile alerts'));
 await waitFor(()=>expect(phase4Api.savePreferences).toHaveBeenLastCalledWith({...pref,push:true,meetings:false,incomingCalls:false,contentPreviews:true}));
 expect(requestPermission).not.toHaveBeenCalled();
});
it('filters meeting and call alerts independently while retaining notification history',()=>{
 expect(shouldAlert(pref,meetingNotice)).toBe(true);
 expect(shouldAlert({...pref,meetings:false},meetingNotice)).toBe(false);
 expect(shouldAlert({...pref,incomingCalls:false},meetingNotice)).toBe(true);
 expect(shouldAlert({...pref,incomingCalls:false},{...meetingNotice,type:'CALL_MISSED',conversationId:id})).toBe(false);
 expect(shouldAlert({...pref,meetings:false},{...meetingNotice,type:'CALL_INCOMING',conversationId:id})).toBe(true);
 expect(shouldAlert({...pref,dnd:true},meetingNotice)).toBe(false);
 expect(shouldAlert(pref,{...meetingNotice,readAt:'2026-10-23T10:01:00Z'})).toBe(false);
 expect(shouldAlert(pref,{...meetingNotice,conversationId:id},id,true)).toBe(true);
});
it('alerts for a no-channel meeting without a conversation lookup or private browser content',async()=>{
 const alerts=vi.fn();class BrowserAlert {static permission='granted';onclick:(()=>void)|null=null;close=vi.fn();constructor(title:string,options:unknown){alerts(title,options);}}
 vi.stubGlobal('Notification',BrowserAlert);vi.mocked(phase4Api.preferences).mockResolvedValue({...pref,browser:true});
 const subscribe=()=>()=>{};const view=render(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={0}/></MemoryRouter>);await act(async()=>{});
 vi.mocked(phase4Api.notifications).mockResolvedValue({data:[meetingNotice],nextCursor:null});
 view.rerender(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={1}/></MemoryRouter>);
 await screen.findByText('New meeting or call activity. Open notifications to view it.');
 expect(phase4Api.conversationPreference).not.toHaveBeenCalled();
 expect(alerts).toHaveBeenCalledWith('New KSOS activity',{body:'Open notifications to view your update.',tag:'ksos-chat-notice-meeting',silent:true});
 expect(JSON.stringify(alerts.mock.calls)).not.toContain('Quarterly review');
});
it('retains incoming calls in history without duplicating the call invitation browser alert',async()=>{
 const alerts=vi.fn();class BrowserAlert {static permission='granted';onclick:(()=>void)|null=null;close=vi.fn();constructor(...args:unknown[]){alerts(...args);}}
 vi.stubGlobal('Notification',BrowserAlert);vi.mocked(phase4Api.preferences).mockResolvedValue({...pref,browser:true});
 const subscribe=()=>()=>{};const view=render(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={0}/></MemoryRouter>);await act(async()=>{});
 vi.mocked(phase4Api.notifications).mockResolvedValue({data:[{...meetingNotice,type:'CALL_INCOMING',conversationId:id}],nextCursor:null});
 view.rerender(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={1}/></MemoryRouter>);
 await userEvent.click(screen.getByRole('button',{name:/^Notifications/}));
 await screen.findByRole('button',{name:/Incoming call · Quarterly review/});expect(alerts).not.toHaveBeenCalled();
});
it('does not deliver a stale browser alert after Do Not Disturb changes during a permission lookup',async()=>{
 const alerts=vi.fn();class BrowserAlert {static permission='granted';onclick:(()=>void)|null=null;close=vi.fn();constructor(...args:unknown[]){alerts(...args);}}
 vi.stubGlobal('Notification',BrowserAlert);vi.mocked(phase4Api.preferences).mockResolvedValue({...pref,browser:true});vi.mocked(phase4Api.savePreferences).mockImplementation(async p=>p);
 let finish!:(value:{mode:string})=>void;vi.mocked(phase4Api.conversationPreference).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const subscribe=()=>()=>{};const view=render(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={0}/></MemoryRouter>);await act(async()=>{});
 vi.mocked(phase4Api.notifications).mockResolvedValue({data:[{...meetingNotice,type:'CHAT_MESSAGE',conversationId:id,meetingId:null,messageId:'message-a'}],nextCursor:null});
 view.rerender(<MemoryRouter><ChatNotifications subscribe={subscribe} revision={1}/></MemoryRouter>);
 await waitFor(()=>expect(phase4Api.conversationPreference).toHaveBeenCalled());
 await userEvent.click(screen.getByRole('button',{name:'Chat notification settings'}));await userEvent.click(await screen.findByLabelText('Do Not Disturb'));
 await waitFor(()=>expect(phase4Api.savePreferences).toHaveBeenCalledWith({...pref,browser:true,dnd:true}));
 await act(async()=>finish({mode:'ALL'}));expect(alerts).not.toHaveBeenCalled();
});
