import { useCallback, useEffect, useRef } from 'react';

const WS_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
  .replace(/^http/, 'ws') + '/ws';

export function useWebSocket(onRefresh: () => void, enabled: boolean) {
  const wsRef      = useRef<WebSocket | null>(null);
  const retryDelay = useRef(1000);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      retryDelay.current = 1000; // reset backoff on success
      // Send pings every 25s to keep connection alive
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
      ws.addEventListener('close', () => clearInterval(ping));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'refresh') onRefresh();
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current || !enabled) return;
      // Exponential backoff reconnect (max 30s)
      setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
        connect();
      }, retryDelay.current);
    };

    ws.onerror = () => ws.close(); // triggers onclose → retry
  }, [enabled, onRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [enabled, connect]);
}
