import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  ChevronDown,
  Circle,
  CreditCard,
  Facebook,
  FilePlus2,
  Inbox,
  Instagram,
  Link2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  RefreshCw,
  Search,
  Send,
  UserRound,
  Video,
} from 'lucide-react';
import type {
  ConversationChannel,
  ConversationDetail,
  ConversationListItem,
  ConversationPriority,
  ConversationStatus,
} from '@ks-os/contracts';
import type { Staff } from '../../data/types.js';
import { getDataProvider } from '../../data/data-provider.js';
import { useWorkspace } from '../../context/WorkspaceContext.js';
import {
  channelLabels,
  createConversationPaymentLink,
  getConversation,
  listConversations,
  sendConversationMessage,
  updateConversation,
} from './conversations.api.js';

const channelIcons: Record<ConversationChannel, typeof Mail> = {
  EMAIL: Mail,
  SMS: MessageCircle,
  WHATSAPP: Phone,
  INSTAGRAM: Instagram,
  FACEBOOK: Facebook,
};

const channelTone: Record<ConversationChannel, string> = {
  EMAIL: 'bg-sky-50 text-sky-700 ring-sky-200',
  SMS: 'bg-slate-100 text-slate-700 ring-slate-200',
  WHATSAPP: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  INSTAGRAM: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  FACEBOOK: 'bg-blue-50 text-blue-700 ring-blue-200',
};

const priorityTone: Record<ConversationPriority, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  NORMAL: 'bg-indigo-50 text-indigo-700',
  HIGH: 'bg-amber-100 text-amber-800',
  URGENT: 'bg-rose-100 text-rose-800',
};

const formatTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const formatDateTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';

