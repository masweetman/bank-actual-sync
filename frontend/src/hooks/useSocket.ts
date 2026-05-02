import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SyncEvent } from '../types';

type EventHandler = (event: SyncEvent) => void;

export function useSocket(token: string | null, onEvent: EventHandler) {
  const socketRef = useRef<Socket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!token) return;

    const socket = io('/', {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('sync_event', (event: SyncEvent) => {
      onEventRef.current(event);
    });

    socket.on('connect_error', (err) => {
      onEventRef.current({
        type: 'SYNC_ERROR',
        payload: { message: `Connection error: ${err.message}` },
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const triggerSync = useCallback(() => {
    socketRef.current?.emit('trigger_sync');
  }, []);

  return { triggerSync };
}
