/**
 * useServerDeck — Server Mode state + control hook
 *
 * This is the SERVER_MODE equivalent of useAudioEngine.
 * The browser never plays audio. Everything goes through the API.
 *
 * - Polls /deck-info every 2s for live server state
 * - Exposes all deck control actions (load, play, pause, stop, skip, autodj, playlist)
 * - Returns server online status so the UI can show a warning if offline
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { DeckId } from '@/types/channels';
import { STREAMING_SERVER, getDeckStreamUrl } from '@/lib/streamingServer';
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
  autoDJEnabled: true,
  autoDJActive: false,
  looping: false,
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

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${STREAMING_SERVER}/deck-info`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error('not ok');
      const data = await res.json();
      setServerOnline(true);
      setDecks({
        A: { ...EMPTY_DECK, ...data.A, streamUrl: getDeckStreamUrl('A') },
        B: { ...EMPTY_DECK, ...data.B, streamUrl: getDeckStreamUrl('B') },
        C: { ...EMPTY_DECK, ...data.C, streamUrl: getDeckStreamUrl('C') },
        D: { ...EMPTY_DECK, ...data.D, streamUrl: getDeckStreamUrl('D') },
      });
    } catch {
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  // ── Deck actions ─────────────────────────────────────────────────────────

  const loadTrack = useCallback(async (deck: DeckId, track: LibraryTrack, loop = false) => {
    try {
      await apiPost(`/deck/${deck}/load`, { serverName: track.serverName, loop });
      toast.success(`Deck ${deck} ▶ ${track.name}`);
      fetchStatus();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchStatus]);

  const play = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/play`);
      fetchStatus();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchStatus]);

  const pause = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/pause`);
      fetchStatus();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchStatus]);

  const stop = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/stop`);
      fetchStatus();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchStatus]);

  const skip = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/skip`);
      fetchStatus();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchStatus]);

  const setAutoDJ = useCallback(async (deck: DeckId, enabled: boolean) => {
    try {
      await apiPost(`/deck/${deck}/autodj`, { enabled });
      fetchStatus();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
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
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchStatus]);

  const playlistNext = useCallback(async (deck: DeckId) => {
    try {
      await apiPost(`/deck/${deck}/playlist/next`);
      fetchStatus();
    } catch {}
  }, [fetchStatus]);

  const playlistJump = useCallback(async (deck: DeckId, index: number) => {
    try {
      await apiPost(`/deck/${deck}/playlist/jump`, { index });
      fetchStatus();
    } catch {}
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
    loadPlaylist,
    playlistNext,
    playlistJump,
    refresh: fetchStatus,
  };
}
