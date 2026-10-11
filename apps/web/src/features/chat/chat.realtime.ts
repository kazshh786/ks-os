import { CommunicationsEventSchema, type CommunicationsEvent } from '@ks-os/contracts';
import { chatApi, chatBase, ChatError } from './chat.api';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
export function connectChat(callbacks: { event: (event: CommunicationsEvent) => void; ready: () => Promise<void>; state: (state: ConnectionState) => void; revoked: () => void }) {
  let stopped = false, attempt = 0, cursor: string | undefined;
  let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  const retry = () => {
    if (stopped) return;
    callbacks.state('reconnecting');
    timer = setTimeout(() => void open(), Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 300);
  };
  const open = async () => {
    callbacks.state(cursor ? 'reconnecting' : 'connecting');
    try {
      const ticket = await chatApi.ticket();
      if (stopped) return;
      // Establish the replay boundary BEFORE fetching snapshots; no snapshot/socket gap.
      cursor ??= ticket.cursor;
      await callbacks.ready();
      if (stopped) return;
      const url = new URL(`${chatBase}/events`, String(import.meta.env.VITE_API_ORIGIN || window.location.origin));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticket.ticket);
      url.searchParams.set('after', cursor);
      socket = new WebSocket(url);
      socket.onopen = () => { attempt = 0; callbacks.state('connected'); };
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const parsed = CommunicationsEventSchema.parse(JSON.parse(String(event.data)));
          if (seen.has(parsed.id)) return;
          seen.add(parsed.id);
          if (seen.size > 2000) seen.delete(seen.values().next().value!);
          // Out-of-order invalidations still apply, but never move the replay cursor backwards.
          if (BigInt(parsed.id) > BigInt(cursor!)) cursor = parsed.id;
          callbacks.event(parsed);
        } catch { socket?.close(); }
      };
      socket.onclose = retry;
      socket.onerror = () => socket?.close();
    } catch (error) {
      if (stopped) return;
      if (error instanceof ChatError && [401,403].includes(error.status)) {
        callbacks.state('unavailable'); callbacks.revoked(); return;
      }
      retry();
    }
  };
  void open();
  return () => { stopped = true; clearTimeout(timer); if (socket) { socket.onclose = null; socket.close(); } };
}

export function mergeMessages(current: import('@ks-os/contracts').NativeMessage[], incoming: import('@ks-os/contracts').NativeMessage[]) {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a,b) => BigInt(a.position) < BigInt(b.position) ? -1 : 1);
}
