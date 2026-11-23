import { useCallback, useEffect, useRef, useState } from 'react';
import { getActiveSessionToken } from '../firebase';
import { sendP2PMessageRest } from '../services/p2p';
import type { P2PChatMessage, P2POrder } from '../types/p2p';

export interface TypingUser {
  uid: string;
  username: string;
}

export interface PresenceUser {
  uid: string;
  username: string;
  isAdmin: boolean;
}

export function useP2PWebSocket(
  orderId: string | null,
  currentUid: string | null,
  onOrderUpdated?: (order: P2POrder) => void
) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<P2PChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [wsError, setWsError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const onOrderUpdatedRef = useRef(onOrderUpdated);
  onOrderUpdatedRef.current = onOrderUpdated;

  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);

  const upsertMessages = useCallback((incoming: P2PChatMessage[]) => {
    setMessages((prev) => {
      const map = new Map<string, P2PChatMessage>();
      for (const m of prev) map.set(m.id, m);
      for (const m of incoming) map.set(m.id, m);
      return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
    });
  }, []);

  useEffect(() => {
    if (!orderId || !currentUid) {
      setConnected(false);
      setTypingUsers([]);
      setOnlineUsers([]);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = async () => {
      if (cancelled) return;
      const token = await getActiveSessionToken();
      if (!token || cancelled) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/p2p?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        attempt = 0;
        setConnected(true);
        setWsError(null);
        ws.send(JSON.stringify({ type: 'room:join', orderId }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data || '{}')) as {
            type?: string;
            orderId?: string;
            order?: P2POrder;
            messages?: P2PChatMessage[];
            message?: P2PChatMessage;
            typingUsers?: TypingUser[];
            onlineUsers?: PresenceUser[];
            error?: string;
          };

          if (data.type === 'room:init' && data.orderId === orderId) {
            if (Array.isArray(data.messages)) {
              upsertMessages(data.messages);
            }
            if (Array.isArray(data.typingUsers)) {
              setTypingUsers(data.typingUsers.filter((t) => t.uid !== currentUid));
            }
            if (data.order) {
              onOrderUpdatedRef.current?.(data.order);
            }
          } else if (data.type === 'chat:message' && data.orderId === orderId && data.message) {
            upsertMessages([data.message]);
          } else if (data.type === 'chat:typing' && data.orderId === orderId) {
            setTypingUsers((data.typingUsers || []).filter((t) => t.uid !== currentUid));
          } else if (data.type === 'room:presence' && data.orderId === orderId) {
            setOnlineUsers(data.onlineUsers || []);
          } else if (data.type === 'order:updated' && data.orderId === orderId && data.order) {
            onOrderUpdatedRef.current?.(data.order);
          } else if (data.type === 'ws:error' && data.error) {
            setWsError(data.error);
          }
        } catch {
          // ignore malformed WS frame
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (!cancelled) {
          const delay = Math.min(8000, 1000 * Math.pow(1.5, attempt));
          attempt += 1;
          reconnectTimer = window.setTimeout(() => {
            void connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'room:leave', orderId }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [orderId, currentUid, upsertMessages]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!orderId) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      if (isTyping) {
        if (now - lastTypingSentAtRef.current >= 900) {
          lastTypingSentAtRef.current = now;
          ws.send(JSON.stringify({ type: 'chat:typing', orderId, isTyping: true }));
        }
        if (typingStopTimerRef.current !== null) {
          window.clearTimeout(typingStopTimerRef.current);
        }
        typingStopTimerRef.current = window.setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'chat:typing', orderId, isTyping: false }));
          }
          lastTypingSentAtRef.current = 0;
        }, 2500);
      } else {
        if (typingStopTimerRef.current !== null) {
          window.clearTimeout(typingStopTimerRef.current);
          typingStopTimerRef.current = null;
        }
        lastTypingSentAtRef.current = 0;
        ws.send(JSON.stringify({ type: 'chat:typing', orderId, isTyping: false }));
      }
    },
    [orderId]
  );

  const sendMessage = useCallback(
    async (params: { text: string; attachmentImage?: string; txHash?: string }) => {
      if (!orderId) return;
      const clientId = `p2pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      emitTyping(false);

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'chat:send',
            orderId,
            clientId,
            text: params.text,
            attachmentImage: params.attachmentImage || '',
            txHash: params.txHash || '',
          })
        );
        return;
      }

      const saved = await sendP2PMessageRest(orderId, {
        ...params,
        clientId,
      });
      upsertMessages([saved]);
    },
    [orderId, emitTyping, upsertMessages]
  );

  const seedMessages = useCallback(
    (initial: P2PChatMessage[]) => {
      upsertMessages(initial);
    },
    [upsertMessages]
  );

  return {
    connected,
    messages,
    typingUsers,
    onlineUsers,
    wsError,
    emitTyping,
    sendMessage,
    seedMessages,
  };
}
