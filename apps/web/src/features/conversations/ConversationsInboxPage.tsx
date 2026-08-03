import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CalendarPlus,
  Check,
  ChevronDown,
  Circle,
  CornerUpLeft,
  CreditCard,
  Facebook,
  FilePlus2,
  FileText,
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
  X,
} from 'lucide-react';
import type {
  ConversationChannel,
  ConversationDetail,
  ConversationListItem,
  ConversationMessage,
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

const deliveryLabel: Record<ConversationMessage['status'], string> = {
  RECEIVED: 'Received',
  QUEUED: 'Queued for delivery',
  SENT: 'Sent to provider',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Delivery failed',
};

const formatTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const formatDateTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
const draftKey = (conversationId: string) => `ks-os:conversation-draft:${conversationId}`;
const notificationsKey = 'ks-os:conversation-notifications';

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
  const [threadSearch, setThreadSearch] = useState('');
  const [channel, setChannel] = useState<ConversationChannel | ''>('');
  const [status, setStatus] = useState<ConversationStatus | ''>('');
  const [assignment, setAssignment] = useState<'ALL' | 'MINE' | 'UNASSIGNED'>('ALL');
  const [composer, setComposerState] = useState('');
  const [composerChannel, setComposerChannel] = useState<ConversationChannel>('EMAIL');
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [newMessages, setNewMessages] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => window.localStorage.getItem(notificationsKey) === 'true');
  const messagesEnd = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const detailRef = useRef<ConversationDetail | null>(null);
  const listRequestRunning = useRef(false);
  const detailRequestToken = useRef(0);
  const nearBottom = useRef(true);
  const latestInboundId = useRef<string | null>(null);
  const unreadBoundary = useRef<Record<string, number>>({});

  selectedIdRef.current = selectedId;
  detailRef.current = detail;

  const setComposer = useCallback((value: string) => {
    setComposerState(value);
    if (!selectedIdRef.current) return;
    if (value.trim()) window.localStorage.setItem(draftKey(selectedIdRef.current), value);
    else window.localStorage.removeItem(draftKey(selectedIdRef.current));
  }, []);

  const scrollToEnd = useCallback(() => {
    messagesEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    nearBottom.current = true;
    setNewMessages(0);
  }, []);

  const loadList = useCallback(async ({ keepSelection = true, silent = false }: { keepSelection?: boolean; silent?: boolean } = {}) => {
    if (listRequestRunning.current) return;
    listRequestRunning.current = true;
    if (!silent) {
      setLoadingList(true);
      setError('');
    }
    try {
      const result = await listConversations({
        q: search || undefined,
        channel: channel || undefined,
        status: status || undefined,
        assignment,
        limit: 60,
      });
      setItems(result.data);
      setSelectedId(current => keepSelection && current ? current : result.data[0]?.id || null);
      setLastRefreshedAt(new Date());
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : 'The inbox could not be loaded.');
    } finally {
      listRequestRunning.current = false;
      if (!silent) setLoadingList(false);
    }
  }, [assignment, channel, search, status]);

  const loadDetail = useCallback(async (conversationId: string, { silent = false }: { silent?: boolean } = {}) => {
    const token = ++detailRequestToken.current;
    if (!silent) {
      setLoadingDetail(true);
      setError('');
    }
    try {
      const data = await getConversation(conversationId);
      if (token !== detailRequestToken.current || selectedIdRef.current !== conversationId) return;

      const previous = detailRef.current;
      const previousCount = previous?.conversation.id === conversationId ? previous.messages.length : 0;
      const addedCount = Math.max(0, data.messages.length - previousCount);
      const inbound = [...data.messages].reverse().find(message => message.direction === 'INBOUND');

      if (!(conversationId in unreadBoundary.current) && data.conversation.unreadCount > 0) {
        unreadBoundary.current[conversationId] = Math.max(0, data.messages.length - data.conversation.unreadCount);
      }

      if (latestInboundId.current && inbound && inbound.id !== latestInboundId.current && notificationsEnabled && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`${data.conversation.customerName} sent a message`, {
          body: inbound.body.slice(0, 160),
          tag: `ks-os-conversation-${conversationId}`,
        });
      }
      latestInboundId.current = inbound?.id || null;

      setDetail(data);
      setComposerChannel(data.conversation.channel);
      setLastRefreshedAt(new Date());

      if (addedCount > 0) {
        if (nearBottom.current) window.setTimeout(scrollToEnd, 50);
        else setNewMessages(current => current + addedCount);
      }

      if (data.conversation.unreadCount > 0) {
        try {
          const updated = await updateConversation(conversationId, { markRead: true });
          if (selectedIdRef.current === conversationId) {
            setItems(current => current.map(item => item.id === updated.id ? updated : item));
            setDetail(current => current ? { ...current, conversation: updated } : current);
          }
        } catch {
          // Reading remains available even if acknowledgement fails.
        }
      }
    } catch (cause) {
      if (!silent && selectedIdRef.current === conversationId) setError(cause instanceof Error ? cause.message : 'The conversation could not be loaded.');
    } finally {
      if (!silent && selectedIdRef.current === conversationId) setLoadingDetail(false);
    }
  }, [notificationsEnabled, scrollToEnd]);

  useEffect(() => { void loadList({ keepSelection: false }); }, [loadList]);

  useEffect(() => {
    if (!activeTenant) return;
    let active = true;
    getDataProvider().getStaff(activeTenant.id).then(rows => { if (active) setStaff(rows); }).catch(() => setStaff([]));
    return () => { active = false; };
  }, [activeTenant]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setComposerState(window.localStorage.getItem(draftKey(selectedId)) || '');
    setReplyTo(null);
    setThreadSearch('');
    setNewMessages(0);
    nearBottom.current = true;
    latestInboundId.current = null;
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const refreshVisibleInbox = () => {
      if (document.visibilityState !== 'visible') return;
      void loadList({ silent: true });
      if (selectedId) void loadDetail(selectedId, { silent: true });
    };
    const listTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadList({ silent: true });
    }, 10_000);
    const detailTimer = window.setInterval(() => {
      if (selectedId && document.visibilityState === 'visible') void loadDetail(selectedId, { silent: true });
    }, 5_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshVisibleInbox();
    };
    window.addEventListener('focus', refreshVisibleInbox);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(listTimer);
      window.clearInterval(detailTimer);
      window.removeEventListener('focus', refreshVisibleInbox);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadDetail, loadList, selectedId]);

  useEffect(() => {
    if (detail?.messages.length && nearBottom.current) messagesEnd.current?.scrollIntoView({ block: 'end' });
  }, [detail?.messages.length, selectedId]);

  const selected = detail?.conversation || items.find(item => item.id === selectedId) || null;
  const customer = detail?.customer;
  const messageById = useMemo(() => new Map((detail?.messages || []).map(message => [message.id, message])), [detail?.messages]);
  const filteredMessages = useMemo(() => {
    const term = threadSearch.trim().toLowerCase();
    if (!term) return detail?.messages || [];
    return (detail?.messages || []).filter(message => `${message.senderName} ${message.body}`.toLowerCase().includes(term));
  }, [detail?.messages, threadSearch]);
  const connectedContext = useMemo(() => ({
    clientId: customer?.clientId || selected?.clientId || null,
    appointmentId: customer?.upcomingBooking?.appointmentId || selected?.booking?.appointmentId || null,
  }), [customer, selected]);

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      setNotice('Desktop notifications are not supported by this browser.');
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === 'granted';
    setNotificationsEnabled(enabled);
    window.localStorage.setItem(notificationsKey, String(enabled));
    setNotice(enabled ? 'Desktop message notifications enabled.' : 'Notification permission was not granted.');
  };

  const disableNotifications = () => {
    setNotificationsEnabled(false);
    window.localStorage.setItem(notificationsKey, 'false');
    setNotice('Desktop message notifications disabled.');
  };

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

  const appendSentMessage = (message: ConversationMessage, body: string, channelType: ConversationChannel) => {
    setDetail(current => current ? { ...current, messages: [...current.messages, message] } : current);
    setItems(current => current.map(item => item.id === selectedId ? {
      ...item,
      channel: channelType,
      status: 'PENDING',
      preview: body,
      unreadCount: 0,
      lastMessageAt: message.createdAt,
    } : item));
  };

  const submitMessage = async () => {
    if (!selectedId || !composer.trim() || sending) return;
    const body = composer.trim();
    setSending(true);
    setError('');
    try {
      const message = await sendConversationMessage(selectedId, {
        body,
        channel: composerChannel,
        replyToMessageId: replyTo?.id || null,
      });
      appendSentMessage(message, body, composerChannel);
      setComposer('');
      setReplyTo(null);
      void loadList({ silent: true });
      window.setTimeout(() => void loadDetail(selectedId, { silent: true }), 750);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be queued.');
    } finally {
      setSending(false);
    }
  };

  const resendFailed = async (message: ConversationMessage) => {
    if (!selectedId) return;
    setActionLoading(`resend:${message.id}`);
    setError('');
    try {
      const resent = await sendConversationMessage(selectedId, {
        body: message.body,
        channel: message.channel,
        replyToMessageId: message.replyToMessageId,
      });
      appendSentMessage(resent, message.body, message.channel);
      setNotice('A new delivery attempt has been queued.');
      window.setTimeout(() => void loadDetail(selectedId, { silent: true }), 750);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The message could not be sent again.');
    } finally {
      setActionLoading('');
    }
  };

  const appendLink = (label: string, url: string) => setComposer(composer.trim() ? `${composer.trim()}\n\n${label}: ${url}` : `${label}: ${url}`);

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

  const quickActions = [
    { id: 'book', label: 'Book client', icon: CalendarPlus, disabled: !connectedContext.clientId, action: () => navigate(`/app/calendar?create=booking&clientId=${connectedContext.clientId}`) },
    { id: 'form', label: 'Send form', icon: FilePlus2, disabled: !connectedContext.clientId, action: () => navigate(`/app/forms?assign=1&clientId=${connectedContext.clientId}${connectedContext.appointmentId ? `&appointmentId=${connectedContext.appointmentId}` : ''}`) },
    { id: 'payment', label: 'Payment link', icon: CreditCard, disabled: !connectedContext.appointmentId, action: () => void preparePaymentLink() },
    { id: 'booking-page', label: 'Booking page', icon: Link2, disabled: false, action: () => void prepareBookingPage() },
  ];

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white"><Inbox className="h-5 w-5" /></span>
        <div className="min-w-0"><h1 className="truncate text-lg font-black text-slate-950">Customer inbox</h1><p className="truncate text-xs font-medium text-slate-500">{lastRefreshedAt ? `Live · updated ${formatTime(lastRefreshedAt.toISOString())}` : 'Live refresh starting…'}</p></div>
      </div>
      <button type="button" onClick={notificationsEnabled ? disableNotifications : () => void enableNotifications()} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" title={notificationsEnabled ? 'Disable desktop notifications' : 'Enable desktop notifications'}>{notificationsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}</button>
      <button type="button" onClick={() => { void loadList(); if (selectedId) void loadDetail(selectedId); }} disabled={loadingList || loadingDetail} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loadingList || loadingDetail ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Refresh</span></button>
      <Link to="/app/settings/communications" className="inline-flex h-10 items-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white hover:bg-slate-800">Channels</Link>
    </header>

    {(error || notice) && <div className={`shrink-0 border-b px-4 py-2 text-xs font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <div className="grid min-h-0 flex-1 lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_320px]">
      <aside className={`${selectedId ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col border-r border-slate-200 bg-white`}>
        <div className="space-y-3 border-b border-slate-200 p-3">
          <form onSubmit={event => { event.preventDefault(); setSearch(searchInput.trim()); }} className="flex items-center rounded-xl border border-slate-200 bg-slate-50 focus-within:border-indigo-400 focus-within:bg-white">
            <Search className="ml-3 h-4 w-4 text-slate-400" />
            <input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search conversations" className="min-h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm outline-none" />
          </form>
          <div className="flex gap-2 overflow-x-auto pb-1">{(['', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'SMS', 'EMAIL'] as const).map(value => <button key={value || 'ALL'} type="button" onClick={() => setChannel(value)} className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black ${channel === value ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>{value ? channelLabels[value] : 'All'}</button>)}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="relative"><span className="sr-only">Status</span><select value={status} onChange={event => setStatus(event.target.value as ConversationStatus | '')} className="min-h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-7 text-xs font-bold"><option value="">All statuses</option><option value="OPEN">Open</option><option value="PENDING">Awaiting customer</option><option value="RESOLVED">Resolved</option></select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" /></label>
            <label className="relative"><span className="sr-only">Assignment</span><select value={assignment} onChange={event => setAssignment(event.target.value as typeof assignment)} className="min-h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-7 text-xs font-bold"><option value="ALL">Everyone</option><option value="MINE">Assigned to me</option><option value="UNASSIGNED">Unassigned</option></select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" /></label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{loadingList ? <div className="space-y-3 p-4">{[0,1,2,3].map(item => <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div> : items.length === 0 ? <div className="flex h-full flex-col items-center justify-center p-8 text-center"><Inbox className="h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">No conversations found</p></div> : items.map(item => <ConversationCard key={item.id} item={item} active={selectedId === item.id} onClick={() => { setSelectedId(item.id); setNotice(''); setError(''); }} />)}</div>
      </aside>

      <main className={`${selectedId ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col bg-white`}>
        {!selected ? <div className="flex h-full flex-col items-center justify-center p-8 text-center"><MessageCircle className="h-12 w-12 text-slate-300" /><h2 className="mt-4 text-lg font-black text-slate-800">Choose a conversation</h2></div> : <>
          <header className="shrink-0 border-b border-slate-200 px-3 py-3 sm:px-4">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">{initials(selected.customerName)}</div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-black text-slate-950 sm:text-base">{selected.customerName}</h2><ChannelBadge channel={selected.channel} /></div><p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{selected.subject || selected.customerEmail || selected.customerPhone || 'Customer conversation'}</p></div>
              <label className="hidden md:block"><span className="sr-only">Assign</span><select disabled={actionLoading === 'update'} value={selected.assignedToUserId || ''} onChange={event => void updateSelected({ assignedToUserId: event.target.value || null })} className="max-w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option value="">Unassigned</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
              <button type="button" disabled={actionLoading === 'update'} onClick={() => void updateSelected({ status: selected.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED' })} className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-black ${selected.status === 'RESOLVED' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-600 text-white'}`}><Check className="h-4 w-4" /><span className="hidden sm:inline">{selected.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}</span></button>
              <button type="button" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><MoreHorizontal className="h-5 w-5" /></button>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3"><Search className="h-4 w-4 text-slate-400" /><input value={threadSearch} onChange={event => setThreadSearch(event.target.value)} placeholder="Search this conversation" className="min-h-9 min-w-0 flex-1 bg-transparent text-xs outline-none" />{threadSearch && <button type="button" onClick={() => setThreadSearch('')}><X className="h-4 w-4 text-slate-400" /></button>}<span className="text-[10px] font-bold text-slate-400">{threadSearch ? `${filteredMessages.length} found` : `${detail?.messages.length || 0} messages`}</span></div>
          </header>

          <div ref={scrollArea} onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120; if (nearBottom.current) setNewMessages(0); }} className="relative min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-5 sm:px-6">
            {loadingDetail ? <div className="mx-auto max-w-3xl space-y-4">{[0,1,2].map(item => <div key={item} className={`h-20 animate-pulse rounded-2xl bg-slate-200 ${item % 2 ? 'ml-auto w-2/3' : 'w-3/4'}`} />)}</div> : <div className="mx-auto max-w-3xl space-y-4">
              {filteredMessages.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><MessageCircle className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">{threadSearch ? 'No matching messages' : 'Start the conversation'}</p></div>}
              {filteredMessages.map((message, index) => {
                const outbound = message.direction === 'OUTBOUND';
                const repliedMessage = message.replyToMessageId ? messageById.get(message.replyToMessageId) : null;
                const originalIndex = detail?.messages.findIndex(item => item.id === message.id) ?? index;
                const boundary = selectedId ? unreadBoundary.current[selectedId] : undefined;
                const showUnread = !threadSearch && boundary !== undefined && originalIndex === boundary;
                const showDate = originalIndex === 0 || new Date(message.createdAt).toDateString() !== new Date(detail!.messages[originalIndex - 1]!.createdAt).toDateString();
                return <div key={message.id}>
                  {showUnread && <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-indigo-200" /><span className="rounded-full bg-indigo-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-indigo-700">New messages</span><span className="h-px flex-1 bg-indigo-200" /></div>}
                  {showDate && <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200" /><time className="text-[10px] font-black uppercase tracking-wider text-slate-400">{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(new Date(message.createdAt))}</time><span className="h-px flex-1 bg-slate-200" /></div>}
                  <div className={`group flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${outbound ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'}`}>
                      <div className={`mb-1 flex items-center gap-2 text-[10px] font-black ${outbound ? 'text-indigo-100' : 'text-slate-400'}`}><span>{message.senderName}</span><ChannelBadge channel={message.channel} compact /></div>
                      {message.replyToMessageId && <div className={`mb-2 rounded-lg border-l-2 px-3 py-2 text-xs ${outbound ? 'border-indigo-200 bg-indigo-500/40 text-indigo-50' : 'border-slate-300 bg-slate-50 text-slate-600'}`}><p className="font-black">Replying to {repliedMessage?.senderName || 'an earlier message'}</p><p className="mt-0.5 line-clamp-2">{repliedMessage?.body || 'Original message is unavailable'}</p></div>}
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                      {message.attachments.length > 0 && <div className="mt-3 grid gap-2">{message.attachments.map(attachment => <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left ${outbound ? 'border-indigo-400 bg-indigo-500/30 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-black">{attachment.fileName}</span><span className="block text-[10px] opacity-75">{attachment.mimeType} · {formatBytes(attachment.fileSizeBytes)}</span></span></a>)}</div>}
                      <div className={`mt-2 flex items-center justify-end gap-2 text-[10px] font-bold ${outbound ? 'text-indigo-100' : 'text-slate-400'}`}><button type="button" onClick={() => setReplyTo(message)} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 opacity-70 hover:opacity-100 ${outbound ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}><CornerUpLeft className="h-3 w-3" />Reply</button><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>{outbound && <span title={message.status === 'FAILED' ? 'The provider did not accept or deliver this message.' : undefined}>{deliveryLabel[message.status]}</span>}{outbound && message.status === 'FAILED' && <button type="button" disabled={actionLoading === `resend:${message.id}`} onClick={() => void resendFailed(message)} className="rounded-md bg-white/15 px-1.5 py-0.5 text-white hover:bg-white/25 disabled:opacity-50">{actionLoading === `resend:${message.id}` ? 'Sending…' : 'Send again'}</button>}</div>
                    </div>
                  </div>
                </div>;
              })}
              <div ref={messagesEnd} />
            </div>}
            {newMessages > 0 && <button type="button" onClick={scrollToEnd} className="sticky bottom-3 mx-auto mt-3 flex items-center rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-lg">{newMessages} new {newMessages === 1 ? 'message' : 'messages'}</button>}
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{quickActions.map(action => <button key={action.id} type="button" disabled={action.disabled || actionLoading === action.id} onClick={action.action} className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-40"><action.icon className="h-3.5 w-3.5" />{actionLoading === action.id ? 'Preparing…' : action.label}</button>)}</div>
              <div className="rounded-2xl border border-slate-300 bg-white shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
                {replyTo && <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2"><CornerUpLeft className="mt-0.5 h-4 w-4 text-indigo-600" /><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">Replying to {replyTo.senderName}</p><p className="truncate text-xs text-slate-600">{replyTo.body}</p></div><button type="button" onClick={() => setReplyTo(null)}><X className="h-4 w-4 text-slate-400" /></button></div>}
                <textarea value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setReplyTo(null); if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submitMessage(); } }} rows={3} placeholder={`Reply to ${selected.customerName}`} className="max-h-40 min-h-20 w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 py-3 text-sm leading-6 outline-none" />
                <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2"><label className="relative"><span className="sr-only">Reply channel</span><select value={composerChannel} onChange={event => setComposerChannel(event.target.value as ConversationChannel)} className="appearance-none rounded-lg border-0 bg-slate-100 py-2 pl-3 pr-7 text-xs font-black"><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option><option value="FACEBOOK">Facebook</option><option value="SMS">SMS</option><option value="EMAIL">Email</option></select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" /></label><p className="hidden min-w-0 flex-1 truncate text-[10px] text-slate-400 sm:block">Draft saved automatically · Ctrl/⌘ + Enter to send · Esc cancels reply</p><button type="button" onClick={() => void submitMessage()} disabled={sending || !composer.trim()} className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white disabled:opacity-40"><Send className="h-4 w-4" />{sending ? 'Sending…' : 'Send'}</button></div>
              </div>
            </div>
          </footer>
        </>}
      </main>

      <aside className="hidden min-h-0 flex-col border-l border-slate-200 bg-white xl:flex">
        {customer && selected ? <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-lg font-black text-white">{initials(customer.name)}</div><h2 className="mt-3 text-base font-black text-slate-950">{customer.name}</h2><p className="mt-1 text-xs text-slate-500">{customer.email || customer.phone || 'No contact details'}</p>{customer.clientId && <Link to={`/app/clients/${customer.clientId}`} className="mt-3 inline-flex items-center gap-1 text-xs font-black text-indigo-600"><UserRound className="h-3.5 w-3.5" />View customer profile</Link>}</div>
          <section className="mt-6 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Bookings</p><p className="mt-1 text-xl font-black">{customer.totalBookings}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Completed</p><p className="mt-1 text-xl font-black">{customer.completedBookings}</p></div></section>
          <section className="mt-6"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Next booking</h3>{customer.upcomingBooking && <Circle className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />}</div>{customer.upcomingBooking ? <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-black text-emerald-950">{customer.upcomingBooking.serviceName}</p><p className="mt-1 text-xs font-bold text-emerald-800">{formatDateTime(customer.upcomingBooking.startTime)}</p></div> : <div className="mt-2 rounded-2xl border border-dashed border-slate-300 p-4 text-center"><p className="text-xs font-bold text-slate-500">No upcoming booking linked</p></div>}</section>
          <section className="mt-6"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Conversation</h3><dl className="mt-2 divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4 text-xs"><div className="flex items-center justify-between py-3"><dt className="font-bold text-slate-500">Status</dt><dd className="font-black">{selected.status === 'PENDING' ? 'Awaiting customer' : selected.status}</dd></div><div className="flex items-center justify-between py-3"><dt className="font-bold text-slate-500">Assigned to</dt><dd className="max-w-36 truncate font-black">{selected.assignedToName || 'Unassigned'}</dd></div><div className="flex items-center justify-between py-3"><dt className="font-bold text-slate-500">Priority</dt><dd><select value={selected.priority} onChange={event => void updateSelected({ priority: event.target.value as ConversationPriority })} className={`rounded-full border-0 px-2 py-1 text-[10px] font-black ${priorityTone[selected.priority]}`}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></dd></div></dl></section>
          <section className="mt-6"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Quick actions</h3><div className="mt-2 grid gap-2">{quickActions.map(action => <button key={`side-${action.id}`} type="button" onClick={action.action} disabled={action.disabled || actionLoading === action.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-left text-xs font-black text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-40"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><action.icon className="h-4 w-4" /></span>{action.label}</button>)}</div></section>
        </div> : <div className="flex h-full flex-col items-center justify-center p-8 text-center"><UserRound className="h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Customer context</p></div>}
      </aside>
    </div>
  </div>;
}
