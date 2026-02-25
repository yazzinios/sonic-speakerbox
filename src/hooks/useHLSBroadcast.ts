import { useRef, useState, useCallback } from 'react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS } from '@/types/channels';
import { toast } from 'sonner';

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_SERVER = `${WS_PROTOCOL}://${window.location.host}/ws`;

interface DeckBroadcast {
  ws: WebSocket | null;
  recorder: MediaRecorder | null;
  stream: MediaStream;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  reconnectAttempts: number;
}

export function useHLSBroadcast() {
  const broadcastsRef = useRef<Partial<Record<DeckId, DeckBroadcast>>>({});
  const [isHosting, setIsHosting] = useState(false);
  const [listenerCounts] = useState<Record<DeckId, number>>({ A: 0, B: 0, C: 0, D: 0 });

  const connectDeck = useCallback((deckId: DeckId, broadcast: DeckBroadcast) => {
    if (!broadcast.active) return;

    console.log(`[${deckId}] Connecting WebSocket...`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_SERVER}?deck=${deckId}&type=broadcast`);
    } catch (err) {
      console.error(`[${deckId}] Failed to create WebSocket:`, err);
      toast.error(`Deck ${deckId}: Cannot connect to streaming server. Is it running?`);
      return;
    }

    ws.binaryType = 'arraybuffer';
    broadcast.ws = ws;

    ws.onopen = () => {
      console.log(`[${deckId}] WebSocket open — starting MediaRecorder`);
      // Show reconnect success if this was a reconnect attempt
      if (broadcast.reconnectAttempts > 0) {
        toast.success(`Deck ${deckId}: Reconnected to streaming server!`);
      }
      broadcast.reconnectAttempts = 0;

      if (broadcast.reconnectTimer) {
        clearTimeout(broadcast.reconnectTimer);
        broadcast.reconnectTimer = null;
      }

      // Stop any old recorder first
      if (broadcast.recorder && broadcast.recorder.state !== 'inactive') {
        broadcast.recorder.stop();
        broadcast.recorder = null;
      }

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        toast.error(`Deck ${deckId}: Browser does not support required audio encoding.`);
        return;
      }

      // Small delay after connection to ensure server is ready, then start fresh recorder
      setTimeout(() => {
        if (!broadcast.active || ws.readyState !== WebSocket.OPEN) return;

        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(broadcast.stream, {
            mimeType,
            audioBitsPerSecond: 128000,
          });
        } catch (err) {
          console.error(`[${deckId}] Failed to create MediaRecorder:`, err);
          toast.error(`Deck ${deckId}: Could not initialize audio recorder. Try reloading.`);
          return;
        }

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        recorder.onerror = (e) => {
          console.error(`[${deckId}] MediaRecorder error:`, e);
        };

        recorder.start(500); // 500ms chunks
        broadcast.recorder = recorder;
        console.log(`[${deckId}] Broadcasting on deck ${deckId}`);
      }, 200);
    };

    ws.onclose = (e) => {
      console.warn(`[${deckId}] WebSocket closed (code ${e.code}) — reconnecting...`);

      if (broadcast.recorder && broadcast.recorder.state !== 'inactive') {
        broadcast.recorder.stop();
        broadcast.recorder = null;
      }

      if (broadcast.active) {
        broadcast.reconnectAttempts = (broadcast.reconnectAttempts || 0) + 1;
        const delay = Math.min(2000 * broadcast.reconnectAttempts, 15000); // back-off up to 15s
        if (broadcast.reconnectAttempts === 1) {
          toast.warning(`Deck ${deckId}: Connection lost — reconnecting...`);
        }
        console.log(`[${deckId}] Reconnecting in ${delay}ms (attempt ${broadcast.reconnectAttempts})`);
        broadcast.reconnectTimer = setTimeout(() => {
          connectDeck(deckId, broadcast);
        }, delay);
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
    // If already hosting in this session, stop first to cleanly restart
    if (Object.keys(broadcastsRef.current).length > 0) {
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
    }

    // Initialize audio context by requesting streams first
    let startedDecks = 0;
    const errors: string[] = [];

    ALL_DECKS.forEach((deckId) => {
      const stream = getDeckStream(deckId);

      if (!stream) {
        console.warn(`[${deckId}] No audio stream available`);
        errors.push(deckId);
        return;
      }

      // Check the stream has audio tracks (it always should from getDeckOutputStream)
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.warn(`[${deckId}] Stream has no audio tracks — deck will broadcast silence`);
        // We still broadcast — silence is valid and the stream is ready
      }

      const broadcast: DeckBroadcast = {
        ws: null,
        recorder: null,
        stream,
        reconnectTimer: null,
        active: true,
        reconnectAttempts: 0,
      };

      broadcastsRef.current[deckId] = broadcast;
      connectDeck(deckId, broadcast);
      startedDecks++;
    });

    if (startedDecks === 0) {
      toast.error('Could not start broadcasting. Make sure audio is initialized.');
      return;
    }

    setIsHosting(true);

    if (errors.length > 0) {
      toast.warning(`Broadcasting started. Decks ${errors.join(', ')} had no stream (will broadcast silence).`);
    } else {
      toast.success(`Broadcasting started on all ${startedDecks} channels!`);
    }
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
