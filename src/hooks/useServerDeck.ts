/**
 * useServerDeck — Server Mode state + control hook
 * v2: Added paused state, jingle support, improved play/pause/stop reliability
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { DeckId } from '@/types/channels';
import { STREAMING_SERVER, WS_SERVER, getDeckStreamUrl } from '@/lib/streamingServer';
import { toast } from 'sonner';
import type { LibraryTrack } from '@/hooks/useLibrary';

export interface ServerDeckState {
  mode: 'file' | 'playlist' | 'autodj' | 'live' | null;
  trackName: string | null;
  trackPath: string | null;
  streaming: boolean;
  djConnected: boolean;
  autoDJEnabled: boolean;
  autoDJActive: boolean;
  looping: boolean;
  paused: boolean;
  playlistLength: number;
  playlistIndex: number;
  playlistLoop: boolean;
  currentTrack: { name: string; serverName: string } | null;
  playlist: Array<{ name: string; serverName: string }>;
  streamUrl: string;
}

const EMPTY_DECK: ServerDeckState = {
  mode: null,
  trackName: null,
  trackPath: null,
  streaming: false,
  djConnected: false,
  autoDJEnabled: false,
  autoDJActive: false,
  looping: false,
  paused: false,
  playlistLength: 0,
  playlistIndex: 0,
  playlistLoop: false,
  currentTrack: null,
  playlist: [],
  streamUrl: '',
};

async function apiPost(path: string, body?: object) {
  const res = await fetch(`${STREAMING_SERVER}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export function useServerDeck() {
  const [decks, setDecks] = useState<Record<DeckId, ServerDeckState>>({
    A: { ...EMPTY_DECK, streamUrl: getDeckStreamUrl('A') },
    B: { ...EMPTY_DECK, streamUrl: getDeckStreamUrl('B') },
    C: { ...EMPTY_DECK, streamUrl: getDeckStreamUrl('C') },
    D: { ...EMPTY_DECK, streamUrl: getDeckStreamUrl('D') },
  });
  const [serverOnline, setServerOnline] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyDeckInfo = useCallback((data: Record<string, unknown>) => {
    setServerOnline(true);
    setDecks({
      A: { ...EMPTY_DECK, ...(data.A as object), streamUrl: getDeckStreamUrl('A') },
      B: { ...EMPTY_DECK, ...(data.B as object), streamUrl: getDeckStreamUrl('B') },
      C: { ...EMPTY_DECK, ...(data.C as object), streamUrl: getDeckStreamUrl('C') },
      D: { ...EMPTY_DECK, ...(data.D as object), streamUrl: getDeckStreamUrl('D') },
    });
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${STREAMING_SERVER}/deck-info`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error('not ok');
      const data = await res.json();
      applyDeckInfo(data);
    } catch (err) {
      console.error('[ServerDeck] Polling failed:', err);
      setServerOnline(false);
    }
  }, [applyDeckInfo]);

  // FIX: listen for real-time push messages from server so UI updates
  // instantly after play/pause/stop instead of waiting for next 2s poll.
  useEffect(() => {
    const wsUrl = `${WS_SERVER}?type=monitor`;
    let ws: WebSocket;
    let dead = false;

    function connect() {
      if (dead) return;
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'deck-state' && msg.data) applyDeckInfo(msg.data);
          } catch (_) {}
        };
        ws.onerror = () => ws.close();
        ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
      } catch (_) {}
    }
    connect();
    return () => { dead = true; try { ws?.close(); } catch (_) {} };
  }, [applyDeckInfo]);

  useEffect(() => {
    fetchStatus();
    // FIX: poll every 3s instead of 2s — WS push handles instant updates
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  // ── Deck actions ─────────────────────────────────────────────────────────

  const loadTrack = useCallback(async (deck: DeckId, track: LibraryTrack, loop = false) => {
    try {
      await apiPost(`/deck/${deck}/load`, { serverName: track.serverName, loop });
      toast.success(`Deck ${deck} — "${track.name}" loaded. Press ▶ to play.`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const play = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/play`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const pause = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/pause`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const stop = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/stop`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const skip = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/skip`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const setAutoDJ = useCallback(async (deck: DeckId, enabled: boolean) => {
    try {
      await apiPost(`/deck/${deck}/autodj`, { enabled });
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const startStream = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/stream/start`);
      toast.success(`Deck ${deck} ▶ Broadcasting LIVE`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const stopStream = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/stream/stop`);
      toast.success(`Deck ${deck} ■ Stream stopped`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const loadPlaylist = useCallback(async (
    deck: DeckId,
    tracks: Array<{ id: string; serverName: string; name: string }>,
    loop = false,
    startIndex = 0,
  ) => {
    try {
      await apiPost(`/deck/${deck}/playlist`, { tracks, loop, startIndex });
      toast.success(`Deck ${deck}: Playlist loaded (${tracks.length} tracks)`);
      fetchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`Deck ${deck}: ${message}`);
    }
  }, [fetchStatus]);

  const playlistNext = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/playlist/next`);
      fetchStatus();
    } catch (e) {
      console.warn('Playlist next failed', e);
    }
  }, [fetchStatus]);

  const playlistJump = useCallback(async (deck: DeckId, index: number) => {
    try {
      await apiPost(`/deck/${deck}/playlist/jump`, { index });
      fetchStatus();
    } catch (e) {
      console.warn('Playlist jump failed', e);
    }
  }, [fetchStatus]);

  return {
    decks,
    serverOnline,
    loadTrack,
    play,
    pause,
    stop,
    skip,
    setAutoDJ,
    startStream,
    stopStream,
    loadPlaylist,
    playlistNext,
    playlistJump,
    refresh: fetchStatus,
  };
}
