/**
 * useServerDeck — Server Mode remote control hook
 *
 * Instead of playing audio in the browser (Web Audio API),
 * this hook sends all commands to the Express API on the server.
 * Liquidsoap handles actual playback; Icecast streams it out.
 *
 * The browser is a pure remote control dashboard.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { DeckId } from '@/types/channels';
import { STREAMING_SERVER, getDeckStreamUrl } from '@/lib/streamingServer';
import { toast } from 'sonner';

export interface ServerDeckInfo {
  mode: 'file' | 'playlist' | 'autodj' | 'live' | null;
  trackName: string | null;
  streaming: boolean;
  djConnected: boolean;
  autoDJEnabled: boolean;
  autoDJActive: boolean;
  playlistLength: number;
  playlistIndex: number;
  streamUrl: string;
}

const EMPTY_DECK: ServerDeckInfo = {
  mode: null,
  trackName: null,
  streaming: false,
  djConnected: false,
  autoDJEnabled: true,
  autoDJActive: false,
  playlistLength: 0,
  playlistIndex: 0,
  streamUrl: '',
};

async function apiCall(path: string, method = 'GET', body?: object) {
  const res = await fetch(`${STREAMING_SERVER}${path}`, {
    method,
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
  const [deckInfo, setDeckInfo] = useState<Record<DeckId, ServerDeckInfo>>({
    A: { ...EMPTY_DECK },
    B: { ...EMPTY_DECK },
    C: { ...EMPTY_DECK },
    D: { ...EMPTY_DECK },
  });
  const [serverOnline, setServerOnline] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll server every 2 seconds for deck status
  const fetchDeckInfo = useCallback(async () => {
    try {
      const data = await apiCall('/deck-info');
      setServerOnline(true);
      setDeckInfo({
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
    fetchDeckInfo();
    pollRef.current = setInterval(fetchDeckInfo, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDeckInfo]);

  /**
   * Load a track onto a deck (server plays it via Liquidsoap)
   */
  const loadTrack = useCallback(async (deck: DeckId, serverName: string, loop = false) => {
    try {
      await apiCall(`/deck/${deck}/load`, 'POST', { serverName, loop });
      toast.success(`Deck ${deck}: Now playing on server`);
      fetchDeckInfo();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchDeckInfo]);

  /**
   * Stop a deck (server returns to AutoDJ)
   */
  const stopDeck = useCallback(async (deck: DeckId) => {
    try {
      await apiCall(`/deck/${deck}/stop`, 'POST');
      fetchDeckInfo();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchDeckInfo]);

  /**
   * Toggle AutoDJ on a deck
   */
  const setAutoDJ = useCallback(async (deck: DeckId, enabled: boolean) => {
    try {
      await apiCall(`/deck/${deck}/autodj`, 'POST', { enabled });
      fetchDeckInfo();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchDeckInfo]);

  /**
   * Load a playlist onto a deck
   */
  const loadPlaylist = useCallback(async (
    deck: DeckId,
    tracks: Array<{ id: string; serverName: string; name: string }>,
    loop = false,
    startIndex = 0,
  ) => {
    try {
      await apiCall(`/deck/${deck}/playlist`, 'POST', { tracks, loop, startIndex });
      toast.success(`Deck ${deck}: Playlist loaded (${tracks.length} tracks)`);
      fetchDeckInfo();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchDeckInfo]);

  /**
   * Skip to next track in playlist
   */
  const playlistNext = useCallback(async (deck: DeckId) => {
    try {
      await apiCall(`/deck/${deck}/playlist/next`, 'POST');
      fetchDeckInfo();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchDeckInfo]);

  /**
   * Jump to specific playlist index
   */
  const playlistJump = useCallback(async (deck: DeckId, index: number) => {
    try {
      await apiCall(`/deck/${deck}/playlist/jump`, 'POST', { index });
      fetchDeckInfo();
    } catch (e: any) {
      toast.error(`Deck ${deck}: ${e.message}`);
    }
  }, [fetchDeckInfo]);

  return {
    deckInfo,
    serverOnline,
    loadTrack,
    stopDeck,
    setAutoDJ,
    loadPlaylist,
    playlistNext,
    playlistJump,
    getDeckStreamUrl,
    refresh: fetchDeckInfo,
  };
}