function ChannelBadge({ channel, compact = false }: { channel: ConversationChannel; compact?: boolean }) {
  const Icon = channelIcons[channel];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-black ring-1 ring-inset ${channelTone[channel]}`}>
    <Icon aria-hidden="true" className="h-3.5 w-3.5" />{compact ? null : channelLabels[channel]}
  </span>;
}

function ConversationCard({ item, active, onClick }: { item: ConversationListItem; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`w-full border-b border-slate-100 px-4 py-3.5 text-left transition ${active ? 'bg-indigo-50/80 shadow-[inset_3px_0_0_#4f46e5]' : 'bg-white hover:bg-slate-50'}`}>
    <div className="flex items-start gap-3">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
        {initials(item.customerName)}
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-white">
          {(() => { const Icon = channelIcons[item.channel]; return <Icon className="h-3 w-3 text-slate-600" />; })()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`min-w-0 flex-1 truncate text-sm ${item.unreadCount ? 'font-black text-slate-950' : 'font-bold text-slate-800'}`}>{item.customerName}</p>
          <time className="shrink-0 text-[10px] font-bold text-slate-400" dateTime={item.lastMessageAt}>{formatTime(item.lastMessageAt)}</time>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className={`min-w-0 flex-1 truncate text-xs ${item.unreadCount ? 'font-bold text-slate-700' : 'text-slate-500'}`}>{item.preview || 'No messages yet'}</p>
          {item.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-black text-white">{item.unreadCount}</span>}
        </div>
        <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
          <ChannelBadge channel={item.channel} compact />
          {item.booking && <span className="truncate rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{item.booking.serviceName}</span>}
          {item.priority !== 'NORMAL' && <span className={`rounded-full px-2 py-1 text-[10px] font-black ${priorityTone[item.priority]}`}>{item.priority}</span>}
        </div>
      </div>
    </div>
  </button>;
}

export function ConversationsInboxPage() {
  const navigate = useNavigate();
  const { activeTenant } = useWorkspace();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<ConversationChannel | ''>('');
  const [status, setStatus] = useState<ConversationStatus | ''>('OPEN');
  const [assignment, setAssignment] = useState<'ALL' | 'MINE' | 'UNASSIGNED'>('ALL');
  const [composer, setComposer] = useState('');
  const [composerChannel, setComposerChannel] = useState<ConversationChannel>('EMAIL');
  const messagesEnd = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async (keepSelection = true) => {
    setLoadingList(true);
    setError('');
    try {
      const result = await listConversations({
        q: search || undefined,
        channel: channel || undefined,
        status: status || undefined,
        assignment,
        limit: 60,
      });
      setItems(result.data);
      setSelectedId(current => keepSelection && current && result.data.some(item => item.id === current) ? current : result.data[0]?.id || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The inbox could not be loaded.');
    } finally {
      setLoadingList(false);
    }
  }, [assignment, channel, search, status]);

  useEffect(() => { void loadList(false); }, [loadList]);
  useEffect(() => {
    if (!activeTenant) return;
    let active = true;
    getDataProvider().getStaff(activeTenant.id).then(rows => { if (active) setStaff(rows); }).catch(() => setStaff([]));
    return () => { active = false; };
  }, [activeTenant]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    setLoadingDetail(true);
    setError('');
    getConversation(selectedId).then(async data => {
      if (!active) return;
      setDetail(data);
      setComposerChannel(data.conversation.channel);
      if (data.conversation.unreadCount > 0) {
        try {
          const updated = await updateConversation(selectedId, { markRead: true });
          if (active) {
            setItems(current => current.map(item => item.id === updated.id ? updated : item));
            setDetail(current => current ? { ...current, conversation: updated } : current);
          }
        } catch { /* Reading the message remains useful even if acknowledgement fails. */ }
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'The conversation could not be loaded.'); })
      .finally(() => { if (active) setLoadingDetail(false); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: 'end' }); }, [detail?.messages.length, selectedId]);

  const selected = detail?.conversation || items.find(item => item.id === selectedId) || null;
  const customer = detail?.customer;
  const connectedContext = useMemo(() => ({
    clientId: customer?.clientId || selected?.clientId || null,
    appointmentId: customer?.upcomingBooking?.appointmentId || selected?.booking?.appointmentId || null,
  }), [customer, selected]);

  const updateSelected = async (input: Parameters<typeof updateConversation>[1]) => {
    if (!selectedId) return;
    setActionLoading('update');
    setError('');
    try {
      const updated = await updateConversation(selectedId, input);
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
      setDetail(current => current ? { ...current, conversation: updated } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The conversation could not be updated.');
    } finally {
      setActionLoading('');
    }
  };

  const submitMessage = async () => {
    if (!selectedId || !composer.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const message = await sendConversationMessage(selectedId, { body: composer.trim(), channel: composerChannel });
      setDetail(current => current ? { ...current, messages: [...current.messages, message] } : current);
      setItems(current => current.map(item => item.id === selectedId ? {
        ...item,
        channel: composerChannel,
        status: 'PENDING',
        preview: composer.trim(),
        unreadCount: 0,
        lastMessageAt: message.createdAt,
      } : item));
      setComposer('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be queued.');
    } finally {
      setSending(false);
    }
  };

  const appendLink = (label: string, url: string) => {
    setComposer(current => current.trim() ? `${current.trim()}\n\n${label}: ${url}` : `${label}: ${url}`);
  };

  const preparePaymentLink = async () => {
    if (!selectedId) return;
    setActionLoading('payment');
    setError('');
    try {
      const result = await createConversationPaymentLink(selectedId);
      appendLink('Secure payment link', result.url);
      setNotice('Payment link added to the reply. Review it before sending.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The payment link could not be created.');
    } finally {
      setActionLoading('');
    }
  };

  const prepareBookingPage = async () => {
    setActionLoading('booking-page');
    setError('');
    try {
      const page = await getDataProvider().getBookingPageSettings();
      appendLink('Book online', page.publicUrl);
      setNotice('Booking-page link added to the reply.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The booking page is unavailable.');
    } finally {
      setActionLoading('');
    }
  };

  const selectConversation = (id: string) => {
    setSelectedId(id);
    setNotice('');
    setError('');
  };

  const quickActions = [
    {
      id: 'book', label: 'Book client', icon: CalendarPlus, disabled: !connectedContext.clientId,
      action: () => navigate(`/app/calendar?create=booking&clientId=${connectedContext.clientId}`),
    },
    {
      id: 'form', label: 'Send form', icon: FilePlus2, disabled: !connectedContext.clientId,
      action: () => navigate(`/app/forms?assign=1&clientId=${connectedContext.clientId}${connectedContext.appointmentId ? `&appointmentId=${connectedContext.appointmentId}` : ''}`),
    },
    {
      id: 'payment', label: 'Payment link', icon: CreditCard, disabled: !connectedContext.appointmentId,
      action: () => void preparePaymentLink(),
    },
    {
      id: 'booking-page', label: 'Booking page', icon: Link2, disabled: false,
      action: () => void prepareBookingPage(),
    },
  ];

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm"><Inbox className="h-5 w-5" /></span>
        <div className="min-w-0"><h1 className="truncate text-lg font-black text-slate-950">Customer inbox</h1><p className="truncate text-xs font-medium text-slate-500">Messages, bookings, forms and payments in one workspace</p></div>
      </div>
      <button type="button" onClick={() => void loadList()} disabled={loadingList} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loadingList ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Refresh</span></button>
      <Link to="/app/settings/communications" className="inline-flex h-10 items-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white hover:bg-slate-800">Channels</Link>
    </header>

    {(error || notice) && <div className={`shrink-0 border-b px-4 py-2 text-xs font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <div className="grid min-h-0 flex-1 lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_320px]">
      <aside className={`${selectedId ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col border-r border-slate-200 bg-white`} aria-label="Conversation list">
        <div className="space-y-3 border-b border-slate-200 p-3">
          <form onSubmit={event => { event.preventDefault(); setSearch(searchInput.trim()); }} className="flex items-center rounded-xl border border-slate-200 bg-slate-50 focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100">
            <Search className="ml-3 h-4 w-4 text-slate-400" />
            <input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search conversations" className="min-h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm outline-none" />
          </form>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'SMS', 'EMAIL'] as const).map(value => <button key={value || 'ALL'} type="button" onClick={() => setChannel(value)} className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black ${channel === value ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{value ? channelLabels[value] : 'All'}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="relative"><span className="sr-only">Conversation status</span><select value={status} onChange={event => setStatus(event.target.value as ConversationStatus | '')} className="min-h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-7 text-xs font-bold text-slate-700"><option value="">All statuses</option><option value="OPEN">Open</option><option value="PENDING">Awaiting customer</option><option value="RESOLVED">Resolved</option></select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" /></label>
            <label className="relative"><span className="sr-only">Assignment</span><select value={assignment} onChange={event => setAssignment(event.target.value as typeof assignment)} className="min-h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-7 text-xs font-bold text-slate-700"><option value="ALL">Everyone</option><option value="MINE">Assigned to me</option><option value="UNASSIGNED">Unassigned</option></select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" /></label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList ? <div className="space-y-3 p-4">{[0,1,2,3,4].map(item => <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
            : items.length === 0 ? <div className="flex h-full flex-col items-center justify-center p-8 text-center"><Inbox className="h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">No conversations found</p><p className="mt-1 text-xs text-slate-500">New customer messages will appear here when a channel is connected.</p></div>
              : items.map(item => <ConversationCard key={item.id} item={item} active={selectedId === item.id} onClick={() => selectConversation(item.id)} />)}
        </div>
      </aside>

      <main className={`${selectedId ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col bg-white`}>
        {!selected ? <div className="flex h-full flex-col items-center justify-center p-8 text-center"><MessageCircle className="h-12 w-12 text-slate-300" /><h2 className="mt-4 text-lg font-black text-slate-800">Choose a conversation</h2><p className="mt-1 max-w-sm text-sm text-slate-500">Select a customer to see their complete message and booking context.</p></div> : <>
          <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-3 sm:px-4">
            <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Back to conversations"><ArrowLeft className="h-5 w-5" /></button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">{initials(selected.customerName)}</div>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-black text-slate-950 sm:text-base">{selected.customerName}</h2><ChannelBadge channel={selected.channel} /></div><p className="mt-0.5 truncate text-xs text-slate-500">{selected.subject || selected.customerEmail || selected.customerPhone || 'Customer conversation'}</p></div>
            <div className="hidden items-center gap-1 sm:flex">
              <a href={selected.customerPhone ? `tel:${selected.customerPhone}` : undefined} aria-disabled={!selected.customerPhone} className={`rounded-xl p-2.5 ${selected.customerPhone ? 'text-slate-600 hover:bg-slate-100' : 'pointer-events-none text-slate-300'}`} title="Call customer"><Phone className="h-4 w-4" /></a>
              <button type="button" disabled title="Video calls will become available through a connected calling provider" className="rounded-xl p-2.5 text-slate-300"><Video className="h-4 w-4" /></button>
            </div>
            <label className="hidden md:block"><span className="sr-only">Assign conversation</span><select disabled={actionLoading === 'update'} value={selected.assignedToUserId || ''} onChange={event => void updateSelected({ assignedToUserId: event.target.value || null })} className="max-w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option value="">Unassigned</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <button type="button" disabled={actionLoading === 'update'} onClick={() => void updateSelected({ status: selected.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED' })} className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-black ${selected.status === 'RESOLVED' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}><Check className="h-4 w-4" /><span className="hidden sm:inline">{selected.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}</span></button>
            <button type="button" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="More conversation actions"><MoreHorizontal className="h-5 w-5" /></button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-5 sm:px-6">
            {loadingDetail ? <div className="mx-auto max-w-3xl space-y-4">{[0,1,2].map(item => <div key={item} className={`h-20 animate-pulse rounded-2xl bg-slate-200 ${item % 2 ? 'ml-auto w-2/3' : 'w-3/4'}`} />)}</div>
              : <div className="mx-auto max-w-3xl space-y-4">
                {detail?.messages.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><MessageCircle className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Start the conversation</p><p className="mt-1 text-xs text-slate-500">Choose a connected channel and send the first message.</p></div>}
                {detail?.messages.map((message, index) => {
                  const outbound = message.direction === 'OUTBOUND';
                  const showDate = index === 0 || new Date(message.createdAt).toDateString() !== new Date(detail.messages[index - 1]!.createdAt).toDateString();
                  return <div key={message.id}>
                    {showDate && <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200" /><time className="text-[10px] font-black uppercase tracking-wider text-slate-400">{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(new Date(message.createdAt))}</time><span className="h-px flex-1 bg-slate-200" /></div>}
                    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[86%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${outbound ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}>
                        <div className={`mb-1 flex items-center gap-2 text-[10px] font-black ${outbound ? 'text-indigo-100' : 'text-slate-400'}`}><span>{message.senderName}</span><ChannelBadge channel={message.channel} compact /></div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                        <div className={`mt-2 flex items-center justify-end gap-1.5 text-[10px] font-bold ${outbound ? 'text-indigo-100' : 'text-slate-400'}`}><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>{outbound && <span>{message.status === 'FAILED' ? 'Failed' : message.status === 'QUEUED' ? 'Queued' : message.status.toLowerCase()}</span>}</div>
                      </div>
                    </div>
                  </div>;
                })}
                <div ref={messagesEnd} />
              </div>}
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {quickActions.map(action => <button key={action.id} type="button" disabled={action.disabled || actionLoading === action.id} onClick={action.action} className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><action.icon className="h-3.5 w-3.5" />{actionLoading === action.id ? 'Preparing…' : action.label}</button>)}
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
                <textarea value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submitMessage(); } }} rows={3} placeholder={`Reply to ${selected.customerName}`} className="max-h-40 min-h-20 w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 py-3 text-sm leading-6 outline-none" />
                <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
                  <label className="relative"><span className="sr-only">Reply channel</span><select value={composerChannel} onChange={event => setComposerChannel(event.target.value as ConversationChannel)} className="appearance-none rounded-lg border-0 bg-slate-100 py-2 pl-3 pr-7 text-xs font-black text-slate-700"><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook</option><option value="SMS">SMS</option><option value="EMAIL">Email</option></select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" /></label>
                  <p className="hidden min-w-0 flex-1 truncate text-[10px] text-slate-400 sm:block">Messages only queue when that business channel is connected. Ctrl/⌘ + Enter to send.</p>
                  <button type="button" onClick={() => void submitMessage()} disabled={sending || !composer.trim()} className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" />{sending ? 'Sending…' : 'Send'}</button>
                </div>
              </div>
            </div>
          </footer>
        </>}
      </main>

      <aside className="hidden min-h-0 flex-col border-l border-slate-200 bg-white xl:flex" aria-label="Customer context">
        {customer && selected ? <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-lg font-black text-white">{initials(customer.name)}</div><h2 className="mt-3 text-base font-black text-slate-950">{customer.name}</h2><p className="mt-1 text-xs text-slate-500">{customer.email || customer.phone || 'No contact details'}</p>{customer.clientId && <Link to={`/app/clients/${customer.clientId}`} className="mt-3 inline-flex items-center gap-1 text-xs font-black text-indigo-600 hover:text-indigo-800"><UserRound className="h-3.5 w-3.5" />View customer profile</Link>}</div>

          <section className="mt-6 grid grid-cols-2 gap-2" aria-label="Customer booking statistics">
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Bookings</p><p className="mt-1 text-xl font-black text-slate-950">{customer.totalBookings}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Completed</p><p className="mt-1 text-xl font-black text-slate-950">{customer.completedBookings}</p></div>
          </section>

          <section className="mt-6"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Next booking</h3>{customer.upcomingBooking && <Circle className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />}</div>{customer.upcomingBooking ? <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-black text-emerald-950">{customer.upcomingBooking.serviceName}</p><p className="mt-1 text-xs font-bold text-emerald-800">{formatDateTime(customer.upcomingBooking.startTime)}</p><p className="mt-2 text-[10px] font-black uppercase tracking-wide text-emerald-700">{customer.upcomingBooking.status.replaceAll('_', ' ')}</p></div> : <div className="mt-2 rounded-2xl border border-dashed border-slate-300 p-4 text-center"><p className="text-xs font-bold text-slate-500">No upcoming booking linked</p><button type="button" disabled={!customer.clientId} onClick={() => navigate(`/app/calendar?create=booking&clientId=${customer.clientId}`)} className="mt-2 text-xs font-black text-indigo-600 disabled:opacity-40">Create booking</button></div>}</section>

          <section className="mt-6"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Conversation</h3><dl className="mt-2 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4 text-xs"><div className="flex items-center justify-between py-3"><dt className="font-bold text-slate-500">Status</dt><dd className="font-black text-slate-800">{selected.status === 'PENDING' ? 'Awaiting customer' : selected.status}</dd></div><div className="flex items-center justify-between py-3"><dt className="font-bold text-slate-500">Assigned to</dt><dd className="max-w-36 truncate font-black text-slate-800">{selected.assignedToName || 'Unassigned'}</dd></div><div className="flex items-center justify-between py-3"><dt className="font-bold text-slate-500">Priority</dt><dd><select value={selected.priority} onChange={event => void updateSelected({ priority: event.target.value as ConversationPriority })} className={`rounded-full border-0 px-2 py-1 text-[10px] font-black ${priorityTone[selected.priority]}`}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></dd></div></dl></section>

          <section className="mt-6"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Quick actions</h3><div className="mt-2 grid gap-2">{quickActions.map(action => <button key={`side-${action.id}`} type="button" onClick={action.action} disabled={action.disabled || actionLoading === action.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-left text-xs font-black text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><action.icon className="h-4 w-4" /></span>{action.label}</button>)}</div></section>
        </div> : <div className="flex h-full flex-col items-center justify-center p-8 text-center"><UserRound className="h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Customer context</p><p className="mt-1 text-xs text-slate-500">Booking and contact details appear here.</p></div>}
      </aside>
    </div>
  </div>;
}
