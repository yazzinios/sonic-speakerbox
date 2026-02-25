import { useRef, useState, useCallback } from 'react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS } from '@/types/channels';

// All traffic goes through nginx on the same origin
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_SERVER = `${WS_PROTOCOL}://${window.location.host}/ws`;

interface DeckBroadcast {
  ws: WebSocket;
  recorder: MediaRecorder;
}

export function useHLSBroadcast() {
  const broadcastsRef = useRef<Partial<Record<DeckId, DeckBroadcast>>>({});
  const [isHosting, setIsHosting] = useState(false);
  const [listenerCounts] = useState<Record<DeckId, number>>({ A: 0, B: 0, C: 0, D: 0 });

  const startHosting = useCallback((
    getDeckStream: (deck: DeckId) => MediaStream | null,
  ) => {
    if (Object.keys(broadcastsRef.current).length > 0) return;

    let connectedCount = 0;

    ALL_DECKS.forEach((deckId) => {
      const stream = getDeckStream(deckId);
      if (!stream) return;

      const ws = new WebSocket(`${WS_SERVER}?deck=${deckId}&type=broadcast`);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log(`[${deckId}] WebSocket connected to streaming server`);

        // Use MediaRecorder to capture audio and send to server
        const recorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 128000,
        });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        recorder.start(1000); // send chunks every 1 second
        broadcastsRef.current[deckId] = { ws, recorder };

        connectedCount++;
        if (connectedCount === ALL_DECKS.length) {
          setIsHosting(true);
        }
      };

      ws.onerror = (err) => console.error(`[${deckId}] WS error:`, err);
      ws.onclose = () => console.log(`[${deckId}] WS closed`);
    });

    // Set hosting after a short delay even if some decks fail
    setTimeout(() => setIsHosting(true), 2000);
  }, []);

  const stopHosting = useCallback(() => {
    ALL_DECKS.forEach((deckId) => {
      const b = broadcastsRef.current[deckId];
      if (b) {
        b.recorder.stop();
        b.ws.close();
      }
    });
    broadcastsRef.current = {};
    setIsHosting(false);
  }, []);

  // Total listener count (HLS doesn't track this natively, placeholder)
  const listenerCount = 0;

  return { isHosting, listenerCount, listenerCounts, startHosting, stopHosting };
}
