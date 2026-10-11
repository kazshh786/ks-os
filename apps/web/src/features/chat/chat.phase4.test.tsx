import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { ChatSearch } from './ChatSearch';
import { ChatNotifications,browserPermission,shouldAlert } from './ChatNotifications';
import { AttachmentCard } from './ChatAttachments';
import { phase4Api } from './chat.phase4.api';
vi.mock('./chat.api',async original=>({...await original<typeof import('./chat.api')>(),chatApi:{people:vi.fn().mockResolvedValue({data:[],nextCursor:null})}}));
vi.mock('./chat.phase4.api',async original=>({...await original<typeof import('./chat.phase4.api')>(),phase4Api:{
 policy:vi.fn(),reserve:vi.fn(),upload:vi.fn(),remove:vi.fn(),content:vi.fn(),search:vi.fn(),preferences:vi.fn(),notifications:vi.fn(),savePreferences:vi.fn(),conversationPreference:vi.fn(),readNotice:vi.fn(),
}}));
const id='11111111-1111-4111-8111-111111111111';
const pref={browser:false,inApp:true,sound:false,dnd:false,directMessages:true};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(phase4Api.policy).mockResolvedValue({maxBytes:1024,allowed:['txt','png']});vi.mocked(phase4Api.reserve).mockResolvedValue({id});vi.mocked(phase4Api.remove).mockResolvedValue({});vi.mocked(phase4Api.preferences).mockResolvedValue(pref);vi.mocked(phase4Api.notifications).mockResolvedValue({data:[],nextCursor:null});});
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
