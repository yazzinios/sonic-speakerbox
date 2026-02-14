import { useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';

export interface MusicRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  song: string;
  timestamp: number;
}

// Host side: receive requests via data channel
export function useRequestHost() {
  const peerRef = useRef<Peer | null>(null);
  const [requests, setRequests] = useState<MusicRequest[]>([]);
  const [requestPeerId, setRequestPeerId] = useState('');
  const [isListening, setIsListening] = useState(false);

  const startListening = useCallback(() => {
    if (peerRef.current) return;
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      setRequestPeerId(id);
      setIsListening(true);
    });

    peer.on('connection', (conn: DataConnection) => {
      conn.on('data', (data) => {
        const req = data as MusicRequest;
        req.id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        req.timestamp = Date.now();
        setRequests(prev => [req, ...prev]);
      });
    });

    peer.on('error', (err) => console.error('Request peer error:', err));
  }, []);

  const stopListening = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    setRequestPeerId('');
    setIsListening(false);
  }, []);

  const dismissRequest = useCallback((id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
  }, []);

  return { requests, requestPeerId, isListening, startListening, stopListening, dismissRequest };
}

// Client side: send a request
export function useRequestClient() {
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sendRequest = useCallback(async (hostId: string, request: Omit<MusicRequest, 'id' | 'timestamp'>) => {
    setIsSending(true);
    return new Promise<void>((resolve, reject) => {
      const peer = new Peer();
      peer.on('open', () => {
        const conn = peer.connect(hostId);
        conn.on('open', () => {
          conn.send(request);
          setSent(true);
          setIsSending(false);
          setTimeout(() => peer.destroy(), 1000);
          resolve();
        });
        conn.on('error', (err) => {
          setIsSending(false);
          reject(err);
        });
      });
      peer.on('error', (err) => {
        setIsSending(false);
        reject(err);
      });
    });
  }, []);

  const reset = useCallback(() => setSent(false), []);

  return { isSending, sent, sendRequest, reset };
}
