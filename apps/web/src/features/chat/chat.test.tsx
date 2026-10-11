import { fireEvent, render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunicationsEvent, NativeConversation, NativeMessage } from '@ks-os/contracts';
import { MessageComposer, adjustMentions } from './MessageComposer';
import { MessageBody } from './MessageItem';
import { CreateChannelDialog } from './ChannelDialogs';
import { MessageTimeline, type SubscribeChat } from './MessageTimeline';
import { chatApi } from './chat.api';
import { connectChat, mergeMessages } from './chat.realtime';

vi.mock('./chat.api', async importOriginal => {
  const original=await importOriginal<typeof import('./chat.api')>();
  return {...original,chatApi:{people:vi.fn(),create:vi.fn(),messages:vi.fn(),resolve:vi.fn(),ticket:vi.fn(),send:vi.fn()}};
});
const channelId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const channel:NativeConversation={id:channelId,type:'CHANNEL',name:'Team',slug:'team',description:null,createdBy:userId,createdAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',archivedAt:null,memberRole:'OWNER',lastReadPosition:'0',lastReadAt:null,unreadCount:1,memberCount:2};
const message=(id:string,position:string,body='Hello'):NativeMessage=>({id,conversationId:channelId,senderId:userId,senderName:'Ada',body,type:'TEXT',parentMessageId:null,position,createdAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',editedAt:null,deletedAt:null,replyCount:0,mentions:[],reactions:[]});
beforeEach(()=>{vi.clearAllMocks();vi.mocked(chatApi.people).mockResolvedValue({data:[],nextCursor:null});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});

describe('message composer',()=>{
  it('retains failed text and retry identity, supports newlines, and clears only after persistence',async()=>{
    const user=userEvent.setup(),send=vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(undefined),save=vi.fn();
    render(<MessageComposer channelId={channelId} send={send} saveDraft={save}/>);
    const field=screen.getByRole('combobox',{name:'Message'});
    await user.type(field,'First{Shift>}{Enter}{/Shift}Second');
    expect(field).toHaveValue('First\nSecond');expect(send).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(field).toHaveValue('First\nSecond');
    const retryId=send.mock.calls[0][0].clientMessageId;
    await user.click(screen.getByRole('button',{name:'Send message'}));
    await waitFor(()=>expect(field).toHaveValue(''));
    expect(send.mock.calls[1][0].clientMessageId).toBe(retryId);
    expect(save).toHaveBeenLastCalledWith({body:'',mentions:[]},expect.objectContaining({clientMessageId:retryId}));
  });
  it('selects eligible mentions with the keyboard and sends stable references',async()=>{
    vi.mocked(chatApi.people).mockResolvedValue({data:[{userId,name:'Ada'}],nextCursor:null});
    const user=userEvent.setup(),send=vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer channelId={channelId} send={send}/>);
    const field=screen.getByRole('combobox',{name:'Message'});
    await user.type(field,'@Ad');
    await screen.findByRole('option',{name:'Ada'});
    await user.keyboard('{ArrowDown}{Enter}');
    expect(field).toHaveValue('@Ada ');
    await user.click(screen.getByRole('button',{name:'Send message'}));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({body:'@Ada ',mentions:[{userId,start:0,end:4}]}));
    expect(chatApi.people).toHaveBeenCalledWith(channelId,false,'Ad','',expect.any(AbortSignal));
  });
  it('rejects empty and oversized messages and does not send during IME composition',async()=>{
    const send=vi.fn();render(<MessageComposer channelId={channelId} send={send}/>);
    const field=screen.getByRole('combobox',{name:'Message'}),button=screen.getByRole('button',{name:'Send message'});
    expect(button).toBeDisabled();
    fireEvent.change(field,{target:{value:'字'}});
    fireEvent.keyDown(field,{key:'Enter',isComposing:true});expect(send).not.toHaveBeenCalled();
    fireEvent.change(field,{target:{value:'x'.repeat(16001)}});expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('16,000');
  });
  it('shifts mention references for insertions and drops references when their text changes',()=>{
    const mention={userId,start:3,end:7};
    expect(adjustMentions('Hi @Ada','Hello Hi @Ada',[mention])).toEqual([{...mention,start:9,end:13}]);
    expect(adjustMentions('Hi @Ada','Hi @Ana',[mention])).toEqual([]);
  });
});

it('renders untrusted text as text, highlights mentions and retains a deletion tombstone',()=>{
  const value=message(userId,'1','@Ada <img src=x onerror=alert(1)>');
  value.mentions=[{userId,name:'Ada',start:0,end:4}];
  const {container,rerender}=render(<MessageBody message={value}/>);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('mark')).toHaveTextContent('@Ada');
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  rerender(<MessageBody message={{...value,deletedAt:value.createdAt,body:null}}/>);
  expect(screen.getByText('This message was deleted.')).toBeInTheDocument();
});

