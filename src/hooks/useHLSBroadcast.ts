import { useRef, useState, useCallback } from 'react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS } from '@/types/channels';

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_SERVER = `${WS_PROTOCOL}://${window.location.host}/ws`;

interface DeckBroadcast {
  ws: WebSocket | null;
  recorder: MediaRecorder | null;
  stream: MediaStream;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  active: boolean;
}

export function useHLSBroadcast() {
  const broadcastsRef = useRef<Partial<Record<DeckId, DeckBroadcast>>>({});
  const [isHosting, setIsHosting] = useState(false);
  const [listenerCounts] = useState<Record<DeckId, number>>({ A: 0, B: 0, C: 0, D: 0 });

  const connectDeck = useCallback((deckId: DeckId, broadcast: DeckBroadcast) => {
    if (!broadcast.active) return;

    console.log(`[${deckId}] Connecting WebSocket...`);
    const ws = new WebSocket(`${WS_SERVER}?deck=${deckId}&type=broadcast`);
    ws.binaryType = 'arraybuffer';
    broadcast.ws = ws;

    ws.onopen = () => {
      console.log(`[${deckId}] WebSocket open — starting MediaRecorder`);
      if (broadcast.reconnectTimer) {
        clearTimeout(broadcast.reconnectTimer);
        broadcast.reconnectTimer = null;
      }

      // Stop any old recorder first
      if (broadcast.recorder && broadcast.recorder.state !== 'inactive') {
        broadcast.recorder.stop();
      }

      // Fresh MediaRecorder every connection — sends full WebM header
      const recorder = new MediaRecorder(broadcast.stream, {
        mimeType: getSupportedMimeType(),
        audioBitsPerSecond: 128000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      recorder.onerror = (e) => {
        console.error(`[${deckId}] MediaRecorder error:`, e);
      };

      recorder.start(500); // 500ms chunks — lower latency
      broadcast.recorder = recorder;
    };

    ws.onclose = (e) => {
      console.warn(`[${deckId}] WebSocket closed (code ${e.code}) — reconnecting in 2s`);

      // Stop recorder cleanly
      if (broadcast.recorder && broadcast.recorder.state !== 'inactive') {
        broadcast.recorder.stop();
        broadcast.recorder = null;
      }

      // Auto-reconnect after 2 seconds
      if (broadcast.active) {
        broadcast.reconnectTimer = setTimeout(() => {
          connectDeck(deckId, broadcast);
        }, 2000);
      }
    };

    ws.onerror = (err) => {
      console.error(`[${deckId}] WebSocket error:`, err);
      ws.close();
    };
  }, []);

  const startHosting = useCallback((
    getDeckStream: (deck: DeckId) => MediaStream | null,
  ) => {
    if (Object.keys(broadcastsRef.current).length > 0) return;

    ALL_DECKS.forEach((deckId) => {
      const stream = getDeckStream(deckId);
      if (!stream) {
        console.warn(`[${deckId}] No stream available`);
        return;
      }

      const broadcast: DeckBroadcast = {
        ws: null,
        recorder: null,
        stream,
        reconnectTimer: null,
        active: true,
      };

      broadcastsRef.current[deckId] = broadcast;
      connectDeck(deckId, broadcast);
    });

    setIsHosting(true);
  }, [connectDeck]);

  const stopHosting = useCallback(() => {
    ALL_DECKS.forEach((deckId) => {
      const b = broadcastsRef.current[deckId];
      if (b) {
        b.active = false;
        if (b.reconnectTimer) clearTimeout(b.reconnectTimer);
        if (b.recorder && b.recorder.state !== 'inactive') b.recorder.stop();
        if (b.ws) b.ws.close();
      }
    });
    broadcastsRef.current = {};
    setIsHosting(false);
  }, []);

  const listenerCount = 0;

  return { isHosting, listenerCount, listenerCounts, startHosting, stopHosting };
}

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}
