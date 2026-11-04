import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // When running in Vite dev mode, socket connects to localhost:3000 or the current host/port
    const socketUrl = window.location.port === '5173'
      ? `http://${window.location.hostname}:3000`
      : window.location.origin;

    const s = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    s.on('connect', () => {
      setConnected(true);
      console.log('[Socket] Connected to backend:', s.id);
    });

    s.on('disconnect', () => {
      setConnected(false);
      console.log('[Socket] Disconnected');
    });

    socketRef.current = s;

    return () => {
      s.disconnect();
    };
  }, []);

  return { socket: socketRef.current, connected };
}