it('creates a private channel with validation and selected members in an accessible dialog',async()=>{
  const user=userEvent.setup(),created=vi.fn();
  vi.mocked(chatApi.create).mockResolvedValue(channel);
  vi.mocked(chatApi.people).mockResolvedValue({data:[{userId,name:'Ada'}],nextCursor:null});
  render(<CreateChannelDialog created={created} close={vi.fn()}/>);
  expect(screen.getByRole('dialog',{name:'Create a channel'})).toHaveAttribute('aria-modal','true');
  expect(screen.getByRole('button',{name:'Create channel'})).toBeDisabled();
  await user.type(screen.getByLabelText('Channel name'),'Private team');
  await user.selectOptions(screen.getByLabelText('Visibility'),'PRIVATE_CHANNEL');
  await user.click(await screen.findByRole('checkbox',{name:'Ada'}));
  await user.click(screen.getByRole('button',{name:'Create channel'}));
  await waitFor(()=>expect(created).toHaveBeenCalledWith(channel));
  expect(chatApi.create).toHaveBeenCalledWith({name:'Private team',description:'',type:'PRIVATE_CHANNEL',memberUserIds:[userId]});
});

it('reconciles an event arriving during initial history without losing or duplicating the message',async()=>{
  let finish!:(page:{data:NativeMessage[];nextCursor:null})=>void;
  vi.mocked(chatApi.messages).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const value=message(userId,'9','Arrived during load');vi.mocked(chatApi.resolve).mockResolvedValue([value]);
  let listener!:(event:CommunicationsEvent)=>void;
  const subscribe:SubscribeChat=callback=>{listener=callback;return()=>{};};
  render(<MessageTimeline channel={channel} userId={userId} subscribe={subscribe} revision={0} drafts={new Map()} inaccessible={vi.fn()} read={vi.fn()}/>);
  act(()=>listener({version:1,id:'10',tenantId:channelId,conversationId:channelId,type:'message.created',resourceId:userId,occurredAt:'2026-10-11T00:00:00.000Z'}));
  await screen.findByText('Arrived during load');
  await act(async()=>finish({data:[],nextCursor:null}));
  expect(screen.getAllByText('Arrived during load')).toHaveLength(1);
  expect(mergeMessages([value],[{...value,body:'Updated'}])).toEqual([{...value,body:'Updated'}]);
  expect(mergeMessages([message('a','9007199254740993')],[message('b','9007199254740992')]).map(m=>m.id)).toEqual(['b','a']);
});

it('realtime deduplicates events, preserves the largest replay cursor and obtains fresh tickets',async()=>{
  vi.useFakeTimers();
  class Socket {
    static instances:Socket[]=[];onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;
    constructor(public url:string){Socket.instances.push(this);}close(){this.onclose?.();}
  }
  vi.stubGlobal('WebSocket',Socket);
  vi.mocked(chatApi.ticket).mockResolvedValue({ticket:'a'.repeat(64),cursor:'4'});
  const event=vi.fn(),ready=vi.fn().mockResolvedValue(undefined),stop=connectChat({event,ready,state:vi.fn(),revoked:vi.fn()});
  await vi.advanceTimersByTimeAsync(0);
  const first=Socket.instances[0];first.onopen?.();
  for(const id of ['8','8','6'])first.onmessage?.({data:JSON.stringify({version:1,id,tenantId:channelId,conversationId:channelId,type:'message.created',resourceId:userId,occurredAt:'2026-10-11T00:00:00.000Z'})});
  expect(event).toHaveBeenCalledTimes(2);
  first.close();await vi.advanceTimersByTimeAsync(1400);
  expect(chatApi.ticket).toHaveBeenCalledTimes(2);
  expect(new URL(Socket.instances[1].url).searchParams.get('after')).toBe('8');
  stop();await vi.advanceTimersByTimeAsync(60000);
  expect(Socket.instances).toHaveLength(2);
});

it('keeps a newer draft when an earlier send finishes after channel switching',async()=>{
  vi.mocked(chatApi.messages).mockResolvedValue({data:[],nextCursor:null});
  let finish!:(value:NativeMessage)=>void;
  vi.mocked(chatApi.send).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const drafts=new Map(),user=userEvent.setup(),subscribe:SubscribeChat=()=>()=>{};
  const props={userId,subscribe,revision:0,drafts,inaccessible:vi.fn(),read:vi.fn()};
  const {rerender}=render(<MessageTimeline key="a" channel={channel} {...props}/>);
  await user.type(screen.getByRole('combobox',{name:'Message Team'}),'Original pending message');
  await user.keyboard('{Enter}');
  await waitFor(()=>expect(chatApi.send).toHaveBeenCalledTimes(1));
  rerender(<MessageTimeline key="b" channel={{...channel,id:'33333333-3333-4333-8333-333333333333',name:'Other'}} {...props}/>);
  rerender(<MessageTimeline key="a" channel={channel} {...props}/>);
  const field=screen.getByRole('combobox',{name:'Message Team'});
  await user.clear(field);await user.type(field,'Keep this newer draft');
  await act(async()=>finish(message(userId,'1','Original pending message')));
  expect(drafts.get(channelId+':root').body).toBe('Keep this newer draft');
});
